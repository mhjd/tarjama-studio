# Expérience S1 : frontières de phrases

Laboratoire hors application. Voir [protocole](PROTOCOL.md), gel
[SELECTION.json](SELECTION.json) au commit `96656a9`, et
[résultats](../../../docs/SUBTITLE_SENTENCE_GROUPING_RESULTS_20260929.md).

Reproduire depuis la racine, avec Docker et l'image locale indiquée dans
`SELECTION.json` (ICU 72 et libass). Aucun téléchargement automatique. Ne pas
écraser les essais existants ; choisir un nouveau nom :

```sh
make web-sentence-grouping-experiment ARGS='dev --run reproduction-dev'
```

`historical` désigne la conférence Dedew ; `short` le reportage de contrôle.
Ils ont déjà été évalués une fois après gel : les relancer ne crée pas une
nouvelle réserve indépendante. Le runner vérifie les empreintes du code pour
ces deux jeux. Comparer aussi l'image exécutée dans `launch.json` avec l'image
figée, car le runner résout le tag local au lancement.

Pour générer les fichiers ASS/SRT et vérifier les limites du rendu **des trois
essais officiels existants**, sans recalculer le regroupement :

```sh
make web-sentence-grouping-artifacts ARGS=dev-s1
make web-sentence-grouping-artifacts ARGS=reserved-dedew-s1
make web-sentence-grouping-artifacts ARGS=control-news-s1
```

Ces commandes ont déjà été exécutées : leur dossier `render-validation` est
créé exclusivement et une relance refuse de l'écraser. Conserver les preuves.
Les fichiers sont dans `web/.cache/sentence-grouping-20260929/`, sans copie dans
les projets utilisateurs. Aucune intégration ou activation de S1 en production.

`results-summary.json` conserve les mesures et empreintes sans les corpus
complets. Les artefacts détaillés et leurs SHA256 restent dans le cache privé.

## Livraison vidéo demandée après évaluation

Le propriétaire a ensuite demandé les vidéos. Le rendu complet de Sirat utilise
l’ASS figé de S1, la copie source administrateur et l’image outils figée :

```sh
make web-sentence-grouping-video ARGS=render
make web-sentence-grouping-video ARGS=verify
make web-sentence-grouping-video ARGS=clips
```

Le premier encodage refuse tout écrasement ; `verify` décode intégralement le
MP4, vérifie durée/résolution et identité des paquets audio AAC. `clips` extrait
les passages 10:18–10:36 et 39:10–39:36 du MP4 fini, puis les décode aussi.
Ressources bornées : 4 CPU, 1536 Mio, 2 heures maximum, sans réseau ; 17 Gio de
marge disque exigés. Aucun changement de partition ni appel fournisseur.
Les preuves sont dans `web/.cache/sentence-grouping-20260929/video-delivery/`.

La source Dedew n’est pas disponible dans les copies locales : seul le SRT de
ce benchmark peut être fourni. Le MP4 France 24 disponible est l’ancien export
réel du parcours UI, fourni comme témoin, pas comme nouveau rendu S1.

Rendu livré : 708798236 octets, 3612.829000 s,
encodage 722.86 s. Décodage intégral réussi (251.03 s),
paquets audio AAC identiques à la source. Les deux extraits et le témoin
France 24 ont aussi été décodés intégralement. Image finale à 10:24 inspectée.
Livraison préparée dans `tarjama-regroupement-phrases/` via vps-share ;
le transfert vers le Mac se fait ensuite par `vps pull`.

SHA256 du nouveau MP4 : `725d6cc653391a4c5bc2c66a8ff3c5b73c02150cdb80fefd2ea4e35d747f23b8`.
