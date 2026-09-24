# Enregistrements des parcours réels

Qualification explicitement demandée par le propriétaire le 23 septembre 2026.
Le MFA est confirmé séparément par le propriétaire. Aucun compte SSO, cookie ou
credential de production n'est utilisé par le navigateur de test.

`make web-review-images` construit deux images distinctes, exclues des cibles
`api` et `media` de production :

- `ui-review` : API et worker réels, schéma `ui_review_20260923`, répertoire
  `/storage/ui-review-20260923`, identité locale de test. Fournisseurs OpenRouter/DeepSeek et Groq
  réels et opérations média via le courtier administré. Aucun traitement FFmpeg
  ou yt-dlp exécuté dans ce service. Durée bornée à trois heures.
- `ui-recorder` : Chromium et Playwright, sans secret, sans volume applicatif,
  sans accès Kubernetes/Docker. Communique uniquement avec le service privé de
  qualification ; son proxy écoute exclusivement sur loopback. Les opérations UI
  réalisent les téléchargements des exports, puis les artefacts sont conservés
  dans le répertoire de qualification par transfert HTTP privé.

Le service de qualification ne remplace pas `web`, n'est pas routé par la
passerelle publique et ne dispose pas de secrets OIDC. Sa connexion de test ne
s'applique qu'au schéma séparé. Ne jamais publier cette image ou ses routes
`/review-artifacts` sur le service `web`.

Les parcours utilisent la vidéo entière `b1MKJ5gHig0`, sans faux fournisseur ni
réponse API simulée. Les enregistrements conservent les attentes réelles. Le script
vérifie création, préparation, transcription/correction, lecture, suivi,
déplacement temporel, édition et sauvegarde après rechargement, traduction,
relecture et exports High français téléchargés par clic dans l'interface.
Les exports téléchargés sont ensuite ouverts pour inspecter leur rendu vidéo.

Formats CSS émulés, sans barres du navigateur ou système :

| Format | Fenêtre CSS | Densité | Moteur |
| --- | --- | --- | --- |
| MacBook Air 15 M4 | 1440 × 932 | 2 | Chromium Linux |
| Pixel 6 | 412 × 915 | 2,625 | Chromium Linux |
| iPhone 15 | 393 × 852 | 3 | Chromium Linux |

Ce sont des tests responsive, pas des tests matériels ni une qualification Safari.
Les tailles natives de référence sont documentées par
[Apple MacBook Air](https://support.apple.com/en-ie/122210),
[Google Pixel](https://support.google.com/pixelphone/answer/7158570?hl=en) et
[Apple iPhone](https://support.apple.com/en-sg/111831).
Les fichiers vidéo des parcours utilisent les dimensions CSS pour leur lisibilité.

Le manifeste associe noms, tailles et SHA-256. Aucune valeur secrète ni contenu de
projet utilisateur existant n'est inclus. La procédure de remise des fichiers sera
fournie séparément par le propriétaire. Ne pas supprimer les artefacts avant remise.
Une recette finale doit désactiver/retirer le service temporaire, tout en préservant
les artefacts sur le volume ; conserver le schéma de test tant que des opérations
média doivent encore être acquittées. Aucune suppression du schéma `public`.

## Blocage fournisseur et preuves partielles

`playback.mjs` utilise la vidéo et la transcription réelles déjà préparées pour
contrôler lecture, suivi et déplacements sur les trois formats. Il ne prétend
pas qualifier correction, traduction ou export lorsque Gemini les bloque.
Sa seconde série conserve les noms `lecture-suivi-validation-*`, distincts des
premiers essais. Les manifests précisent ce périmètre partiel.

`summarize.mjs` lit uniquement les manifests de qualification et imprime les
résultats ainsi que les noms/tailles/empreintes des vidéos. Les journaux du courtier
étant bornés, les fichiers binaires restent sur le volume ; ne pas les encoder dans
les logs. La recette monte ces deux scripts publics en ConfigMap sur le navigateur
ou lecteur sans secret, avec uniquement une connexion au service `review`.

## Relances indépendantes

Le serveur de qualification accepte `UI_REVIEW_RUN` (minuscules, chiffres et
underscores, 40 caractères maximum). Chaque run dispose de son schéma et de son
répertoire `/storage/ui-review-RUN`. Les uploads d'artefacts refusent désormais
d'écraser un nom déjà présent. Employer un run nouveau pour chaque enregistrement
complet ; conserver les anciennes preuves. Le défaut historique reste `20260923`.

`make web-review-prepare` prépare une recette depuis la recette active actuelle,
avec `REVIEW_BASE`, `REVIEW_IMAGE`, `RECORDER_IMAGE`, `REVIEW_RUN` et `REVIEW_RECIPE`.
Il reprend uniquement la définition du service de test de la recette historique,
jamais ses anciennes images de production. Après revue, validate/plan et activation
explicitement autorisée, lancer le job `ui-RUN` (underscores remplacés par tirets)
via `make web-preview-run PREVIEW_JOB=...`. Le job `results-RUN` lit le manifeste.
Le générateur remplace les jobs de la recette fournie ; les autres migrations ne
sont pas lancées. Retirer ensuite le service de test via la recette active finale.

Le générateur monte `record.mjs`, `record-support.mjs` et `record-export.mjs` depuis le dépôt en
configuration publique. Cela permet de corriger/rejouer les interactions sans
reconstruire Chromium ; l'image du navigateur reste épinglée par digest.
Les fichiers sont séparés pour respecter la limite de taille de chaque
entrée de configuration du courtier. Les changements de backend nécessitent
toujours une image de qualification construite depuis le code à tester.

## Parcours de septembre 2026 avec routes et blocs de dix minutes

Fournir `REVIEW_VIDEO` (URL YouTube canonique) et `REVIEW_DEVICE`
(`macbook-air15-m4`, `pixel6` ou `iphone15`) à `make web-review-prepare`. Un seul
format par `REVIEW_RUN` évite de contourner la règle contre les liens dupliqués
dans un même compte. Réutiliser un run terminé écraserait des preuves : choisir
un nouveau nom pour rejouer intégralement. Les secrets de Gemini sont retirés
du service temporaire ; la clé OpenRouter reste uniquement dans son backend.

Le parcours recharge les URL de projet directement, contrôle l'absence des
champs pendant correction/traduction, les étapes inaccessibles et le retour en
haut après validation. Un état de job `failed` interrompt la qualification et
conserve les preuves ; une attente fournisseur reste suivie pendant au plus
30 minutes par phase, avec une limite de tâche administrée d'une heure.
Le manifeste donne la source exacte, le format et le résultat réel.

## Reprendre une préparation longue sans refaire les appels

Si le recorder atteint son attente bornée alors que le worker continue, conserver
le même `REVIEW_RUN` et ajouter `REVIEW_RESUME=1 REVIEW_ARTIFACT_PREFIX=suite-`
à `make web-review-prepare`. La reprise accepte uniquement un projet dans le
schéma de test, dont l’URL est celle demandée.
Elle ouvre sa carte depuis la bibliothèque et poursuit les vérifications à partir
de l’étape actuelle : arabe, traduction ou export. Les étapes antérieures ne sont
pas rejouées et ne sont pas qualifiées de nouveau par ce morceau d’enregistrement. Aucun résultat IA n’est injecté ou remplacé.
Un nouveau préfixe est obligatoire pour conserver les premières captures, vidéo
et manifeste. Le manifeste indique `resumed: true` : les deux enregistrements
sont des parties distinctes, pas une seule preuve continue ni un premier PASS.

Ne pas remplacer le scénario d’un navigateur en cours : attendre son résultat et
conserver ses logs avant d’appliquer la recette de reprise autorisée. Le lecteur
`results-RUN` utilise aussi le préfixe. Un changement de service de test relance
son worker ; les opérations persistantes et morceaux validés restent conservés.

L’export est transmis au stockage de preuve depuis le fichier téléchargé par le
navigateur, sans `saveAs` créant une deuxième copie dans le tmpfs. La limite de
fichier et les limites de mémoire restent applicables. Les contrôles de durée,
dimensions et lecture de l’export sont inchangés.
