# Étape Exporter dédiée aux téléchargements — 29 septembre 2026

## Parcours retenu

La page Exporter ne duplique plus les champs arabe/français, le suivi, les
options de retraduction ou le lecteur de relecture. Le bouton « Modifier la
traduction » mène à l’étape Traduire, également accessible par le menu d’étapes.
Le retour à une étape précédente ne lance aucun traitement et ne change pas les
validations. Une modification de texte continue d’invalider l’export correspondant
et impose sa validation avant une nouvelle création, sans perdre l’ancien fichier.

Deux sections explicites, au même niveau :

- Vidéo sous-titrée : choix Low/High, création/reprise ou téléchargement du MP4 prêt.
- Exporter les sous-titres : boutons SRT français et arabe toujours visibles,
  sans accordéon ; horodatages conservés, pas de style incrusté.

Les sections sont côte à côte sur ordinateur et empilées sous 800 px. Le SRT
reste utilisable lorsque la vidéo a expiré ou pendant sa récupération. Le blocage
de création vidéo pendant récupération reste en place. Aucun média n’est chargé
pour un simple passage sur la page Exporter.

Les raccourcis SRT des étapes de correction/traduction sont conservés pour
exporter un texte avant validation finale. Les deux présentations partagent les
mêmes actions de téléchargement : sauvegarde des éventuelles saisies, version
courante, authentification et nom de fichier serveur inchangés.

## Vérification

```sh
make web-preopening-check ARGS="export-page.spec.ts editor.spec.ts export-recovery-guard.spec.ts workflow-navigation.spec.ts routes.spec.ts"
```

Le scénario complet existant teste import/relecture/traduction/export MP4 avec
une base synthétique et les médias locaux, puis retourne à Traduire pour corriger
et régénérer le rendu. Les tests ciblés de présentation utilisent des réponses
contrôlées pour vérifier l’absence des champs/du lecteur sur Exporter, les deux
sections, le téléchargement SRT et la navigation sans écriture implicite.
Viewports Chromium : 1440 × 932, 393 × 852 et 412 × 915 ; pas des appareils réels.
**35 tests UI et 9 tests Go avec détecteur de courses réussis.** Build frontend
réussi. Les trois captures ont été inspectées visuellement.
Galerie : `web/review/export-page-20260929/index.html`.
Captures et journaux dans `web/review/export-page-20260929/`.

Aucun appel fournisseur, aucune modification de données utilisateur et aucun
déploiement. Ce changement frontend s’ajoute aux correctifs `ed78fc7` et
`b502b56`, toujours à inclure dans le prochain déploiement autorisé.
