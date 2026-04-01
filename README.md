# Annuaire unifié (Netlify + Bettermode)

Ce projet sert un annuaire via une iframe dans Bettermode, avec un accès **protégé** via une Custom App + Dynamic Block.

## Principe

- Bettermode appelle `/.netlify/functions/bettermode-auth` (Interaction URL).
- La function vérifie la signature webhook (HMAC) et renvoie une réponse **Slate (UI Kit)** avec un composant `Iframe`.
- L’iframe pointe vers `index.html?session=...` (JWT éphémère).
- Le front envoie `Authorization: Bearer <session>` à chaque appel `/.netlify/functions/*`.
- Les functions de données refusent l’accès sans token (`403`).

## Variables d’environnement Netlify

- `BETTERMODE_SIGNING_SECRET` : signing secret (webhook) côté Bettermode App.
  - (Optionnel) `BETTERMODE_CLIENT_SECRET` : utilisé en fallback si `BETTERMODE_SIGNING_SECRET` n’est pas défini.
- `DIRECTORY_SESSION_SECRET` : secret pour signer/vérifier les JWT `session` éphémères.
- `HUBSPOT_ACCESS_TOKEN` : token HubSpot.
- `HUBSPOT_COMPANY_LIST_ID` : ID de liste HubSpot (optionnel, défaut `"412"` dans le code).

## Endpoints

- `/.netlify/functions/bettermode-auth` : endpoint appelé par Bettermode (POST), renvoie du Slate.
- `/.netlify/functions/get-companies` : données entreprises (protégé).
- `/.netlify/functions/get-company-contacts` : contacts HubSpot (protégé).

