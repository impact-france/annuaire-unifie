# Macarons Impact Score

Ce dossier contient les macarons personnalisés pour les scores d'impact des entreprises.

## Organisation des fichiers

Les fichiers doivent être nommés selon le format suivant :
- `0.png` pour le score 0
- `1.png` pour le score 1
- `2.png` pour le score 2
- ...
- `100.png` pour le score 100

## Instructions d'upload

1. Placez tous vos fichiers PNG dans ce dossier (`/assets/macarons/`)
2. Nommez chaque fichier selon le format `{numero}.png`
3. Les scores doivent être des entiers de 0 à 100
4. Si un fichier est manquant pour un score donné, aucun macaron ne s'affichera pour ce score

## Exemple de structure

```
assets/
└── macarons/
    ├── 0.png
    ├── 1.png
    ├── 2.png
    ├── ...
    ├── 99.png
    └── 100.png
```

## Fonctionnement

- Le système charge automatiquement le bon macaron selon le score de l'entreprise
- **Les scores décimaux sont automatiquement arrondis** (ex: 85.7 → 86.png)
- Si le fichier n'existe pas ou ne peut pas être chargé, aucun macaron ne s'affiche
- Seuls les scores entre 0 et 100 sont pris en compte
