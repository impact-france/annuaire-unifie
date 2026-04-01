import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const LOG_PREFIX = '[bettermode-auth]';

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function computeBettermodeSignature({ signingSecret, timestamp, rawBody }) {
  const base = `${timestamp}:${rawBody}`;
  return crypto.createHmac('sha256', signingSecret).update(base, 'utf8').digest('hex');
}

/** Bettermode envoie le timestamp en millisecondes (voir doc verifying-webhooks). */
function parseRequestTimestampMs(headerValue) {
  const n = Number(headerValue);
  if (!Number.isFinite(n)) return null;
  // Heuristique : < 1e12 → secondes Unix (rare), sinon ms
  if (n < 1e12) return n * 1000;
  return n;
}

function json(status, body, headers = {}) {
  const serialized = JSON.stringify(body);
  console.log(`${LOG_PREFIX} response`, {
    status,
    bodyBytes: Buffer.byteLength(serialized, 'utf8'),
    bodyPreview: serialized.slice(0, 500),
  });
  return new Response(serialized, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function slateResponse(status, slate, headers = {}) {
  const serialized = JSON.stringify(slate);
  console.log(`${LOG_PREFIX} slateResponse`, {
    status,
    bodyBytes: Buffer.byteLength(serialized, 'utf8'),
    bodyPreview: serialized.slice(0, 500),
  });
  return new Response(serialized, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export default async (request) => {
  console.log(`${LOG_PREFIX} incoming`, {
    method: request.method,
    url: request.url,
  });

  if (request.method !== 'POST') {
    return json(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
  }

  const signingSecret =
    Netlify.env.get('BETTERMODE_SIGNING_SECRET') || Netlify.env.get('BETTERMODE_CLIENT_SECRET');
  const sessionSecret = Netlify.env.get('DIRECTORY_SESSION_SECRET');

  console.log(`${LOG_PREFIX} env`, {
    hasSigningSecret: Boolean(signingSecret),
    hasSessionSecret: Boolean(sessionSecret),
  });

  if (!signingSecret || !sessionSecret) {
    console.error(`${LOG_PREFIX} missing env: BETTERMODE_SIGNING_SECRET / DIRECTORY_SESSION_SECRET`);
    return json(500, { error: "Variables d'environnement manquantes." });
  }

  const signatureHeader =
    request.headers.get('x-bettermode-signature') || request.headers.get('X-Bettermode-Signature');
  const timestampHeader =
    request.headers.get('x-bettermode-request-timestamp') ||
    request.headers.get('X-Bettermode-Request-Timestamp');

  console.log(`${LOG_PREFIX} signature headers`, {
    hasSignature: Boolean(signatureHeader),
    signatureLength: signatureHeader?.length ?? 0,
    signaturePrefix: signatureHeader ? `${signatureHeader.slice(0, 12)}…` : null,
    hasTimestamp: Boolean(timestampHeader),
    timestampRaw: timestampHeader,
  });

  if (!signatureHeader || !timestampHeader) {
    console.warn(`${LOG_PREFIX} missing signature or timestamp header → 403`);
    return json(403, { error: 'Signature manquante.' });
  }

  const rawBody = await request.text();
  console.log(`${LOG_PREFIX} body`, {
    rawBytes: Buffer.byteLength(rawBody, 'utf8'),
    bodyPreview: rawBody.slice(0, 800),
  });

  const expected = computeBettermodeSignature({
    signingSecret,
    timestamp: timestampHeader,
    rawBody,
  });

  const signatureOk = timingSafeEqualHex(signatureHeader, expected);
  console.log(`${LOG_PREFIX} HMAC compare`, {
    signatureOk,
    expectedPrefix: `${expected.slice(0, 16)}…`,
    receivedPrefix: `${signatureHeader.slice(0, 16)}…`,
  });

  if (!signatureOk) {
    console.warn(`${LOG_PREFIX} signature mismatch → 403`);
    return json(403, { error: 'Signature invalide.' });
  }

  const timestampMs = parseRequestTimestampMs(timestampHeader);
  if (timestampMs != null) {
    const skewMs = Math.abs(Date.now() - timestampMs);
    console.log(`${LOG_PREFIX} replay check`, {
      timestampMs,
      serverNow: Date.now(),
      skewMs,
      skewMinutes: (skewMs / 60000).toFixed(2),
    });
    // Doc Bettermode : ignorer les événements > 5–15 min ; on reste à 5 min côté interaction
    if (skewMs > 5 * 60 * 1000) {
      console.warn(`${LOG_PREFIX} timestamp trop ancien/décalé → 403`);
      return json(403, { error: 'Requête expirée.' });
    }
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error(`${LOG_PREFIX} JSON parse error`, e);
    return json(400, { error: 'Body JSON invalide.' });
  }

  console.log(`${LOG_PREFIX} payload`, {
    type: payload?.type,
    networkId: payload?.networkId,
    hasData: Boolean(payload?.data),
    dataKeys: payload?.data ? Object.keys(payload.data) : [],
    preview: payload?.data?.preview,
    dynamicBlockKey: payload?.data?.dynamicBlockKey,
    hasActorId: Boolean(payload?.data?.actorId),
  });

  const appId = payload?.data?.appId;
  const interactionId = payload?.data?.interactionId;
  const actorId = payload?.data?.actorId;
  const networkId = payload?.networkId;
  const dynamicBlockKey = payload?.data?.dynamicBlockKey;
  const isPreview = payload?.data?.preview === true;

  if (!appId || !interactionId) {
    console.warn(`${LOG_PREFIX} missing appId or interactionId → 400`, { appId, interactionId });
    return json(400, { error: 'Payload interaction incomplet.' });
  }

  let effectiveActorId = actorId;
  if (!effectiveActorId) {
    if (isPreview) {
      effectiveActorId = 'bettermode-preview';
      console.warn(`${LOG_PREFIX} no actorId, preview=true → using placeholder actor`);
    } else {
      console.warn(`${LOG_PREFIX} no actorId → 403`);
      return json(403, { error: 'Utilisateur non identifié.' });
    }
  }

  const sessionToken = jwt.sign(
    {
      actorId: effectiveActorId,
      networkId,
      dynamicBlockKey,
      typ: 'directory_session',
      preview: isPreview,
    },
    sessionSecret,
    {
      algorithm: 'HS256',
      expiresIn: '10m',
      issuer: 'netlify-directory',
      subject: String(effectiveActorId),
    },
  );

  const origin = new URL(request.url).origin;
  const iframeUrl = `${origin}/index.html?session=${encodeURIComponent(sessionToken)}`;

  // Debug: URL complète pour test manuel (token valable ~10 min)
  console.log(`${LOG_PREFIX} iframeUrl`, iframeUrl);

  console.log(`${LOG_PREFIX} success`, {
    appId,
    interactionId,
    iframeOrigin: origin,
    iframePath: '/index.html?session=…',
  });

  // Diagnostic profond: renvoyer d'abord un Slate ULTRA SIMPLE (texte seul).
  // Si cela ne s'affiche pas, le problème vient du contrat Bettermode <-> endpoint,
  // pas de l'iframe ni de la logique d'auth.
  const debugMarkdown = [
    '**Annuaire debug**',
    '',
    '- Endpoint Netlify atteint',
    '- Signature vérifiée',
    `- dynamicBlockKey: \`${dynamicBlockKey || 'n/a'}\``,
    `- actorId: \`${effectiveActorId}\``,
    '',
    `[Ouvrir l'annuaire dans un nouvel onglet](${iframeUrl})`,
  ].join('\n');

  const slate = {
    rootBlock: 'root',
    blocks: [
      {
        id: 'root',
        name: 'Container',
        props: { spacing: 'md' },
        children: ['intro'],
      },
      {
        id: 'intro',
        name: 'text',
        props: {
          format: 'markdown',
          value: debugMarkdown,
        },
        children: [],
      },
    ],
  };

  return slateResponse(200, slate);
};
