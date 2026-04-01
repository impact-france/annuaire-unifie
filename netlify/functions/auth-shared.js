import jwt from 'jsonwebtoken';

/**
 * Accès 1 : JWT `session` (Bearer ou query) — flux Dynamic Block / mint serveur.
 * Accès 2 (mitigation B) : `memberId` en query + header `X-Embed-Parent` (document.referrer)
 *    doit commencer par une des origines listées dans BETTERMODE_EMBED_PARENT_ORIGINS.
 */
export function getBearerToken(request) {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function parseAllowedParentPrefixes() {
  const raw = Netlify.env.get('BETTERMODE_EMBED_PARENT_ORIGINS') || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isParentReferrerAllowed(parentHeader) {
  const prefixes = parseAllowedParentPrefixes();
  if (!parentHeader || prefixes.length === 0) return false;
  return prefixes.some((p) => parentHeader.startsWith(p));
}

/**
 * @returns {null|Response} null si OK, sinon Response d'erreur
 */
function getMemberIdFromSearch(url) {
  return (
    (url.searchParams.get('memberId') ||
      url.searchParams.get('member_id') ||
      url.searchParams.get('member') ||
      '') +
    ''
  ).trim();
}

export function verifyAccessOrResponse(request) {
  const url = new URL(request.url);
  const token = getBearerToken(request) || (url.searchParams.get('session') || '').trim();
  const memberId = getMemberIdFromSearch(url);
  const parentRef =
    request.headers.get('x-embed-parent') || request.headers.get('X-Embed-Parent') || '';
  const relaxParent = Netlify.env.get('BETTERMODE_EMBED_RELAX_PARENT') === 'true';

  const sessionSecret = Netlify.env.get('DIRECTORY_SESSION_SECRET');

  if (token && sessionSecret) {
    try {
      jwt.verify(token, sessionSecret, { algorithms: ['HS256'] });
      return null;
    } catch {
      return json403('Session invalide ou expirée.');
    }
  }

  if (token && !sessionSecret) {
    return json500("Variable DIRECTORY_SESSION_SECRET manquante (session JWT).");
  }

  // Mode embed B : memberId + origine parent (iframe Bettermode)
  if (memberId) {
    const prefixes = parseAllowedParentPrefixes();
    if (prefixes.length === 0 && !(relaxParent && !parentRef)) {
      return json403(
        'Configure BETTERMODE_EMBED_PARENT_ORIGINS sur Netlify (domaines autorisés pour le bloc iframe).',
      );
    }
    if (isParentReferrerAllowed(parentRef)) {
      return null;
    }
    // Referrer parent parfois vide (Referrer-Policy). Option documentée (moins strict).
    if (relaxParent && !parentRef) {
      console.warn('[auth-shared] BETTERMODE_EMBED_RELAX_PARENT: accès memberId sans X-Embed-Parent');
      return null;
    }
    return json403(
      "Accès refusé (embed). Vérifie BETTERMODE_EMBED_PARENT_ORIGINS, ou active BETTERMODE_EMBED_RELAX_PARENT si le referrer parent est vide.",
    );
  }

  if (!token && !memberId) {
    return json403('Accès refusé.');
  }

  return json403('Accès refusé.');
}

function json403(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function json500(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
