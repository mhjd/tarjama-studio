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

## Écart de regroupement constaté — non modifié ici

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

Dans la version web, `ASS` dans `web/backend/internal/studio/media.go` émet
actuellement une ligne Dialogue par segment, y compris pour le moteur isolé qui
appelle cette fonction depuis `isolated_media.go`. `SRT` dans `subtitles.go`
conserve lui aussi les segments et leurs horodatages. **La parité de regroupement
desktop n'est donc pas présente.** Ce constat répond à la question du propriétaire ;
aucune règle de regroupement, aucun texte et aucun rendu existant n'ont été
modifiés dans ce correctif d'interface.

Pour une reprise ultérieure, porter les règles automatiques et leurs tests de
frontière sur une copie des cues d'export ; ne jamais fusionner les segments de
travail ni changer leurs identifiants. Distinguer cette évolution du téléchargement
SRT fidèle aux segments, et conserver l'absence de réglages supplémentaires décidée
dans `WEB_VPS_HANDOFF.md`.


## Vérification

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
