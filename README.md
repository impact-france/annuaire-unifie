# Annuaire unifié (Netlify + Bettermode)

Ce projet sert un annuaire via une iframe dans Bettermode, avec un accès **protégé** côté Netlify Functions.

## Deux modes d’accès

### A — Dynamic Block / Interaction URL (recommandé si supporté par Bettermode)

- Bettermode appelle `/.netlify/functions/bettermode-auth` (POST signé).
- L’iframe peut pointer vers `index.html?session=...` (JWT court).
- Le front envoie `Authorization: Bearer <session>` aux Functions.

### B — Bloc iFrame du Customizer (Space) + Liquid `memberId` (mitigation)

- URL du type : `index.html?memberId={{ member.id }}` (exemple).
- Le navigateur envoie l’en-tête `X-Embed-Parent: document.referrer` (page parente Bettermode).
- Les Functions vérifient que ce referrer **commence par** une des origines listées dans `BETTERMODE_EMBED_PARENT_ORIGINS`.

**Limite** : `memberId` seul n’est pas un secret ; le referrer est une **mitigation** (pas une preuve cryptographique). À utiliser en connaissance de cause.

## Principe (données)

- Les Functions HubSpot refusent l’accès sans **session JWT valide** (mode A) ou **memberId + parent autorisé** (mode B).

## Variables d’environnement Netlify

- `BETTERMODE_SIGNING_SECRET` : signing secret (webhook) côté Bettermode App.
  - (Optionnel) `BETTERMODE_CLIENT_SECRET` : utilisé en fallback si `BETTERMODE_SIGNING_SECRET` n’est pas défini.
- `DIRECTORY_SESSION_SECRET` : secret pour signer/vérifier les JWT `session` éphémères (mode A).
- `BETTERMODE_EMBED_PARENT_ORIGINS` : liste séparée par des virgules d’**URL préfixes** autorisés pour le header `X-Embed-Parent` (mode B), par ex. `https://adherent.impactfrance.eco,https://ta-communaute.bettermode.com`
- `HUBSPOT_ACCESS_TOKEN` : token HubSpot.
- `HUBSPOT_COMPANY_LIST_ID` : ID de liste HubSpot (optionnel, défaut `"412"` dans le code).

## Endpoints

- `/.netlify/functions/bettermode-auth` : endpoint appelé par Bettermode (POST), renvoie du Slate.
- `/.netlify/functions/get-companies` : données entreprises (protégé).
- `/.netlify/functions/get-company-contacts` : contacts HubSpot (protégé).

