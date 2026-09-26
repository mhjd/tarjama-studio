# Lecteur mobile — captures du 26 septembre

Interface du code déployé `b93a8e4` (révision `bc8dfb4c73dabc15`).
Deux scénarios Playwright réussis, iPhone 15 393 × 852 et Pixel 6 412 × 915,
avec émulation tactile Chromium. Captures et mesures :
`web/.cache/mobile-player-review/{iphone15,pixel6}/`.

## Lecture des preuves

1. `01-entree-correction` : titre, navigation et suivi lisibles, mais l'en-tête
   occupe presque tout l'espace restant. Il faut défiler ou lancer la lecture
   pour voir le premier texte arabe.
2. `02-lecture-arabe-compacte` : lecteur fixé en bas ; deux blocs arabes visibles
   dans l'exemple, suivi actif et commandes accessibles.
3. `03-positionnement-arabe` : déplacement à 35 secondes, bon segment surligné
   et visible au-dessus du lecteur.
4. `04-relecture-bilingue-compacte` : arabe puis français, les deux champs du
   segment actif entièrement visibles sur les deux formats.
5. `05-video-agrandie` : image confortable mais espace texte réduit. Sur iPhone,
   seulement 63 des 110 px du champ français sont visibles ; une partie est
   masquée par le lecteur. Sur Pixel, ce segment tient tout juste. Pour relire
   les deux langues, le mode compact est préférable dans l'état actuel.
6. `06-retour-relecture-compacte` : les deux champs redeviennent entièrement
   visibles, le lecteur reprend sa hauteur initiale.
7. `07-champ-francais-selectionne` : focus visible, pas de modification de texte.
   Ne qualifie pas le clavier virtuel d'iOS/Android.
8. `08-validation-en-bas` : le bouton Bas place la validation au-dessus du lecteur ;
   l'archivage et la suppression restent séparés.

| Mesure (pixels CSS) | iPhone 15 | Pixel 6 |
| --- | ---: | ---: |
| Hauteur de la fenêtre | 852 | 915 |
| Lecteur compact | 228 | 228 |
| Espace au-dessus du lecteur compact | 616 | 679 |
| Lecteur agrandi | 456 | 456 |
| Espace au-dessus du lecteur agrandi | 388 | 451 |

Pas de débordement horizontal observé. Les commandes principales mesurent au
moins 44 px ; le focus est visible. Les vignettes compactes sont petites : elles
servent au repérage et à l'écoute, pas à lire les sous-titres intégrés à la vidéo.
Ce constat ne constitue pas une certification d'accessibilité.

Limites : navigateur Chromium à dimensions mobiles, pas Safari/iPhone physique,
ni barres du navigateur, encoche ou clavier système. Vidéos de l'interface sans
piste audio. La lecture réelle utilise une copie locale de l'ancien export de
qualification France 24 (`gbrDbQVYDuQ`, 2 min 18) avec son texte enregistré ; les
sous-titres déjà incrustés dans cet extrait ne sont pas générés par cet essai.
Les réponses de projet sont des fixtures, aucun appel IA ni projet vivant modifié.
Les images sont des captures neuves, toutes inspectées après enregistrement.

## Rejouer

`make web-mobile-player-review` lance uniquement ces deux captures dans
l'environnement de test isolé puis l'arrête. Il nécessite les dépendances de
`web-test` et l'échantillon privé existant dans
`web/.cache/real-ui-10min/ui-review-tenmin_iphone1/` ; celui-ci n'est pas versionné.
Le test conserve les WebM, PNG et mesures. La livraison Mac ajoute leur conversion
MP4 H.264 sans changer le rendu (une bordure noire de 1 px complète la largeur
impaire de l'iPhone pour l'encodage).
