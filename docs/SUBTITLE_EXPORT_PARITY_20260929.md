# Exports regroupés et taille Gros — 29 septembre 2026

> Suite : la nouvelle [règle par paires de moins de 10 mots](EXPORT_PAIR_GROUPING_20260929.md)
> remplace désormais les critères historiques ci-dessous (déploiement `32eba7cc205e8816`).
> La taille Gros et les garanties de conservation restent inchangées.

## Décisions

À la demande du propriétaire, les téléchargements SRT utilisent le regroupement
automatique déjà employé par l'export vidéo et porté du desktop. Les segments
originaux de correction et traduction restent séparés et ne sont jamais réécrits
par un téléchargement. Les groupes utilisent le début du premier segment et la
fin du dernier. Le calcul se fait indépendamment en arabe et en français.

Les règles restent celles du desktop : candidat de deux mots maximum ou de moins
de 5/6 seconde ; écart maximal de 500 ms, chevauchement maximal de 10 ms ; résultat
limité à 7 secondes, 84 caractères Unicode normalisés et 17 caractères/seconde.
Essai avec le suivant, puis le précédent. Les fusions impossibles sont ignorées.
Les retours à la ligne explicites et le format SRT restent pris en charge.

La taille par défaut des nouveaux exports web correspond désormais au réglage
**Gros** du desktop, et non à Standard. Référence :
`ui/electron/export-options.ts::subtitleFontSize` et
`ui/electron/library.ts::writeAssSubtitles`.

Formule : `max(18, round(min(largeur, hauteur) * 0.0667 * 1.15))`.

| Résolution | Ancien web français | Desktop Standard | Nouveau web / Desktop Gros |
| --- | ---: | ---: | ---: |
| 854 × 480 | 36 | 32 | 37 |
| 1280 × 720 | 54 | 48 | 55 |
| 1920 × 1080 | 81 | 72 | 83 |

Les marges, le fond noir, son épaisseur et la déclaration des polices correspondent
également au desktop. Les profils Low/High et leurs résolutions ne changent pas.
La taille ASS suit la résolution finale ; ce n'est pas une taille CSS du lecteur.
Le SRT ne contient aucune police ni taille : le logiciel qui le lit choisit le style.

## Limite typographique

Le desktop déclare Arial pour le français et Noto Naskh Arabic pour l'arabe.
La nouvelle déclaration ASS utilise les mêmes noms. Dans l'image locale de test,
Arial n'est pas installée et fontconfig choisit Noto Sans. Les Dockerfiles média
installent Noto, pas Arial. L'égalité des paramètres est testée, mais cela ne prouve
pas un rendu pixel pour pixel identique à un Mac équipé d'Arial. Une police
identique, disponible légalement des deux côtés, serait nécessaire pour cette
garantie supplémentaire. Aucun téléchargement de police propriétaire ni changement
au profil média administré n'a été effectué.

## Qualification locale

Commande réutilisable :

```sh
make web-preopening-check ARGS="export-page.spec.ts editor.spec.ts"
```

Les tests Go couvrent les groupes, leurs limites, le SRT obtenu par l'API, l'absence
de mutations des projets et les paramètres ASS Gros sur sept résolutions, dans
les deux langues. Un test FFmpeg compare l'image du rendu regroupé à celle d'un
segment déjà réuni. Playwright télécharge un vrai SRT depuis la base synthétique,
puis revient vérifier que les deux textes restent séparés dans l'éditeur.
Les autres scénarios couvrent le parcours d'édition/export et les trois formats
d'affichage. Ces essais isolés n'utilisent aucun crédit fournisseur ni donnée réelle.

Résultat : **13 tests Go avec détecteur de courses et 22 tests Playwright réussis**,
build frontend réussi.

Preuves et résultats : `web/review/subtitle-exports-20260929/`.

## Mise en service ultérieure

Changements préparés uniquement, sans déploiement. Inclure frontend et backend
(API SRT et génération ASS du worker) dans une prochaine candidate compatible
avec la recette publique administrée actuelle. Les MP4 déjà produits ne sont
pas modifiés ni invalidés automatiquement : ils conservent leur ancien rendu.
Un nouveau rendu est nécessaire pour bénéficier du réglage Gros. Les exports SRT
sont calculés au téléchargement et utiliseront donc immédiatement le regroupement
après mise à jour du backend. Aucune migration de données n'est nécessaire.
