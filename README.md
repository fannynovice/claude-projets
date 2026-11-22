# 🎅 Secret Santa

Site statique (HTML/CSS/JS, sans dépendance) pour organiser un Secret Santa, hébergé sur GitHub Pages.

## Fonctionnement

1. **Page organisateur** (`index.html`) : saisissez l'événement (nom, budget, date, petit mot), les participants et les exclusions (« A ne doit pas offrir à B », éventuellement dans les deux sens).
2. **Tirage** : réalisé entièrement dans le navigateur (`crypto.getRandomValues` + recherche avec retour arrière pour respecter les exclusions). Personne ne se tire soi-même.
3. **Liens privés** : chaque participant reçoit un lien `voir.html#…`. Le destinataire est codé dans le fragment d'URL (après le `#`), qui n'est jamais envoyé au serveur.
4. **Révélation** (`voir.html`) : le participant ouvre le cadeau et découvre à qui il offre.

## Confidentialité

- Aucun résultat n'est stocké dans le dépôt ni sur un serveur : le lien *est* le résultat.
- Seule la configuration (participants, exclusions, infos de l'événement) est mémorisée en brouillon dans le `localStorage` du navigateur de l'organisateur, jamais le tirage.
- Le contenu du lien est brouillé pour ne pas être lisible d'un coup d'œil ; ce n'est pas un chiffrement fort. Une personne technique et déterminée pourrait le décoder : c'est un jeu, pas un coffre-fort.

## Développement local

```bash
python -m http.server 8000
```

Puis ouvrir http://localhost:8000.
