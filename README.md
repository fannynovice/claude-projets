# 🎅 Secret Santa

Site statique (HTML/CSS/JS, sans dépendance) pour organiser un Secret Santa, hébergé sur GitHub Pages :
https://fannynovice.github.io/claude-projets/

## Fonctionnement

1. **Page organisateur** (`index.html`) : on saisit l'événement (nom, budget, date, petit mot), les participants et les exclusions.
2. **Tirage** : il se fait entièrement dans le navigateur (`crypto.getRandomValues` + recherche avec retour arrière). Personne ne se tire soi-même.
3. **Liens privés** : chaque participant reçoit un lien `voir.html#…`. Le destinataire est codé dans le fragment d'URL (après le `#`), qui n'est jamais envoyé au serveur.
4. **Espace personnel** (`voir.html`) : le participant ouvre le cadeau, puis peut
   - remplir **sa liste de souhaits**, que son Père Noël secret verra ;
   - consulter **la liste** de la personne qu'il gâte ;
   - échanger des **messages anonymes** avec la personne qu'il gâte (il signe « Père Noël secret ») et avec son propre Père Noël secret.

   Le lien privé fait office de connexion : pas de compte ni de mot de passe.

## Confidentialité

- Le tirage (qui offre à qui) n'est stocké nulle part : ni dans le dépôt, ni sur le serveur.
- Les listes et les messages sont stockés dans Supabase sous des **identifiants opaques** : l'empreinte SHA-256 de jetons aléatoires générés au moment du tirage et présents uniquement dans les liens. Le serveur ne connaît ni les prénoms ni les binômes.
- Les tables ne sont pas lisibles directement : tout passe par des fonctions qui exigent le bon jeton (voir `supabase/schema.sql`).
- Le contenu du lien est brouillé, pas chiffré : quelqu'un de technique qui obtient le lien de quelqu'un d'autre peut le décoder. Chacun doit donc garder son lien pour lui.
- Le texte des souhaits et des messages est stocké tel quel sur le serveur.

## Configuration de Supabase (listes et messages)

1. Créer un projet gratuit sur https://supabase.com.
2. Dans **SQL Editor**, coller et exécuter `supabase/schema.sql`.
3. Dans **Project Settings → API Keys**, copier l'URL du projet et la clé **publishable** (ou « anon »), puis les renseigner dans `assets/config.js`. Cette clé est faite pour être publique.
4. Pousser sur `main`.

Sans configuration, le site fonctionne quand même, mais sans listes ni messages.

Les liens générés avant la configuration n'ont pas les jetons nécessaires. Il faut refaire le tirage pour en profiter.

## Développement local

Servir le dossier avec n'importe quel serveur statique (par ex. `python -m http.server 8000`), puis ouvrir http://localhost:8000.
