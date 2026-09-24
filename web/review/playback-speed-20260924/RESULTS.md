# Vitesse du lecteur — 24 septembre 2026

- Sélecteur de 0,5× à 2×, pas de 0,25×, valeur initiale 1×.
- Maj + ↑ / Maj + ↓ accélèrent et ralentissent hors champ de saisie,
  composition IME et touches Ctrl/Alt/Meta. Le sélecteur garde son clavier natif.
- `preservesPitch` activé. La vitesse concerne seulement la lecture navigateur ;
  les horodatages, traitements et exports sont inchangés.
- Ligne de réglage distincte. Grille symétrique des commandes, sur desktop et
  mobile, même en vue agrandie. Les contrôles d'extension restent dans l'aperçu.
- Le choix reste pendant la lecture, le seek et l'agrandissement ; un nouvel
  éditeur démarre à 1×. Pas de préférence globale persistante ajoutée.

Tests Playwright : sélection de chaque vitesse représentative, propriété réelle
`playbackRate`, préservation de hauteur, raccourcis successifs et bornes,
absence d'interception pendant la saisie, centrage à moins d'un pixel et absence
de débordement aux largeurs 320, 393, 412 et 1440 CSS px. Les captures compactes
et agrandies sont inspectées ; tests existants du lecteur/éditeur et captures
visuelles rejoués. Environnement Chromium isolé avec média synthétique, sans
appel fournisseur. Pas de qualification Safari ou appareil physique.

21 tests Playwright réussis sur une base de fixtures neuve ; TypeScript/Vite
et construction de l'image réussis. Les premiers essais ont nécessité de mettre
à jour la limite de hauteur attendue du dock et de recréer la base de test
après une exécution interrompue. Aucune donnée de production touchée.

Captures : [iPhone 15](iphone15.png), [ordinateur](macbook15.png).

Recette : `web/deploy/preview/active-speed-20260924.yml`.
Image : `preview.local/atelier/web@sha256:f44f0bbeaf961bfdffed3509adeffacfaa22ca1ea1318361a0dc76c29564530e`.
Validate/plan réussis, révision `5a9f9c19e4ca7f1f`.
Seule l'image du service web change ; elle conserve le runtime qualifié avec
le correctif ASR. Le worker conserve son image. Aucun job, migration ou changement
de protections n'est lancé par cette livraison.

Déploiement réussi ; services web, worker, egress et base prêts.
