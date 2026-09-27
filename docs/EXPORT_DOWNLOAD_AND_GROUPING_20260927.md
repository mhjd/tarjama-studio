# Action de téléchargement et regroupement — 27 septembre 2026

## Action principale — préparée, non déployée

Lorsque le rendu correspondant à la qualité sélectionnée, à la version des
textes et à la génération du projet est prêt, l'action principale devient
« Télécharger la vidéo ». C'est un lien de téléchargement natif présenté comme
un bouton principal, à la place du bouton désactivé et du lien séparé.
Pour télécharger un autre rendu, sélectionner sa qualité dans le champ existant.

Le clic attend la sauvegarde des retouches. Si cette sauvegarde rend l'export
ancien, il ne déclenche pas son téléchargement et demande de valider les textes
pour créer une vidéo à jour. Le transfert est natif, sans charger toute la vidéo
dans un Blob JavaScript, et garde le nom fourni par le serveur à partir du titre
du projet. Une source expirée n'empêche pas de télécharger un rendu encore prêt.
Les états de création, attente, échec et reprise restent gérés comme auparavant.

Les scénarios Playwright et le script de capture réel `web/review/record-export.mjs`
utilisent désormais cette action unique. Le scénario d'édition vérifie également
le clic natif et la récupération du MP4, en plus de l'accès HTTP au rendu.

## Écart constaté dans df7a347, puis corrigé à la demande du propriétaire

Le regroupement desktop se trouve dans `ui/electron/export-options.ts`, fonction
`groupExportCues`, appelée par `ui/electron/library.ts` juste avant l'export vidéo.
Le mode par défaut est `automatic` dans le desktop :

- Candidat au regroupement : au plus deux mots, ou durée inférieure à 5/6 s.
- Fusion uniquement entre voisins séparés d'au plus 0,5 s, sans chevauchement
  supérieur à 0,01 s.
- Résultat limité à 7 s, 84 caractères Unicode (normalisation NFC) et 17 caractères
  par seconde.
- Essai avec le suivant, puis éventuellement avec le précédent. Un sous-titre
  court reste séparé si aucune fusion ne satisfait ces contraintes.
- Les segments enregistrés ne sont pas modifiés. Les modes desktop supplémentaires
  `source` et `minimum-words` ne sont pas des options de l'interface web.

Dans le commit d'interface `df7a347`, `ASS` émettait encore une ligne Dialogue
par segment. Le propriétaire a ensuite explicitement demandé le portage :
`export_cues.go` applique maintenant les règles ci-dessus sur une copie des cues,
avant la génération ASS partagée par les moteurs local et isolé. Les seuils de
temps utilisent les millisecondes entières du web ; le comptage de caractères
utilise Unicode/NFC via la dépendance Go `x/text` déjà présente, sans normaliser
ni réécrire le texte lui-même. Pas de nouvelle option d'interface.

Les segments de travail, identifiants, corrections et horodatages stockés ne
changent pas. Les exports **SRT conservent les cues originales** pour le montage
externe. Seuls les nouveaux rendus vidéo bénéficient de la fusion ; les MP4
existants ne sont ni remplacés ni invalidés automatiquement. Une fusion peut
afficher ensemble les mots de deux segments sur leur durée commune : c'est le
compromis de lisibilité déjà retenu sur desktop.

Le prochain déploiement doit reconstruire **web et worker**, le worker préparant
l'ASS remis au service média isolé. Aucun changement de migration, profil média
administrateur, secrets ou protection réseau n'est nécessaire. Conserver le
digest egress rétabli par l'administrateur et suivre la procédure normale de
sauvegarde/qualification. Rien n'a été déployé dans ce travail.


## Vérification du bouton (df7a347)

Build TypeScript/Vite et 21 tests UI réussis, dont les parcours complets avec
export FFmpeg réel et téléchargement par la nouvelle action en Low et High.
Les trois formats desktop, Pixel 6 et iPhone 15 sont émulés dans Chromium :
ce n'est pas une qualification Safari/Firefox sur téléphone physique.
Les textes/source/IA sont des fixtures locales ; aucun appel fournisseur facturé.
La capture ordinateur et celle du Pixel ont été inspectées : action principale
active, lien secondaire retiré, bouton entier dans la largeur mobile.

Tests de reprise après échec/annulation, sélection Low/High, invalidation après
retouche, sauvegarde sur blur, IME et conflits entre onglets également réussis.
Journal : `web/.cache/export-download-action.log`.
Captures, enregistrements UI et exports de test conservés dans
`web/.cache/export-download-20260927/`. Rien publié ni redéployé.

## Vérification du regroupement

Tests des exemples desktop, fusion suivante/précédente/en chaîne, pauses,
chevauchement, limites 5/6 s et 7 s, 84 caractères, 17 caractères/s, Unicode/NFC,
offset au-delà d'une heure, absence de mutation, conservation SRT et échappement
ASS. Un rendu FFmpeg réel de deux segments fusionnables est comparé pixel par
pixel à une référence explicitement jointe à la seconde 1. Artefact local :
`web/.cache/media/grouped-fr-high.mp4`.

Vérifications backend complètes avec `go test -race -count=1 ./...`, `go vet`,
build Go et frontend, puis 21 tests UI réussis, dont les parcours synthétiques avec exports et téléchargements
réels (ordinateur, Pixel 6, iPhone 15 sous Chromium). Les premiers essais ont
détecté deux fixtures invalides dans les nouveaux tests (segments sans identité/
arabe et corps de renommage incorrect), corrigées sans changer les contrôles
applicatifs. Journal final : `web/.cache/grouping-auth-20260927-rerun.log`.

Les tests des comptes privés et les décisions/actions pour l'inscription publique
sont détaillés dans [l'audit des comptes](PUBLIC_ACCOUNTS_AUDIT_20260927.md).
Reproduction complète avec les cibles existantes : `make web-test`, puis
`make web-build`. La capture du rendu regroupé à 1 s a aussi été inspectée :
« En effet cette explication reste nécessaire. » apparaît en entier.
