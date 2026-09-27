# Ouverture des longues transcriptions — 27 septembre 2026

Le propriétaire signale une ouverture lente de « Sirat un nabi » et se demande
si la vidéo doit être entièrement chargée. Optimisation déployée depuis `web-vps` : code `78a5fe2`,
révision `39aef9dd3599278d`.

## Diagnostic et périmètre

Le lecteur utilise déjà `preload="metadata"`. L'API média passe par
`http.ServeContent`, avec des réponses HTTP Range (206). Le nouveau test vérifie
qu'une demande de 1 024 octets ne reçoit que ces 1 024 octets. Cela vérifie le
chemin applicatif local ; ce n'est pas une mesure réseau sur le Pixel de
l'utilisateur, ni une nouvelle qualification du proxy de production.

Le redimensionnement automatique des champs sur mobile alternait, pour chaque
champ, une écriture CSS puis la lecture de `scrollHeight`. Chaque lecture pouvait
forcer la mise en page du document entier. Avec 1 200 segments bilingues, plusieurs
passes (montage, fontes, observateurs) provoquaient des milliers de recalculs.
De plus, chaque lecture de texte recherchait son segment dans toute la liste,
alors que le rendu disposait déjà de ce segment.

## Correction simple

- Réunir les champs à mesurer dans une file commune à la prochaine frame.
- Réinitialiser toutes les hauteurs, lire toutes les hauteurs, puis appliquer
  toutes les hauteurs finales : trois passes séparées, sans alternance lecture/
  écriture par champ.
- Maintenir temporairement la hauteur du document pendant les mesures, pour
  éviter que la réduction des champs ramène la lecture vers le haut.
- Retirer les champs démontés de la file ; conserver l'adaptation à la frappe,
  aux fontes et aux changements de largeur, ainsi que le comportement desktop.
- Lire le texte du segment déjà connu, en gardant la priorité au brouillon local.

Aucune nouvelle dépendance, pagination ou virtualisation. Tous les sous-titres
restent dans le document, pour préserver édition, recherche navigateur, sauts,
suivi de lecture et sauvegarde des champs. Sur des volumes encore plus grands,
le nombre d'éléments DOM reste une limite ; cette correction ne prétend pas la
supprimer. Aucun changement de vidéo, de backend, de modèle ou de données.

## Mesure reproductible

`web/frontend/tests/long-transcript.spec.ts` utilise 1 200 segments synthétiques
(une heure à trois secondes par segment), arabe/français, dont un dixième est plus
long. Même fixture et même conteneur à deux CPU/3 Gio avant et après ; Chromium,
largeurs 412 et 1 440 px. Les mesures CDP distinguent la mise en page des scripts.
Ce n'est pas la transcription privée du projet de l'utilisateur et ce ne sont
pas des temps garantis sur un téléphone physique.

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Ouverture mobile 412 px | 19,165 s | 2,787 s |
| Recalculs de mise en page mobile | 9 610 | 13 |
| Temps de mise en page mobile | 15,506 s | 0,746 s |
| Ouverture desktop 1 440 px | 1,928 s | 1,886 s |

Gain observé : environ 7× sur l'ouverture mobile. Pas de gain significatif
d'ouverture desktop dans cette mesure. Une mesure de référence et deux passes finales proches (2,7–2,8 s),
sans prétendre à une moyenne statistique ni à un benchmark de réseau réel.

Journaux : `web/.cache/long-transcript-before-measured.log` et
`web/.cache/long-transcript-after.log`, puis
`web/.cache/long-transcript-position-fixed.log` pour la version finale avec
maintien de la position (valeurs « Après » du tableau). Les résultats JSON sont aussi joints aux
résultats Playwright. Aucun appel fournisseur facturé.

La première tentative avec le délai d'assertion standard de cinq secondes a
échoué sur l'ancienne version mobile. Pour permettre la mesure de référence,
l'attente du montage a ensuite été bornée à 90 secondes (test entier : 120 s).
Ne pas confondre cet échec de délai avec une erreur de contenu.

## Vérifications finales

Build TypeScript/Vite réussi. 37 tests UI réussis : sauvegarde sur blur, brouillons
hors ligne, conflit entre onglets, composition arabe, lecture pendant l'édition,
navigation et permissions d'étape, exports de test, densité mobile, Haut/Bas et
benchmark long. Après ajout du maintien de hauteur du document, huit de ces cas
ont été rejoués avec succès sur la version finale : longue transcription mobile/
desktop, redimensionnement près du dernier sous-titre, densité et Haut/Bas.

Le benchmark garde désormais un seuil de 100 recalculs de mise en page pour
détecter le retour du problème sans imposer un temps dépendant de la machine.
Les champs longs restent entiers et modifiables ; la réponse média Range est
vérifiée dans les deux dimensions. Pas de nouvelle validation sur téléphone
physique ou avec Firefox Android. Le déploiement ultérieur autorisé est consigné ci-dessous.


## Déploiement autorisé — 2026-09-27 14:10 UTC

URL : https://atelier.preview.runagen.com.
Révision : `39aef9dd3599278d`. Code et image construits depuis `78a5fe2`.
Recette : `web/deploy/preview/active-long-transcript-20260927.yml`.
Seule `services.web.image` est modifiée :
`preview.local/atelier/web@sha256:b9d25a6f0fd9c03ee1e6ce0b68f8f4cbafda5e43cbac212f24c9022a5ba021ef`.
Le bundle construit correspond au build testé (`index-T0dkHtVp.js`).

- Images conservées réimportées aux digests exacts, dont l'ancien web pour rollback
  et le proxy administrateur `19994f1…`. Aucun changement worker, données ou schéma.
- `validate` et `plan` réussis.
- Nouvelle sauvegarde `pv-job-backup-f1fa61d2` réussie avant activation.
- Quatre services prêts ; `partial: false`.
- Qualification `pv-job-preview-check-2282c95d` réussie : HTTPAndOIDCStart,
  SSOHeaders, GatewayTLS. Aucun appel fournisseur facturé.

Preuves : `web/deploy/preview/evidence/deploy-long-transcript-20260927/`.
Ces contrôles ne mesurent pas la vitesse sur le Pixel physique : les gains chiffrés
restent ceux du benchmark local décrit plus haut.
