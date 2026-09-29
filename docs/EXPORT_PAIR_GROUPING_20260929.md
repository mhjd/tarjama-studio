# Regroupement par paires courtes — 29 septembre 2026

## Décision du propriétaire

Deux segments consécutifs peuvent être fusionnés si **chacun contient strictement
moins de 10 mots**. Un segment de 10 mots ou plus n'est jamais fusionné, même si
son voisin n'a qu'un mot. Les guillemets et signes de ponctuation isolés ne
comptent pas comme des mots ; un mot est un élément séparé par des espaces qui
contient au moins une lettre ou un chiffre. Même calcul en arabe et en français.

Les segments sont parcourus par paires, dans l'ordre. Une paire fusionnée n'est
pas fusionnée à nouveau avec le segment suivant : cela évite de fabriquer de
gros blocs à partir d'une longue suite de fragments. Le résultat peut contenir
jusqu'à 18 mots, sous réserve des limites de lisibilité existantes :

- écart maximal 500 ms ; chevauchement toléré jusqu'à 10 ms ;
- durée du groupe au plus 7 secondes ;
- au plus 84 caractères Unicode normalisés et 17 caractères par seconde.

Les petits segments séparés par une vraie pause ou dont la fusion serait trop
chargée restent donc séparés. Aucun appel IA, ajout de texte ou déplacement de
la parole : le groupe conserve le début du premier et la fin du second.

Cette décision remplace le seuil desktop historique (deux mots ou moins de
0,83 seconde). La variante expérimentale « courte phrase inachevée » a été
abandonnée avant commit et déploiement. Le desktop lui-même n'est pas modifié.
Le réglage de taille Gros reste inchangé.

## Exemple signalé

Avec les horaires visibles dans la capture, 24:10–24:12 « en disant : « Sans la
difficulté, » puis 24:12–24:14 « tout le monde serait chef. » forment un seul
sous-titre à l'export, de **24:10 à 24:14**. Le test emploie ces phrases et ces
horaires ; ce n'est pas une lecture des millisecondes du projet réel.

Vidéo et SRT partagent la même fonction. Les textes enregistrés et champs de
relecture restent séparés. Les MP4 déjà générés ne sont pas réécrits.

## Vérification

```sh
make web-preopening-check ARGS="export-page.spec.ts"
```

Tests des seuils 9/10 mots dans les deux sens, voisin très long, ponctuation,
arabe, absence de fusion en chaîne, pauses, chevauchement et limites de lecture.
Le cas utilisateur est vérifié dans l'ASS et le SRT. Un rendu FFmpeg synthétique
compare les pixels de la paire fusionnée à ceux d'un segment déjà réuni.
Le téléchargement SRT via l'API et Playwright vérifie aussi que les segments de
relecture restent intacts. Aucun crédit IA ni projet utilisateur utilisé.

Preuves : `web/review/export-pairs-20260929/`. Changement déployé le 29 septembre, révision `32eba7cc205e8816`.
Recette : `web/deploy/preview/active-export-pairs-20260929.yml`.
Le rendu réel demandé pour Sirat est suivi dans
[la passation opérationnelle](REQUESTED_REEXPORT_20260929.md).

Résultat : **15 tests Go avec détecteur de courses et 4 tests Playwright réussis**,
build frontend réussi. Image extraite du rendu synthétique inspectée : phrase
entière visible, sans découpage.
