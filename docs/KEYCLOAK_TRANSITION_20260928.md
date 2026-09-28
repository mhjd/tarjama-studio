# Transition Tarjama vers Keycloak — proposition du 28 septembre 2026

**Préparation uniquement. Aucun accord de migration, déploiement, interruption ou
ouverture publique n'est donné par ce document.** Ne jamais déployer directement
`keycloak-candidate-20260927.yml` sur l’atelier actif : ses six services sont arrêtés.
Les recettes de phase sont elles aussi des artefacts à revoir avant exécution,
pas une séquence à lancer sans contrôle intermédiaire.

## État de départ et preuves

- Actif : `39aef9dd3599278d`, quatre services prêts ; `pv-review` reste arrêté.
  Baseline : `web/deploy/preview/active-long-transcript-20260927.yml`.
- Candidate qualifiée : `9017da632b208055`, images issues de `aebc87f`, 19 Gio.
  [Digests et IDs Docker](../web/deploy/keycloak/images-20260928.json).
- Passation administrateur : `/home/codex/.keycloak-admin-handoff-20260928-final-lpwtsuav/`.
  `images-and-state.json` confirme les six références dans CRI le 28 à 09:04 UTC.
  `qualification.json` : PASS à 09:16:58 UTC sur les images finales web/Keycloak,
  bases synthétiques, TLS vérifié, navigateur sandboxé, vrai tunnel depuis le Mac,
  inscription/isolation/logout/cookies/assets, média privé Range 206 et refus 404
  entre comptes, console privée, limites de requêtes, dump/restauration.
- Complément administrateur : `/home/codex/.keycloak-transition-admin-20260928-y4j4c0ym/`.
  Répétition PASS sur copie restaurée dans K3s : migration 005, simulation,
  association/inversion, utilisateurs rétablis, projets/jobs inchangés et lecture
  des deux projets du propriétaire avec l’ancienne API. CA/certificat durables
  créés ; tunnel Mac → TLS validé → Service K3s → API sur copie vérifié.
  [Preuve et limites](../web/deploy/keycloak/admin-rehearsal-20260928.json).
- Ces preuves restent **isolées** : ancienne API en mode test, session et clé de
  chiffrement synthétiques. Login Authelia réel, déchiffrement des clés fournisseurs
  et reprise métier complète ne sont pas qualifiés. Les sujets des mappings du
  banc sont aléatoires : ne jamais les appliquer aux utilisateurs réels.
- Les unités privées admin/limiteur/renouvellement sont préparées, non activées.
  Le vrai Service `pv-keycloak`, le bootstrap nominatif/MFA et le réglage master
  restent à vérifier pendant les phases autorisées. Le schéma réel est 001–004
  selon le contrôle administrateur à 10:25:55 UTC ; aucun SQL réel appliqué.

Aucune image ne doit changer pour cette transition : le réglage master est une
configuration persistante administrée pendant le bootstrap. L’entrypoint et le
realm Tarjama inclus dans la candidate restent identiques aux images qualifiées.
Une modification ultérieure d’image/digest devra être signalée et requalifiée.

## Responsabilités et portes d'entrée

L’administrateur réalise le raccordement réseau K3s, les upstreams privés, le
certificat durable et son renouvellement, les règles Caddy/HAProxy, le bootstrap
Keycloak et l’exécution contrôlée des opérations de base. L’agent applicatif
prépare les recettes, le binaire de migration et les critères fonctionnels.
Tarjama ne reçoit aucun credential admin Keycloak, Kubernetes ou Docker.

Avant d'exécuter une phase, obtenir l'accord du propriétaire couvrant son impact,
vérifier que la baseline active n'a pas dérivé et conserver les recettes,
révisions et preuves nécessaires au retour. Chaque `deploy` peut recréer aussi
les services inchangés : maintien de `enabled: true` **ne signifie pas zéro
interruption**. Prévoir une fenêtre et prévenir les utilisateurs.

Gates communs : images CRI présentes, DiskPressure=False, réserve de 15 % du disque
après le pic prévu, secrets référencés disponibles sans lecture ni rotation,
PVC/clé de chiffrement/Authelia personnel préservés. Ne pas réutiliser le certificat
éphémère du banc. Ne pas changer le digest egress réparé `19994f1c…5d39a`.

Le frontend public reste fermé aux visiteurs tant que la qualification privée
n'est pas terminée. L'administrateur doit permettre les parcours de test privés
et la discovery OIDC depuis le web K3s vers **l'issuer HTTPS exact**, avec TLS
vérifié et restrictions d'accès appropriées ; il ne suffit pas de bloquer aussi
ces requêtes. Aucun contournement SSRF/TLS, aucune ouverture de master/admin.

## Prérequis immédiats : DNS et fenêtre autorisée

Le contrôle administrateur a trouvé `tarjama.runagen.com` en NXDOMAIN. Le
propriétaire doit créer chez le fournisseur de `runagen.com` : type **A**, nom
**tarjama**, valeur **178.32.16.177**, TTL **300** ou défaut. Ne pas ajouter d’AAAA
sans qualification IPv6. Ce document ne modifie pas le DNS et un enregistrement
DNS ne vaut pas autorisation d’ouvrir l’application.

Après résolution, restent l’accord explicite de maintenance et les contrôles
finaux : images présentes, capacité réelle, absence d’activité incompatible,
point de reprise cohérent et restrictions d’accès. Le TLS public et la discovery
sur l’issuer exact doivent réussir avant 05. Prévoir un créneau de 30 minutes
avec le propriétaire disponible pour MFA et possession du compte ; 10–15 minutes
de coupure constituent un budget prudent proposé par l’admin, pas une mesure.
Aucune phase, même 01–03, ne doit partir avant accord : elles peuvent recréer
les services existants. L’ouverture aux visiteurs demande un accord distinct.

## Recettes et ordre

Les fichiers sont dans `web/deploy/preview/keycloak-transition-20260928/`.

| Phase | Web/worker | Identité | Gate avant la phase suivante |
| --- | --- | --- | --- |
| `01-authdb.yml` | images/configurations actuelles, actifs | authdb actif, Keycloak arrêté | SQL dédié prêt, rôle restreint, stockage et réseau K3s vérifiés |
| `02-private-bootstrap.yml` | actuels, actifs | authdb + Keycloak actifs, bootstrap temporaire monté | schéma/realm importés, bootstrap privé ci-dessous terminé |
| `03-private-identity-ready.yml` | actuels, actifs | identité active, montage bootstrap retiré | connexion admin nominative MFA après redémarrage, ancien bootstrap refusé |
| `04-maintenance.yml` | arrêtés explicitement | db/egress/authdb/Keycloak actifs | arrêt des écritures, sauvegardes restaurables, migrations et mappings validés |
| `05-private-web.yml` | nouveau web actif, worker arrêté | identité active sans bootstrap | deux comptes, isolation, données existantes, session/media/HTTP corrects |
| `06-private-worker.yml` | nouvelles images actives | identité active sans bootstrap | traitement court complet et reprise des files vérifiés en accès privé |
| `07-return-authelia.yml` | anciens web/worker et configuration Authelia actifs | identité privée conservée sans bootstrap | **réservé au retour après contrôles et mappings inverses**, pas à la progression |

Dans toutes les phases, les définitions db/egress et les volumes historiques sont
préservés ; les deux nouveaux volumes restent déclarés, y compris au retour.
Les phases 01/02 conservent les jobs historiques, notamment la sauvegarde de la
base Tarjama seule. À partir de 03, le job de sauvegarde couvre les deux bases
et le job `migrate` utilise l’image web qualifiée. Aucun job n’est automatique.

Les commandes ci-dessous sont un exemple **à exécuter seulement après accord et
contrôle du gate de la phase**, en remplaçant le fichier explicitement :

```sh
vps-preview validate atelier --file web/deploy/preview/keycloak-transition-20260928/01-authdb.yml
vps-preview plan atelier --file web/deploy/preview/keycloak-transition-20260928/01-authdb.yml
# Phase autorisée seulement :
vps-preview deploy atelier --file web/deploy/preview/keycloak-transition-20260928/01-authdb.yml
vps-preview status atelier
vps-preview logs atelier --component authdb
```

Les sept `validate`/`plan` ont été rejoués après correction du courtier, sans
application : [plans actualisés](../web/deploy/keycloak/transition-plan-revised-20260928.json).
Le plan 04 annonce désormais `web` et `worker` dans `services_to_stop` et
`services_disabled`. `services_removed` distingue les retraits ; cette intention
peut inclure un service déjà arrêté et ne remplace pas le statut des pods.
`services_to_reconcile` et `may_recreate_services` signalent les recréations
possibles, même sans arrêt explicite. Le manifeste historique
`transition-qualification-20260928.json` est conservé comme preuve antérieure ;
ses listes d’arrêts vides sont remplacées par celles des plans actualisés.

Ne pas automatiser une boucle `deploy` sur ces fichiers. La readiness n’atteste
ni un bootstrap complet ni une sauvegarde restaurable. Si une étape échoue,
conserver les diagnostics privés, ne pas passer à la suivante.

## Bootstrap privé obligatoire : phase 02

1. Utiliser la CA/certificat durables déjà préparés par l’administrateur. Après
   création du vrai Service, activer le raccordement privé administré qui lit son
   ClusterIP, puis vérifier le certificat. La CA publique est déjà sur le Mac dans
   `~/Library/Application Support/vps/keycloak/ca.crt` ; aucune confiance globale
   n’a été installée. Traiter explicitement la confiance du navigateur après
   vérification de l’empreinte dans `REPORT.md`, sans copier la clé privée de CA.
   Le renouvellement est préparé mais non actif ; son scénario à échéance reste
   à qualifier. Établir le tunnel vérifié :
   `ssh -N -T -o ExitOnForwardFailure=yes -L 127.0.0.1:9443:127.0.0.1:9443 vps`.
   TLS doit être validé avec la CA durable ; aucun `-k`.
2. Attendre authdb, puis Keycloak. Le premier démarrage crée son schéma via
   Keycloak/Liquibase et importe `tarjama` dans sa base **dédiée**, jamais dans
   la base applicative. `--import-realm` ne remplace pas un realm déjà présent :
   en reprise, contrôler son état au lieu de supposer qu'il a été réimporté.
3. Avec le bootstrap administrateur **privé**, lire le realm `master` via l’API
   admin, conserver ses attributs existants et fusionner uniquement :
   **`attributes.frontendUrl = https://localhost:9443`**. Envoyer cette mise à jour
   à `/admin/realms/master`, puis relire et vérifier. Le
   [contrat déclaratif](../web/deploy/keycloak/master-private-contract.json)
   décrit l'état attendu ; ce n'est pas un payload de remplacement aveugle.
   Token/bootstrap restent dans la session opérateur protégée, jamais arguments,
   logs, Git ou secrets montés au web. Aucun lancement de ce réglage maintenant.
4. Vérifier le login complet à `https://localhost:9443/admin/master/console/`,
   l'API admin et l'iframe cookies ; elles ne doivent plus chercher master sur
   le domaine public. Vérifier que `/realms/master/` et `/admin/` publics restent
   refusés. L'issuer du realm **tarjama** doit rester exactement
   `https://tarjama.runagen.com/realms/tarjama`.
5. Créer l’administrateur nominatif, activer son MFA, tester une nouvelle session,
   puis supprimer/désactiver le compte bootstrap et révoquer ses sessions.
   Appliquer 03 uniquement après cette preuve : elle retire son montage et
   redémarre sans dépendre de lui. Ne pas supprimer le secret administré de son
   catalogue dans ce travail. Recontrôler les accès après redémarrage.

`KC_HOSTNAME_ADMIN` seul est insuffisant : l'échec iframe et sa correction ont
été observés dans la qualification administrateur. Le réglage master est conservé
par sa base dédiée ; aucune raison de l’ajouter à l’entrypoint applicatif ou de
monter des credentials admin au service web.

## Maintenance, sauvegardes et migration applicative : phase 04

Avant 04, fermer les admissions côté proxy administré (y compris les requêtes
mutantes de l’aperçu existant), laisser finir les opérations en cours dans une
attente bornée décidée pour la fenêtre, puis arrêter web/worker avec 04.
Ne pas annuler/supprimer arbitrairement les travaux de l’utilisateur pour vider
la file. Vérifier l'absence d'écritures, de worker concurrent et d'opération média
en cours pouvant encore produire des fichiers. Les leases sont de deux minutes ;
leur expiration seule ne prouve pas l'arrêt d'une opération média distante.
Préserver les jobs en attente et leurs chunks. En cas d’activité non stabilisée,
reporter la migration ou définir une reprise explicite avant de continuer.

**Point de reprise cohérent avant toute mutation :** dumps Tarjama/Keycloak,
état des médias nécessaires, recettes, correspondances d'identité et références
aux secrets/clé de chiffrement. Aucun secret dans un dépôt ou rapport. Le job
`backup` n’est qu’une sauvegarde SQL ; ce n’est pas une copie des médias/secrets.
La répétition dispose d’un dump SQL de 2,29 Mo et d’une archive média de 3,608 Go,
privés root : dump restauré sur copie, archive testée et comparée aux fichiers.
Ils ne constituent **pas** le point de coupure final : refaire les dumps après arrêt des écritures et comparer intégralement
l’archive aux médias figés avant toute réutilisation. Si les fichiers diffèrent,
recalculer la capacité avant nouvelle copie et reporter si elle ne tient pas.
Ne pas écraser/purger les copies précédentes pour gagner la place. Les 19,08 Gio
libres observés à 10:25:55 UTC ne sont pas une garantie de capacité future ni de
place pour deux nouvelles bibliothèques complètes.

Après contrôle de capacité, lancer explicitement `vps-preview run atelier backup`,
attendre **Succeeded**, relever taille/SHA256 et tester une restauration dans des
bases distinctes. Un job expiré ne reprend pas ; une nouvelle tentative nécessite
une nouvelle vérification et un nouveau nom. Un nom `.dump` ne prouve rien :
le script historique Tarjama écrit directement le fichier final, qui peut rester
incomplet après un échec ; ne retenir que le résultat complet vérifié/restauré.
Keycloak utilise `.partial` puis renommage. Ne pas prendre un backup partiel de
l’une des bases pour un point de reprise complet des deux.

Inspection SQL **en lecture seule et dans l'environnement administré**, sans
valeurs d’identité dans les journaux publics :

```sql
SELECT name FROM schema_migrations ORDER BY name;
SELECT state, count(*) FROM jobs GROUP BY state ORDER BY state;
SELECT count(*) AS active_leases FROM jobs
 WHERE state='running' AND lease_until>now();
SELECT count(*) AS projects FROM projects;
SELECT count(*) AS users FROM users;
```

Ne pas présumer que 005 manque : relever la base réelle. Le binaire qualifié
embarque 001 à 005 et n’exécute que les migrations absentes. La nouveauté prévue
est `005_oidc_sessions.sql` : colonne `sessions.oidc_sid` avec défaut vide,
index et table des événements de logout ; **aucune suppression de texte/projet**.
L’ensemble est transactionnel et protégé par verrou advisory. Attente de connexion
bornée à 90 s, traitement 240 s, job 300 s ; aucune migration automatique au
lancement de web ou worker. Ne pas démarrer le nouveau web tant que 005 manque.

Après sauvegarde/restauration réussie et accord de migration :

```sh
vps-preview run atelier migrate
vps-preview logs atelier --component migrate
vps-preview status atelier
```

Exiger Succeeded, vérifier la présence de 005 et les compteurs. Aucun `down SQL`
n’est prévu : 005 est additive, les anciennes images n'utilisent pas ses ajouts.
Le code source de l’ancienne API (`78a5fe2`) utilise des colonnes explicites
pour lire/insérer les sessions, compatibles avec l’ajout de 005 et son défaut.
La répétition administrateur a vérifié ce retour avec les images exactes sur
copie restaurée : l’ancien binaire de migration accepte 005 et l’ancienne API
retrouve les deux projets après inversion. Cela ne qualifie ni un vrai login
Authelia ni les clés fournisseurs ; les vérifier lors du retour réel si nécessaire.
En cas d'erreur transactionnelle, garder web/worker arrêtés et examiner le schéma
avant de relancer, jamais de `DROP` improvisé.

## Comptes existants : association explicite, pas par email

Les espaces restent indexés par `(issuer, subject)` et UUID utilisateur Tarjama.
Un changement d'issuer sans association crée un espace neuf et ne retrouve pas
les projets existants. Créer le compte cible du propriétaire via l’admin privé,
vérifier sa possession et son UUID Keycloak **avant son premier callback Tarjama**.
Aucune preuve par email non vérifié, aucune fusion automatique.

L’opérateur prépare hors Git un JSON 0600 par utilisateur approuvé :

```json
{
  "user_id": "UUID_TARJAMA_EXISTANT",
  "old_issuer": "ISSUER_SOURCE_VERIFIE",
  "old_subject": "SUBJECT_SOURCE_VERIFIE",
  "new_issuer": "https://tarjama.runagen.com/realms/tarjama",
  "new_subject": "UUID_KEYCLOAK_VERIFIE"
}
```

Préparer également l'inverse en échangeant les paires old/new, même `user_id`.
Conserver un journal privé des mappings effectivement appliqués : chaque fichier
est une transaction, pas toute la liste. Le binaire refuse une source différente
ou une cible déjà rattachée et ne fusionne jamais. S'il existe déjà un espace
cible, arrêter et examiner ses données, ne pas le supprimer pour forcer le passage.

L’exécuteur root borné est désormais installé et qualifié sur copie :
`/usr/local/sbin/vps-keycloak-identity-link`. Il fixe l’image web et la commande,
monte uniquement l’accès DB applicatif et le JSON privé (root 0600, 16 Ko maximum),
sans médias, clé IA, token Kubernetes ou credential admin Keycloak dans le Job.
Simulation par défaut, durée 300 s, aucun retry automatique ; retrait des ressources
temporaires et journaux privés. Aucun nouveau privilège au compte codex.

Commandes **administrateur, pendant la fenêtre autorisée seulement** :

```sh
sudo /usr/local/sbin/vps-keycloak-identity-link --mapping /CHEMIN/PRIVE/map.json
# Après simulation, point de reprise et accord de migration :
sudo /usr/local/sbin/vps-keycloak-identity-link --mapping /CHEMIN/PRIVE/map.json --apply
```

`--apply` exige web/worker arrêtés, mais le garde-fou ne remplace pas l’accord
humain. L’outil ne crée pas le compte cible, ne vérifie pas sa possession et ne
ferme pas lui-même l’application. Ne pas utiliser les JSON synthétiques du banc.
`vps-preview run` n’invente pas ce job : le montage privé reste hors des recettes.

Pour un environnement opérateur où ce binaire et la DB sont déjà configurés,
le raccourci existant est `make web-identity-link ARGS='--file CHEMIN_PRIVE'`, puis
`--apply`. Ce raccourci n'établit aucun tunnel/credential à lui seul : ne pas le
lancer depuis l'hôte en supposant un accès implicite à la base du cluster.

Après application : UUID, projets, transcriptions/traductions, clés personnelles
chiffrées et médias restent attachés au même utilisateur ; ses sessions sont
révoquées. Vérifier ces invariants. Puis révoquer les autres sessions et flows
OIDC de l'ancienne origine dans une transaction administrée explicitement revue
(`DELETE FROM sessions; DELETE FROM login_flows;`) : déconnexion générale voulue,
sans suppression de comptes. Les utilisateurs non migrés gardent leurs données,
mais ne pourront pas les ouvrir avec une nouvelle identité non associée.

## Qualification privée puis ouverture : phases 05 et 06

Avant 05, raccordement privé K3s + certificat durable + règles de refus + limiteur
actifs dans le périmètre autorisé. Vérifier la discovery depuis le web vers l’issuer
exact, puis la readiness. Le worker reste arrêté : les requêtes de test peuvent
mettre en file des jobs, mais aucun fournisseur ne doit être sollicité par surprise.

Exiger : login/inscription/logout sur le domaine exact ; cookies Secure/HttpOnly ;
propriétaire retrouvant ses projets et corrections ; second compte vide et refus
404 sur projets, médias et mutations d’autrui ; édition conservée ; Range 206 ;
assets ; master/admin/account/autres realms/health/metrics publics refusés ; console
privée, MFA et révocation back-channel ; réauthentification après révocation.
Authelia personnel et l'aperçu privé ne doivent pas exposer de chemin alternatif
contournant ces protections. Coordonner la fermeture/redirection de l'ancien hôte
pendant la bascule : aucun login Authelia accidentel sur le nouveau backend.

Après validation, appliquer 06 seulement si la reprise des anciens jobs en file
et les appels payants correspondants sont acceptés. Vérifier absence de doublons,
reprise des chunks, correction puis traduction et export sur un média arabe court
avec un compte de test dédié. Les tests média/IA complets n’ont pas été exécutés
par la qualification administrateur. Le rendu regroupé est inclus dans cette
version ; conserver les données et artefacts de l'utilisateur pendant le test.

Limites préparées/qualifiées en isolé : 5 POST inscription/min/IP, 20/min global,
300 requêtes identité/10 s/IP, 429 et Retry-After 60/10 ; faux X-Forwarded-For
refusés/écrasés. Rejouer les contrôles côté K3s/proxy réel sans saturer les
utilisateurs. Ces limites ne sont pas une garantie anti-DDoS.

**Ouverture à des visiteurs : accord explicite distinct si l’accord de transition
ne la couvre pas.** Tant qu’il manque, garder les restrictions privées. L’activation
des routes publiques ne découle ni d'un PASS ni du nom `06-private-worker.yml`.

## Retour arrière

| Situation | Action après autorisation, sans effacer les données |
| --- | --- |
| Échec authdb/bootstrap avant association | Fermer le chemin d’identité préparé ; rétablir la baseline active ou la dernière phase saine. Aucun mapping à inverser. Les nouveaux PVC et dumps restent conservés. |
| 005 échoue | Garder la maintenance, vérifier le rollback transactionnel, puis reprendre l'ancien web/worker si le schéma et le point de reprise sont sains. |
| 005 réussit, aucun mapping appliqué | Conserver les ajouts de schéma ; après contrôle, revenir à 07 si l'identité privée est saine, sinon à la baseline autorisée. |
| Des mappings ont été appliqués | Fermer admissions/public, arrêter web/worker avec 04, figer un nouveau point de reprise. Appliquer uniquement les mappings inverses des opérations effectivement réussies ; vérifier UUID/projets et révoquer sessions/flows. Puis 07 et remettre le routage Authelia de l’aperçu. |
| Nouveaux utilisateurs ou nouvelles éditions après bascule | Conserver ces comptes, textes, médias et données Keycloak. Les nouveaux comptes Keycloak n'ont pas automatiquement une identité Authelia : leur accès peut rester suspendu pendant le retour, sans suppression/fusion. Revoir la compatibilité des nouveaux jobs avant reprise de l'ancien worker. |
| Corruption nécessitant restauration | Restaurer dans de nouvelles bases isolées, conserver les bases/dumps source, vérifier schémas, identités, textes et cohérence médias/secrets avant une nouvelle bascule autorisée. Ne pas écraser la base active avec `--clean`. |

`vps-preview rollback atelier --revision 39aef9dd3599278d` restaure seulement la
configuration Kubernetes historique et peut retirer des composants de la recette ;
il ne restaure ni SQL, ni identité, ni proxy administré. Ce n’est donc pas le retour
automatique après mapping. La phase 07 conserve les volumes et l'identité privée
et rétablit explicitement les anciens web/worker. Aucun effacement de 005, de la
base Keycloak ou des données créées depuis la bascule n’est autorisé par le retour.
Le routage Caddy/HAProxy se rétablit séparément via l’admin, en gardant master privé.

## Sauvegardes locales : contrat et limite actuelle

Hors VPS reporté par décision du propriétaire ; perte totale du VPS toujours
possible. Ne pas l’annoncer comme une sauvegarde hors machine ni demander une
destination payante/Mac pour cette préparation. Conserver tous les dumps actuels.

Contrat proposé pour les **nouvelles** générations Keycloak : trois au maximum,
512 Mio cumulés dans `identity-backups` (1 Gio), marge de travail vérifiée avant
chaque dump, permissions 0600, SHA256, validation et restauration avant retrait
d’une génération remplaçante. Les scripts actuels ne programment ni rétention,
ni contrôle automatique de ces plafonds : l’opérateur doit les contrôler ; aucune
purge ou planification n’est activée ici. Les copies historiques sont hors purge
implicite : si elles empêchent le prochain dump dans les limites, arrêter et faire
revoir la capacité. Une taille PVC n'est pas un quota physique garanti.

## Reproduction de la préparation

```sh
make web-keycloak-transition ARGS='--active web/deploy/preview/active-long-transcript-20260927.yml --candidate web/deploy/preview/keycloak-candidate-20260927.yml --output-dir web/.cache/transition-review'
make web-keycloak-transition-test
```

Le générateur refuse d'écraser des fichiers existants, de changer l’egress/db,
les volumes historiques, une baseline inattendue ou des placeholders d’image.
Il ne contacte aucun service et ne déploie rien. Les sept fichiers ont été passés
à `validate` et `plan` uniquement ; preuves et révisions dans le manifeste de
préparation joint. Les tests vérifient les invariants de continuité, maintenance,
images, bootstrap et retour ; aucun nouveau test sur des données réelles.
