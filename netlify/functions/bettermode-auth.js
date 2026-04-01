import crypto from 'crypto';
import jwt from 'jsonwebtoken';

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

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export default async (request) => {
  if (request.method !== 'POST') {
    return json(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
  }

  const signingSecret =
    Netlify.env.get('BETTERMODE_SIGNING_SECRET') || Netlify.env.get('BETTERMODE_CLIENT_SECRET');
  const sessionSecret = Netlify.env.get('DIRECTORY_SESSION_SECRET');

  if (!signingSecret || !sessionSecret) {
    return json(500, { error: "Variables d'environnement manquantes." });
  }

  const signatureHeader =
    request.headers.get('x-bettermode-signature') || request.headers.get('X-Bettermode-Signature');
  const timestampHeader =
    request.headers.get('x-bettermode-request-timestamp') ||
    request.headers.get('X-Bettermode-Request-Timestamp');

  if (!signatureHeader || !timestampHeader) {
    return json(403, { error: 'Signature manquante.' });
  }

  const rawBody = await request.text();
  const expected = computeBettermodeSignature({
    signingSecret,
    timestamp: timestampHeader,
    rawBody,
  });

  if (!timingSafeEqualHex(signatureHeader, expected)) {
    return json(403, { error: 'Signature invalide.' });
  }

  // (Optionnel) garde-fou anti-rejeu : refuser si timestamp trop vieux (5 minutes)
  const timestampMs = Number(timestampHeader) * 1000;
  if (Number.isFinite(timestampMs)) {
    const skewMs = Math.abs(Date.now() - timestampMs);
    if (skewMs > 5 * 60 * 1000) {
      return json(403, { error: 'Requête expirée.' });
    }
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'Body JSON invalide.' });
  }

  const appId = payload?.data?.appId;
  const interactionId = payload?.data?.interactionId;
  const actorId = payload?.data?.actorId;
  const networkId = payload?.networkId;
  const dynamicBlockKey = payload?.data?.dynamicBlockKey;

  if (!appId || !interactionId) {
    return json(400, { error: 'Payload interaction incomplet.' });
  }

  if (!actorId) {
    return json(403, { error: 'Utilisateur non identifié.' });
  }

  const sessionToken = jwt.sign(
    {
      actorId,
      networkId,
      dynamicBlockKey,
      typ: 'directory_session',
    },
    sessionSecret,
    {
      algorithm: 'HS256',
      expiresIn: '10m',
      issuer: 'netlify-directory',
      subject: String(actorId),
    },
  );

  const origin = new URL(request.url).origin;
  const iframeUrl = `${origin}/index.html?session=${encodeURIComponent(sessionToken)}`;

  return json(200, {
    type: 'INTERACTION',
    status: 'Succeeded',
    data: {
      appId,
      interactionId,
      interactions: [
        {
          type: 'SHOW',
          id: 'directory-block',
          slate: {
            rootBlock: 'root',
            blocks: [
              {
                id: 'root',
                name: 'Container',
                props: { spacing: 'md' },
                children: ['frame'],
              },
              {
                id: 'frame',
                name: 'Iframe',
                props: {
                  src: iframeUrl,
                  height: 900,
                  title: 'Annuaire',
                },
                children: [],
              },
            ],
          },
        },
      ],
    },
  });
};

