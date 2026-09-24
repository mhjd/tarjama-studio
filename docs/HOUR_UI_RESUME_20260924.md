# Reprise du parcours d’une heure — 24 septembre 2026

## Intervention administrateur et livraison courte

Le profil `tarjama-download-v1` pointe désormais vers le Docker ID
`sha256:76c8571d850066a9ddc74310ec5fee7b6fc27d53ca68a19d09c23a0c5b54007c`,
source `a4e92c9`. Les autres profils, WARP, TLS et sandbox sont inchangés.
L’essai audio administrateur du 24 septembre à 20:25 UTC a réussi. Ce succès ne
permet pas d’attribuer une cause à l’échec précédent.

Les rapports administrateur sont conservés dans
[`web/review/hour-resume-20260924`](../web/review/hour-resume-20260924/).
Les 48 fichiers copiés dans `web/.cache/real-ui-10min/` ont été revérifiés par
SHA-256 et taille : 125 870 876 octets, tous conformes. Les trois manifestes
indiquent PASS (MacBook Air 15, Pixel 6, iPhone 15, Chromium émulé).

Livraison préparée via le skill `vps-share` sous
`/home/codex/share/tarjama-parcours-10min/` : 52 fichiers, incluant les rapports,
la notice et `SHA256SUMS`. Publication atomique depuis un répertoire temporaire
privé ; originaux conservés. Le propriétaire exécute **`vps pull` sur son Mac**.
La préparation ne prouve pas la réception sur le Mac. Ne pas modifier cette
livraison tant qu’elle attend son transfert.

Des images ont été extraites des MP4 High effectivement téléchargés depuis
l’interface : MacBook à 72 s, Pixel à 2 s, iPhone à 135 s. Sous-titres français
incrustés, blancs sur fond noir, lisibles et contenus dans l’image aux trois
positions examinées. Les captures UI montrent le titre multiligne sur mobile,
le lecteur inférieur et les étapes centrées. Ce contrôle ponctuel ne certifie
pas chaque mot ni toute la synchronisation. Les barres natives de lecture
peuvent masquer les sous-titres lorsque le MP4 est mis en pause ; les images
extraites du fichier n’ont pas cette superposition.

Les trois MP4 ont également été décodés entièrement, audio compris, avec
`ffmpeg -xerror` en conteneur local sans réseau, entrées en lecture seule,
capabilities retirées et ressources limitées : trois PASS, aucun défaut de
décodage. Les trois durées mesurées sont 138,867 s, H.264/AAC 1920 × 1080.
Le journal `short-full-decode.log` est conservé avec les preuves.

## Protocole long

Source identique à l’essai bloqué précédent :
https://www.youtube.com/watch?v=7TLnx8DIu4c, annoncée à 1 h 00 min 10 s.
Run distinct `tenmin_hour2`, schéma `ui_review_tenmin_hour2`, stockage
`/storage/ui-review-tenmin_hour2/`. Aucun média ou projet de l’utilisateur modifié.

Scénario Playwright réutilisable `web/review/record.mjs` : création par lien,
transcription/correction réelles, contrôles d’étapes, lecture/suivi/seek,
édition arabe persistée, validation, traduction, édition française persistée,
export High, téléchargement depuis l’interface et décodage du MP4.

Images identiques à la qualification courte, pinées par digest dans
`web/deploy/preview/ui-tenmin-hour2.yml`. Les images des services applicatifs
restent celles de `active-ten-minute-20260924.yml`. La recette ajoute seulement
le service privé de qualification et les jobs de preuve ; elle n’expose pas le
compte de test sur le domaine public. DeepSeek/OpenRouter, Parallel et Groq sont
réels ; les blocs texte ciblent dix minutes. Aucun changement de prompt ou modèle.

Le worker lit les diagnostics isolés avant ACK et n’en journalise qu’une catégorie
fixe. Aucun diagnostic brut n’est copié dans les logs publics. Le nouvel outil
fournit, uniquement dans le diagnostic privé, une fin de stderr bornée et expurgée.

La traduction entière a terminé à 22:25:40 UTC. Le scénario a vérifié une
modification française, son enregistrement lors de la validation et sa
persistance après rechargement, puis lancé l’export High à 22:25:49.
Durée applicative mesurée : 3 609 181 ms (1 h 00 min 09,181 s). L’export High
a été téléchargé depuis l’interface à 22:55:33, puis lu dans Chromium au début
et au milieu. Les contrôles de durée (tolérance 0,5 s), dimensions non nulles et
images décodées ont réussi. Le manifeste final `reprise-manifest.json` indique
PASS, 3 027 secondes pour cette troisième partie. Le fichier est en 1920 × 1080,
286 191 971 octets. Le rendu seul a pris environ trente minutes.

La vérification en base, en connexion strictement read-only, confirme un projet,
932 segments avec arabe et français non vides, des identifiants distincts,
des temps valides et sans chevauchement, la validation française à la version
courante et exactement cinq jobs réussis. Sept blocs Groq (maximum 600 s),
sept blocs de correction (maximum 599 670 ms) et huit blocs de traduction
(maximum 599 040 ms) ; les reprises courtes n’ont pas modifié les blocs acquis.
Le compteur `attempts` est remis à zéro après chaque morceau validé : sa valeur
finale n’est pas un décompte historique des erreurs ; se reporter aux logs.

Ce n’est pas un parcours sans incident ni un unique enregistrement continu :
les deux premières parties sont conservées avec leur résultat FAIL et la
troisième reprend le même projet après correction. Aucun résultat fournisseur
simulé ou injecté, aucune nouvelle transcription pour masquer un échec.
La recette `ui-tenmin-hour2-export.yml` était préparée au cas où le rendu
excéderait l’attente du navigateur ; **elle n’a pas été appliquée**. Le rendu
a terminé juste avant la limite de trente minutes.

Les preuves longues sont encore sur le volume de qualification. La lecture
par Chromium de deux positions n’est pas un décodage intégral FFmpeg, ni une
revue visuelle de chaque sous-titre : ces contrôles restent à compléter après
la copie administrée décrite en fin de document.

Les reprises observées après le correctif sont conservées dans les logs : une
réponse mal alignée, une réponse tronquée puis une interruption de connexion.
Les mécanismes existants de découpage plus court et de file persistante ont
permis de passer de 48 à 52, puis 68, 77, 94 % et à la relecture complète. Ces
reprises ne prouvent pas que les fournisseurs ne feront plus d’erreur. Elles
montrent ici que les morceaux validés sont conservés et que le traitement peut
aboutir malgré plusieurs réponses inutilisables.

La suite `web-test` du correctif a réussi : Go avec race detector, vet, build
TypeScript/Vite, 39 tests Playwright et restauration d’une sauvegarde de fixture.
Le log complet est `response-recovery-tests.log`. Les trois anciens parcours
courts réels portaient sur la version précédente ; le correctif courant touche
le traitement backend des réponses et son nouveau parcours réel est celui-ci.

## Défaut trouvé pendant la traduction

Le téléchargement et les six opérations de préparation du run `tenmin_hour2`
ont réussi, sans nouvel essai média (le diagnostic montre `media_attempt=0`,
`tries=0`, sorties acquittées avec code 0). La préparation entière a pris environ
29 minutes. Le premier recorder a atteint ses 30 minutes d’attente alors que
Groq transcrivait déjà ; sa vidéo et son manifeste FAIL sont conservés. Ce délai
est celui du scénario, pas un échec du job applicatif.

Le recorder repris avec préfixe `suite-` a retrouvé le projet à `cleaning`.
Les sept blocs de correction ont terminé, puis lecture/suivi/seek, édition arabe,
rechargement et validation ont réussi. Le premier bloc de traduction a été
validé à 21:57:04. Le suivant a échoué à 21:57:39 après un HTTP 200 OpenRouter,
avec la catégorie applicative `unclassified`. Le premier bloc demeure conservé.
Le corps de cette réponse n’a pas été enregistré : sa forme exacte est inconnue.

L’inspection du client révèle deux défauts de gestion : les erreurs présentes
dans un corps HTTP 200 n’étaient pas classées par statut fournisseur ; les
réponses vides et enveloppes invalides devenaient des échecs génériques immédiats.
OpenRouter documente explicitement les erreurs dans un corps HTTP 200 après
acceptation d’une requête, y compris sans streaming :
[contrat des erreurs](https://openrouter.ai/docs/api/reference/errors-and-debugging).
Cela explique un chemin de panne possible, sans prouver lequel a causé l’incident.

Correctif `dab84b9` : lecture du code numérique d’erreur avant toute completion,
respect de la politique 429/5xx et de Retry-After, refus permanents maintenus pour
les credentials/configurations refusés ; réponse vide ou enveloppe invalide →
reprises bornées sur des blocs plus petits ; lecture de réponse interrompue →
attente réseau. Les messages/metadonnées bruts ne sont pas journalisés. Les IDs,
cardinalités et versions restent obligatoires ; aucun résultat invalide accepté,
aucun changement de modèle ni de recherche Parallel.

Le test PostgreSQL injecte une erreur après un premier bloc enregistré : pas de
publication partielle, pas de retry immédiat, pas de recalcul du premier bloc,
publication complète après reprise. Les cas HTTP 200/401, 402, 429, 502, 503,
erreur sans statut et réponse vide sont couverts. Les outils clients inattendus
et refus de contenu restent des échecs explicites, sans exécution locale d’outil.

La reprise `reprise-` est explicitement autorisée à cliquer une seule fois sur
« Réessayer ». Un nouvel échec n’est pas masqué par le recorder. L’image privée
corrigée est `preview.local/atelier/web@sha256:b8e3d72a9effa176443625e5a4f1c3f5978be0b2026652ef71a3cec84b4658e4`.
À cette étape de qualification, les images ouvertes au propriétaire restaient inchangées.
Leur mise à jour finale est décrite ci-dessous.


## Remise des fichiers longs après leur finalisation

Le compte agent ne dispose toujours pas d’un export de fichiers depuis le PVC.
Le skill [vps-preview](/home/codex/.agents/skills/vps-preview/SKILL.md) précise :
« Ne pas utiliser un éventuel accès Docker pour contourner les refus du courtier. »
La référence `isolated-download-20260924.md` ajoute : « Aucun accès général au PVC
ni droit d’enregistrer des profils n’est ajouté. » La demande de copie porte donc
sur une capacité administrée, pas sur une difficulté de code applicatif.
La copie déjà autorisée des preuves courtes n’ajoute pas cette capacité. Ne pas
ouvrir la route privée d’artefacts sur le domaine public, ni utiliser Docker ou
un accès au runtime pour contourner cette frontière.

Demande de copie ciblée à utiliser une fois le manifeste final écrit : volume
`library` d’`atelier`, namespace `preview-atelier`, dossier exact
`/storage/ui-review-tenmin_hour2/artifacts/`, vers
`/home/codex/projects/tarjama-studio/web/.cache/real-ui-10min/ui-review-tenmin_hour2/`.
Conserver les originaux et les tentatives précédentes (préfixe vide, `suite-`,
`reprise-`, puis éventuellement `export-`). Copier uniquement les fichiers
ordinaires de preuve : manifestes/transcription JSON, PNG, WebM et MP4 High.
Aucune base, sauvegarde, clé, cookie ni donnée d’un projet de production.
Copies privées appartenant à `codex`, sans élargir les permissions du volume.
Comparer tailles et SHA-256 aux manifestes, et consigner le résultat de copie.

Après réception, l’agent pourra contrôler les images et décoder entièrement le
MP4 long, puis publier un lot distinct `tarjama-parcours-1h` via `vps-share`.
Ce lot n’est pas encore préparé. Les empreintes et conclusions finales du
parcours sont consignées ci-dessous après sa terminaison.


### Empreintes des vidéos longues à copier

| Partie / fichier | Octets | SHA-256 |
| --- | ---: | --- |
| `parcours-macbook-air15-m4.webm` (attente de préparation expirée) | 52924593 | `0f355cf936aee3bc1a0b7d4b3ebd45d4884284ca98e9a015107b24b61a1c22c8` |
| `suite-parcours-macbook-air15-m4.webm` (échec de traduction) | 18861492 | `dc5eb7e3c1517f6e290019618c7eb7d5b7fff1622509c5723734ca7275c3ba95` |
| `reprise-parcours-macbook-air15-m4.webm` (reprise terminée, PASS) | 115414074 | `7a0a29cc7e4ab636efbe201cf352ad2c0af76ffabdca4422aae9cea8fbea6b42` |
| `reprise-tarjama-7TLnx8DIu4c-macbook-air15-m4-fr-high.mp4` | 286191971 | `34a1aae705b8d24b41cbcb6233de8cf8fd3b403afc2394f69d6faddae68347cb` |

Les captures et la transcription sont listées par chacun des trois manifestes,
à copier également. La synthèse finale est conservée dans
`web/review/hour-resume-20260924/final-manifest-summary.json` ; l’absence du
manifeste optionnel `playback-manifest-validation.json` est normale : cette
qualification distincte n’a pas été exécutée dans ce run.


## Déploiement du correctif après qualification

Sauvegarde réussie à 22:58:08 UTC :
`/storage/backups/pre-response-recovery-dab84b9-20260924T225808Z.dump`,
SHA-256 `2643ed3a12271e58c9dc3215080ddc32dfd615041ae5276903e28a9194759fff`.
Le catalogue de l’archive est lisible par `pg_restore --list` ; ce contrôle n’est
pas une restauration réelle de cette archive. La restauration d’une sauvegarde
de fixture a réussi dans la suite de tests. Les médias restent conservés.

La recette active est
[`active-response-recovery-20260924.yml`](../web/deploy/preview/active-response-recovery-20260924.yml),
révision **`8c6f045bff5432e9`**, URL https://atelier.preview.runagen.com.
API et worker :
`preview.local/atelier/web@sha256:b509c2712780bec713fed4cf93a0ffcf4e15d2d28693cc74628b7e7246f27994`,
code **`dab84b9`**. Seules leurs images changent par rapport à la version de dix
minutes ; egress, base, secrets, réseau, OIDC et protections inchangés.
Aucune migration SQL nécessaire ni exécutée. Le service privé `review` a zéro
réplique ; ses données et toutes les preuves sont préservées sur le volume.
Les services applicatifs sont Ready. Le job `pv-job-preview-check-85fb4385` a
réussi : HTTP, démarrage du flux OIDC et TLS de la passerelle. Le MFA n’est pas
réexécuté, conformément à la confirmation antérieure du propriétaire. La recette
versionnée et le statut vivant portent la même révision.

Pour revenir aux anciennes images, la recette
`active-hour-verified-20260924.yml` conserve leurs références ; cela n’est pas un
retour arrière des données. Aucun rollback n’a été effectué pendant cette remise.
Les échecs déjà terminaux d’anciens projets utilisateurs ne sont pas relancés
arbitrairement par la mise à jour : le bouton « Réessayer » conserve son rôle.
