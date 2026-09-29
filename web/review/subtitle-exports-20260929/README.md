# Qualification des exports — 29 septembre 2026

Candidate locale uniquement, sans déploiement ni appel IA.

- `grouped-fr-large-high.mp4` : rendu synthétique de 4 secondes, 640 × 360,
  taille desktop Gros et regroupement de deux segments courts.
- `grouped-large.png` : image extraite à 1 seconde, inspectée sans découpage du texte.
- `font-resolution.txt` : Arial résout vers Noto Sans dans l’image de test ;
  aucune preuve d’identité typographique avec Arial sur Mac.
- `initial-srt-tests.log` : première tentative, conservée ; dernier test UI en
  échec à cause d’une hypothèse sur l’état du projet synthétique partagé.
  Le test suit désormais son état courant et fixe explicitement ses deux textes.
- `tests.log` : qualification finale avec le réglage Gros.

Les essais UI concernent Chromium aux formats desktop, iPhone 15 et Pixel 6.
Ils ne constituent pas des essais sur téléphones physiques. Le test SRT final
utilise l’API locale, une base synthétique et les fournisseurs de test.
