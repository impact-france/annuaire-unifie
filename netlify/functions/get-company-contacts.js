import { Client } from '@hubspot/api-client';
import { verifyAccessOrResponse } from './auth-shared.js';

let cachedByCompanyId = new Map();
const CACHE_DURATION_MINUTES = 30;

function getFromCache(companyId) {
  const entry = cachedByCompanyId.get(companyId);
  if (!entry) return null;
  const isFresh = Date.now() - entry.cachedAt < CACHE_DURATION_MINUTES * 60 * 1000;
  if (!isFresh) {
    cachedByCompanyId.delete(companyId);
    return null;
  }
  return entry.contacts;
}

function setCache(companyId, contacts) {
  cachedByCompanyId.set(companyId, { contacts, cachedAt: Date.now() });

  // garde-fou mémoire: limiter la taille du cache
  if (cachedByCompanyId.size > 300) {
    const firstKey = cachedByCompanyId.keys().next().value;
    cachedByCompanyId.delete(firstKey);
  }
}

export default async (request) => {
  const authError = verifyAccessOrResponse(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const companyId = (url.searchParams.get('companyId') || '').trim();

  if (!companyId) {
    return new Response(JSON.stringify({ error: 'Paramètre companyId manquant.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const cached = getFromCache(companyId);
  if (cached) {
    return new Response(JSON.stringify({ contacts: cached, cached: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const HUBSPOT_ACCESS_TOKEN = Netlify.env.get('HUBSPOT_ACCESS_TOKEN');
  if (!HUBSPOT_ACCESS_TOKEN) {
    return new Response(JSON.stringify({ error: "Variable d'environnement HUBSPOT_ACCESS_TOKEN manquante." }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const hubspotClient = new Client({ accessToken: HUBSPOT_ACCESS_TOKEN });

  const contactProperties = ['firstname', 'lastname', 'intitule_de_poste___standardise'];

  try {
    // HubSpot Associations API (v4 REST): companies -> contacts
    // Doc: /crm/v4/objects/{objectType}/{objectId}/associations/{toObjectType}
    const assocUrl = `https://api.hubapi.com/crm/v4/objects/companies/${encodeURIComponent(companyId)}/associations/contacts?limit=500`;
    const assocResp = await fetch(assocUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!assocResp.ok) {
      const text = await assocResp.text().catch(() => '');
      throw new Error(`Erreur HubSpot associations (${assocResp.status}): ${text || assocResp.statusText}`);
    }

    const assocData = await assocResp.json();
    const ids = (assocData?.results || [])
      .map((r) => r?.toObjectId)
      .filter((id) => id !== undefined && id !== null)
      .map((id) => id.toString());

    if (ids.length === 0) {
      setCache(companyId, []);
      return new Response(JSON.stringify({ contacts: [] }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Batch read contacts
    const batch = await hubspotClient.crm.contacts.batchApi.read({
      inputs: ids.map((id) => ({ id })),
      properties: contactProperties,
    });

    const contacts = (batch?.results || []).map((c) => ({
      ...c.properties,
      hubspotId: c.id,
    }));

    // tri stable pour UX
    contacts.sort((a, b) => {
      const nameA = `${(a.lastname || '').trim()} ${(a.firstname || '').trim()}`.trim().toLowerCase();
      const nameB = `${(b.lastname || '').trim()} ${(b.firstname || '').trim()}`.trim().toLowerCase();
      return nameA.localeCompare(nameB, 'fr');
    });

    setCache(companyId, contacts);

    return new Response(JSON.stringify({ contacts }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('Erreur get-company-contacts:', e);
    return new Response(JSON.stringify({ error: e.message || 'Erreur inconnue' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
};

