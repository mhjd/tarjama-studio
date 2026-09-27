# Lecteur et sous-titres compacts sur téléphone — 27 septembre 2026

## Décision et comportement

Le propriétaire signale deux problèmes : la vitesse et la navigation haut/bas
occupent deux lignes permanentes près du transport ; les champs de texte et leurs
marges laissent trop peu de place aux sous-titres.

À 640 px et moins :

- Lecture/pause et ±5 secondes restent les commandes principales, centrées.
- `Options · 1×` est placé à côté de la barre de lecture. La vitesse actuelle
  reste visible, mais les changements demandent une ouverture explicite.
- L'ouverture affiche vitesse, Haut et Bas sur une seule ligne dans un panneau
  au-dessus du lecteur. Elle ne change ni sa hauteur ni la position du transport.
- Le panneau se ferme après Haut/Bas, avec Échap (focus rendu au bouton), ou au
  toucher extérieur. Les cibles tactiles gardent 44 px : on réduit l'encombrement
  permanent plutôt que la précision nécessaire pour toucher un bouton.
- Marges, intervalles bilingues et espaces de titre sont réduits. Le français
  reste à 16 px, l'arabe à 22 px avec une hauteur de ligne adaptée.
- La hauteur des champs suit le texte, y compris pendant l'édition, après
  chargement des fontes et après changement de largeur/orientation. Pas de
  troncature, de limite de lignes ni de petit ascenseur interne sur téléphone.
  Un très long sous-titre nécessite naturellement de faire défiler la page.

Sur ordinateur, la disposition des commandes secondaires et les raccourcis
restent disponibles. Les champs gardent leur hauteur et leur redimensionnement
habituels. Aucune modification backend, de modèle, de sauvegarde ou de rétention.

## Vérification

Tests Playwright sous Chromium avec vues 320 px, iPhone 15 (393 × 852), Pixel 6
(412 × 915) et ordinateur (1440 px). Il s'agit d'émulation de dimensions, pas
d'essais sur du matériel iOS/Android ni de qualification Safari.

- Centrage des commandes conservé en mode compact/agrandi et après changement
  de vitesse ; options cachées initialement et alignées à l'ouverture.
- Hauteur du lecteur mobile compact inférieure à 165 px dans les fixtures.
- Au moins deux blocs courts complets arabe/français visibles au-dessus du lecteur
  après défilement jusqu'aux sous-titres ; captures inspectées visuellement.
- Longs textes arabes/français non coupés, champ qui grandit pendant la frappe,
  nouvelle mesure après changement de largeur.
- Navigation haut/bas, pause et préférence de suivi conservées.
- Contrôles d'extension vidéo contenus dans leur vignette.

Captures locales : `web/.cache/mobile-compact-20260927/`.
Journaux : `web/.cache/mobile-density-tests.log` et
`web/.cache/mobile-compact-regression.log`.


Résultat : build TypeScript/Vite réussi, 53 cas UI distincts réussis : 15 tests
ciblés puis 42 tests de régression (les quatre tests de vitesse ont été rejoués
après raccourcissement du libellé de la vitesse normale). Parcours UI complets
avec source et IA de test sur ordinateur, iPhone et Pixel ; export FFmpeg réel.
Aucun appel fournisseur réel facturé. Les tests de saisie, IME, conflit entre
onglets, sauvegarde sur blur et navigation passent avec les champs adaptatifs.

Livraison non déployée. L'image API doit être reconstruite avant activation ;
conserver le worker et le digest egress `19994f1…` de la recette active de rétention.
Les fichiers de déploiement existants restent ceux de la version déjà en ligne.


## Vidéos remises à disposition

Le test `mobile-density.spec.ts` enregistre désormais automatiquement son parcours
(lecture des blocs courts, panneau Options, texte long, frappe et redimensionnement),
avec pauses de lecture. Les deux cas sont repassés avec succès après cet ajout.
Les trois enregistrements des parcours complets ont été conservés avant la nouvelle
exécution. Cinq MP4 H.264 ont été préparés et contrôlés par ffprobe, sans piste audio.

Livraison `tarjama-ui-mobile-compact` publiée dans l'espace privé vps-share,
à récupérer avec `vps pull` sur le Mac. Le README distingue les fixtures locales
et l'émulation de viewport d'une qualification réelle en production.
Originaux durables côté projet : `web/.cache/mobile-compact-20260927/videos/`.
