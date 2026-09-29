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
