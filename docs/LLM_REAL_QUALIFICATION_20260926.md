# Qualification réelle des corrections de fiabilité — 26 septembre 2026

Le propriétaire a autorisé le déploiement puis les essais réels (« vas y »).
Le code applicatif est celui de `eadd083` ; `995ff89` ajoute le plafond de campagne
et embarque le corpus de références dans le serveur de qualification.
Cette campagne complète les tests déterministes décrits dans
[les corrections structurelles](LLM_RELIABILITY_FIXES_20260926.md).

Les deux parcours réels ont abouti jusqu'au téléchargement du MP4 High et à sa
lecture dans Chromium. Le long a récupéré deux réponses IA incomplètes et nécessité
deux enregistrements du navigateur. Le dernier correctif d'affichage, `950435b`,
passe 47 tests UI. L'inspection visuelle des fichiers réels reste bloquée sur leur
copie administrée ; les captures simulées iPhone/Pixel ont été examinées.

## Livraison

- Sauvegarde fraîche réussie : `pv-job-backup-fefe770d`, fichier
  `/storage/backups/pre-automatic-recovery-20260926T093537Z.dump`, SHA-256
  `2f8ca8371d5b3e8dd63c62dbfa1b7ac33cffb7707e233546b21628def7426925`.
- API et worker arrêtés par la recette de migration ; PostgreSQL et egress conservés.
- Migration additive réussie : `pv-job-migrate-bc2f02a9`.
- Recette active `web/deploy/preview/active-reliability-20260926.yml`, révision
  `8b0ca231fa008469`, quatre services prêts.
- `pv-job-preview-check-87bc180d` : HTTP/OIDC start, en-têtes SSO et gateway TLS passent.
  Ce contrôle ne simule pas le MFA, déjà confirmé séparément par le propriétaire.

Les reçus non secrets sont conservés dans
`web/deploy/preview/evidence/reliability-20260926/`. Les images sont construites
localement et importées par digest, sans GHCR ni GitHub Actions.

## Protocole

Parcours Playwright réel, fournisseurs Groq/OpenRouter (Luna medium), outils
Parallel et corpus local réels ; moteur média isolé administré et WARP inchangés.
Le serveur privé utilise un schéma PostgreSQL et un dossier distincts des projets
du propriétaire. Aucun résultat IA n'est injecté pour faire passer le test.
Les scripts courants sont montés par configuration dans le navigateur de test.
Le vieux digest du navigateur avait été évincé du cache : il a été réimporté
depuis son image Docker correspondante, sans changer la politique de téléchargement.

Ordre prévu : vidéo arabe de 2 min 19 s (`gbrDbQVYDuQ`), puis d'environ une heure
(`7TLnx8DIu4c`) seulement après succès du parcours court. Les captures utilisent
Chromium et les viewports iPhone 15 (393 × 852 CSS pixels, court) et Pixel 6
(412 × 915, long), pas des téléphones physiques ni Safari. Les tests responsive
déterministes couvrent également l'ordinateur.

Le script contrôle le suivi de lecture, le déplacement temporel, la sauvegarde
sur blur/rechargement, la validation des étapes, l'absence de champs éditables
pendant la traduction, l'export français High téléchargé par l'interface et son
décodage au début et au milieu. Les PNG, WebM, MP4 et manifestes sont conservés.
Une erreur terminale arrête le scénario ; elle n'est pas transformée en succès.

## Borne de dépense

La campagne `reliability_20260926` partage un registre persistant entre court et
long : 2 USD de réservations conservatrices, initialement 60 requêtes payantes,
et aucune nouvelle requête après 90 minutes. Une facture inconnue conserve sa
réservation. Un redémarrage ne remet pas ce registre à zéro. Ce garde-fou est
propre à la qualification ; il ne remplace pas un plafond contractuel fournisseur.
Les prix utilisés sont ceux du catalogue OpenRouter observé le 26 septembre,
avec marge pour les tours internes et les outils, et Whisper-large-v3 à 0,111 USD/h.

Le commit `8a808dc` porte le plafond secondaire à 120 requêtes : sept blocs,
deux passes et six échanges maximum par génération peuvent légitimement demander
84 requêtes, hors ASR et parcours court. Le plafond financier et le délai restent
inchangés. Le registre n'est jamais effacé ni remboursé artificiellement. Cette
extension a été appliquée avec la reprise du navigateur ; les étapes IA du parcours
long ont terminé avant son application et n'ont pas atteint le plafond initial.

## Résultats

Le parcours court a réussi le 26 septembre de 09:44:01 à 09:49:11 UTC, soit
310 secondes. Job `pv-job-ui-reliable-short1-d4aae082`, succès confirmé par le
courtier et le manifeste Playwright. Durée source : 138 867 ms. Aucun retry IA :
une requête de correction (12,347 s), une requête de traduction (8,099 s), toutes
deux valides. Les diagnostics ne déclarent aucun outil local exécuté ; le compteur
web est inconnu, donc on ne transforme pas son absence en preuve de zéro recherche.
Coût OpenRouter retourné : 0,002503975 USD. Groq ne retourne pas de coût dans cette
réponse : réservation conservatrice de 0,03 USD conservée, sans l'appeler facture.

Le fichier High téléchargé par l'interface fait 27 361 071 octets, SHA-256
`a188552178f106deaebfcde351b774a4860979e13ef5620bedc8beb40a44205c`.
La capture `parcours-iphone15.webm` fait 7 952 733 octets, SHA-256
`67b7eb3a78ab65130ee3baef9d41ffb718d60e94e36af851edb5ef0cfff08701`.
Le navigateur a décodé des images au début et au milieu, vérifié les dimensions
et la durée. L'examen visuel des PNG et le décodage intégral restent à faire après
la récupération administrée des fichiers ; ce résultat ne certifie pas toute
la qualité linguistique.

Le parcours long, job `pv-job-ui-reliable-hour1-68b000d4`, a commencé à
09:50:30 UTC. Les essais historiques indiquent environ trente minutes de
préparation et trente minutes de rendu pour cette source. Le courtier limite
un job navigateur à 3 600 s ; son script s'arrête à 55 minutes pour préserver
les preuves. La recette `ui-reliable-hour1-resume.yml` a été préparée et validée
avant cette échéance : même schéma, même budget, nouveaux noms `suite-`,
aucun retry manuel de job en échec. Une limite d'enregistrement n'est pas un
échec applicatif et ne justifie pas un nouveau projet payant.

La préparation et les sept blocs Groq ont terminé ; la correction arabe a été
publiée à 10:28:14 UTC, la traduction à 10:33:04. Durée source : 3 609 181 ms.
Une réponse de correction était incomplète à 10:25:24 ; une réponse de traduction
également à 10:31:27. Dans les deux cas, reprise automatique sur un bloc plus court,
conservation des acquis et progression jusqu'à la relecture, sans clic de retry,
changement de modèle ou injection de résultat. Le test a ensuite vérifié la
sauvegarde française et lancé l'export High à 10:33:13 UTC.

### Ajustement UI révélé par l'essai

Le message technique de reprise était bien caché, mais `waiting_provider` faisait
encore disparaître la barre et apparaître un bouton « Réessayer ». `950435b`
traite les reprises texte sans message public comme du traitement en cours :
barre conservée, annulation disponible, aucune action de retry sollicitée.
Les attentes fournisseur accompagnées d'un message et les échecs terminaux
restent visibles. Le backend ne change pas d'état ni de politique de reprise.

Build TypeScript/Vite et **47 tests Playwright réussis**, dont correction et
traduction en reprise silencieuse, vraie attente fournisseur et échec terminal.
Les trois parcours simulés et les contrôles responsive/clavier/navigation passent.
Preuves : `web/review/reliability-real-20260926/`. Les étapes IA réelles ci-dessus
ont utilisé le frontend précédent ; cette distinction ne doit pas être effacée.
Le résumé de campagne conserve désormais les audits complets en fichiers privés
et n'en imprime qu'une synthèse : les logs du courtier tronquaient les longues
lignes contenant toutes les tentatives, sans perte dans la base applicative.

À 10:45:30, le navigateur atteint son délai de 55 minutes pendant l'export :
`Bounded wait exhausted at export-fr`, 3 301 secondes. Son manifeste FAIL est
conservé comme tel ; aucun job applicatif n'est alors en échec. Première capture
Pixel : 66 466 072 octets, SHA-256
`f8662cc8c0ac84d9fd4e45a1fe39b47520e2dbecfe22d67807ac844fa16c529d`.
La recette de reprise utilise `950435b` (UI corrigée, même backend métier) et
conserve le même schéma, le même registre financier et l'export déjà demandé.

À 10:47:12, la seconde partie retrouve `ready` et `export_fr_high:running:33`.
Elle ne déclenche aucune nouvelle génération ni nouvel export. L'audit complet
retrouvé après redémarrage confirme 16 tentatives texte : 14 succès, les deux
réponses incomplètes décrites ci-dessus, 44 requêtes OpenRouter et 40 exécutions
locales. Sept morceaux validés de correction et sept de traduction. Le coût
OpenRouter du long est de **0,083856865 USD**, reprises comprises ; celui de la
campagne court + long est de **0,086360840 USD**. Huit appels Groq n'ont pas de coût
retourné : **0,24 USD de réservations** restent retenus, pas présentés comme
facture. Total comptablement engagé par le garde-fou : **0,326360840 USD**, sur
2 USD. Les 54 requêtes payantes de la campagne tenaient dans le plafond initial.
Le registre n'a donc pas bloqué les traitements ni été réinitialisé.

Audit complet privé préservé : `suite-review-diagnostics-1790419642018.json`,
10 654 octets, SHA-256
`df94ae3bbea18c389cea8f12d378db4098415a845b736a69a7499b73364ee732`.
Sa synthèse exploitable est dans `hour-audit-summary.json` parmi les preuves
de déploiement. Le fichier complet n'est pas encore copié du PVC.

### Export long terminé

Le MP4 High français a été téléchargé par l'interface à **11:03:58 UTC**,
puis décodé dans Chromium au début et au milieu à 11:04:04 et 11:04:10.
Durée, dimensions non nulles et images décodées vérifiées par le même scénario
que le court. La reprise `suite-manifest.json` est **PASS**, 1 024 secondes,
job `pv-job-ui-reliable-hour1-ee97bc92`. L'export a pris environ 30 min 45 s,
dont la récupération après redémarrage ; le parcours total s'étend sur environ
1 h 14 min, avec deux enregistrements et sans recommencer les étapes IA.

- MP4 : 286 326 481 octets ; SHA-256
  `bd9dde4a7cbce00dc079d438c275065912afd8a2c2cb393b4507f0cf04edd19a`.
- Deuxième capture Pixel : 23 622 918 octets ; SHA-256
  `75b40a861c0fd22b651db30b97698ebe83ad01fcf8caf91d5e941d2a552cbc42`.

Ce succès fonctionnel ne transforme pas la première limite du navigateur en PASS,
ni les deux réponses IA incomplètes en premières tentatives réussies. Il montre
leur récupération sans intervention sur le projet. L'examen visuel des captures
réelles et le décodage intégral des MP4 attendent encore la copie administrée
[décrite précisément ici](RELIABILITY_ARTIFACT_COPY_20260926.md).

### Observation de performance

Le propriétaire signale que la source est visuellement statique. Le code actuel
appelle néanmoins `tarjama-normalize-v1` systématiquement pour la préparation,
jusqu'en 1080p, puis `tarjama-export-v1` pour incruster les sous-titres. Les profils
ont deux CPU alloués. Une future optimisation devrait qualifier un chemin sans
réencodage pour les flux déjà compatibles navigateur, en conservant les contrôles
média, la validation de sortie et la publication atomique. Une image fixe ne
permet pas de supprimer arbitrairement la piste vidéo ni d'en changer la cadence.
Cette optimisation n'est pas incluse dans les images de la campagne présente.

## Remise des preuves

Les fichiers sont initialement écrits sur le volume `library`. Le compte agent
ne dispose pas d'un export général de ce volume. La récupération doit utiliser
une copie administrée ciblée des seuls artefacts de qualification, sans publier
la route privée ni contourner cette frontière avec Docker. Les originaux doivent
être conservés ; après copie, comparer tailles/empreintes aux manifestes avant
publication atomique d'un lot via le skill `vps-share`.

## État final du déploiement

Application active sur <https://atelier.preview.runagen.com>, révision
**`5dcf2e33fbe5a269`**, recette
`web/deploy/preview/active-reliability-final-20260926.yml`. Web, worker,
PostgreSQL et egress sont Ready ; le service de qualification `review` est arrêté.
Aucun calcul de qualification ne reste actif. Les artefacts sont conservés.

- API/frontend testé `950435b` :
  `preview.local/atelier/web@sha256:410c1ab468ed32eced5aaf9ef1acdb6ca734063712829c6ee234d08848c081cf`.
- Worker métier inchangé depuis la qualification initiale (`995ff89`, correctifs
  structurels `eadd083`) :
  `preview.local/atelier/web@sha256:f1cb5868136b5ba4947481ec008eb43246010b183b9ac0d17861a0a6a2be9f9e`.
- Serveur de qualification final, désormais arrêté :
  `preview.local/atelier/web@sha256:1a5f07756521d1cfb6c2bb232237c2765f0670b61dd8acd94ed98f7237bca389`.

Le contrôle final HTTP/OIDC start, en-têtes SSO et gateway TLS passe après retrait
du serveur de qualification. Les preuves sont `final-status.json` et
`final-check-logs.json`. Aucune nouvelle migration pour le dernier ajustement UI.
La demande de copie des fichiers finalisés a été remise au propriétaire ; tant
que cette copie n'est pas disponible, ne pas annoncer les vidéos envoyées sur Mac
ni une revue visuelle de tous les sous-titres du rendu réel.
