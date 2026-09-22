# Aperçu privé Tarjama — préparation du 22 septembre 2026

Cible : `atelier`, `https://atelier.preview.runagen.com`, moteur générique
`vps-preview` 6.5.0. Branche `web-vps`. Aucun déploiement, job de courtier,
publication d'image sur un registre ni reconfiguration des services existants.
Les deux images applicatives ont été importées dans le cache local du nœud, sans activation.
La validation du moteur sur une application synthétique ne qualifie pas Tarjama.

## Recette et images locales — mode retenu

Le workflow GHCR a été archivé hors de `.github/workflows` dans
`web/deploy/preview/web-preview-images.yml.disabled`. Il ne reçoit plus de push ni
de demande manuelle sur `web-vps`. Le seul run précédent est terminé : tests
réussis, contrôle de visibilité GHCR bloqué après une image scratch vide ; aucune
image applicative publiée. Les scripts GHCR historiques restent inactifs.

Construire localement, puis importer sans déploiement :

```sh
make web-images
make web-preview-import
make web-preview-validate
make web-preview-plan
make web-preview-status
```

`web-images` construit les cibles `api` et `media` de `web/deploy/Dockerfile` pour
Linux amd64, avec les tags `tarjama-web:review` et `tarjama-media:review` et le label
de révision Git. `.dockerignore` limite le contexte aux sources backend/frontend
et aux Dockerfiles, en excluant dépendances locales, secrets, .env, clés, archives,
données et espaces de travail. Ne pas réutiliser un ancien tag après modification
des sources : reconstruire, puis importer de nouveau.

`web-preview-import` appelle séquentiellement `vps-preview image-import atelier`
pour les noms `web` et `media`. Reporter **exactement** les champs `image` retournés
dans `deploy.preview.yml` et les paramètres de rendu :
`preview.local/atelier/web@sha256:…` et `preview.local/atelier/media@sha256:…`.
Ces digests de manifeste ne sont pas les Docker image IDs. Le catalogue local
non secret `/etc/vps-preview/local-images.json` permet de vérifier leur enregistrement.
L'import ne démarre ni service ni migration. Le moteur impose
`imagePullPolicy: Never` ; après perte du cache ou changement de nœud, réimporter.

L'import requiert une image/archive de moins de4Gi et une marge disque d'au moins4Gi
plus l'espace de travail. Ne pas nettoyer globalement Docker ni supprimer les
images de retour arrière. Le build lui-même n'est pas borné par l'importeur.
PostgreSQL reste l'image externe 17 Alpine épinglée à son digest vérifié ; seules
les deux images applicatives nécessitent cet import local.

`deploy.preview.yml` reste une **recette non activable en l'état** : tous les
services sont `enabled: false` et les paramètres non disponibles restent
`REQUIRED_*`. `web/scripts/preview-render.py` intègre le script SQL public et les
seuls paramètres publics fournis dans `web/deploy/preview/inputs.json` (voir
l'exemple adjacent). Il accepte les références locales de cet emplacement,
refuse les tags, champs supplémentaires et écrasements de fichiers existants,
et remplace également les anciens digests déjà épinglés. Aucun rendu n'active rien.

L'accès GHCR en lecture reste enregistré par l'administrateur, mais n'intervient
plus dans cette procédure. Aucun jeton de publication ni quota GitHub Actions requis.

## Résultat des imports locaux

Images construites depuis `e6a0cf34cb39a37386d910a90967b20c936fb92f`, puis importées
le 22 septembre 2026. Références exactes, Docker IDs et dates consignés dans
[`images.lock.json`](../deploy/preview/images.lock.json), concordance vérifiée
avec les labels de révision et `/etc/vps-preview/local-images.json`.

- Web : `preview.local/atelier/web@sha256:966a2e244b183332f68e5e99caf062907f7628ef2004daacbe0695ffec9b8c9b`.
- Média : `preview.local/atelier/media@sha256:fc54ba926b58aa256800c484a4cc74508e1afa70289f994fa723cfa6e7b11f2f`.

Les services et jobs de `deploy.preview.yml` utilisent ces références. Les cinq
services restent `enabled: false`. Aucun job ni déploiement de courtier exécuté.
`validate` et `plan` ont été relancés : tous deux refusent **« Capacité réseau non
enregistrée »**, en présence des capacités OIDC/WARP encore non renseignées.
La recette n'est donc pas validée intégralement ; aucun faux endpoint ou profil
n'a été ajouté pour faire passer ce contrôle. OIDC, WARP, sandbox, API fournisseurs
et stockage/sauvegardes restent à qualifier. Le statut reste0 replica/0 ready.

Le build Linux amd64 et les imports ont réussi. Les quatre tests de rendu passent,
ainsi que le test DB isolé avec l'image web reconstruite (initialisation restreinte,
bootstrap répété, migration attendue). Cela ne constitue pas un essai utilisateur
sur la cible ni une qualification de la sandbox média.

## Secrets à enregistrer dans le catalogue `atelier`

Catalogue relu le 22 septembre : DB administrateur/applicative, chiffrement,
Gemini, Groq et token média sont enregistrés avec les clés attendues.
**`tarjama-oidc` reste absent.** Les valeurs et API fournisseurs n'ont pas été
consultées ni validées. Les fichiers sont lus avec `*_FILE` ;
les valeurs sont fournies uniquement par l'administrateur, jamais en YAML/Git/chat.

| Référence catalogue | Clés/fichiers et format | Destinataires |
| --- | --- | --- |
| `tarjama-db-admin` | `postgres_password` : mot de passe aléatoire distinct | DB, tâche bootstrap |
| `tarjama-db-app` | `app_db_password` : mot de passe aléatoire du rôle non superuser `tarjama` ; `database_url` : `postgres://tarjama:<mot-de-passe-percent-encodé>@pv-db:5432/tarjama?sslmode=disable` | API, worker, migration ; bootstrap reçoit seulement le mot de passe |
| `tarjama-encryption` | `encryption_key` : exactement 32 octets aléatoires encodés en base64 standard | API, worker |
| `tarjama-oidc` | `client_secret` : secret du client confidentiel OIDC dédié | API seule |
| `tarjama-gemini` | `api_key` : clé serveur dédiée, accès au modèle fixe `gemini-3.8-flash` à vérifier | worker seul |
| `tarjama-groq` | `api_key` : clé serveur dédiée, accès à `whisper-large-v3` à vérifier | worker seul |
| `tarjama-media` | `token` : secret aléatoire d'au moins 32 caractères, identique aux deux extrémités | worker, média |

Choisir des mots de passe DB forts sans retour ligne (p. ex. 32 octets aléatoires
encodés). Protéger la clé de chiffrement séparément des sauvegardes de données.
Les montages doivent être lisibles par les UID/GID déclarés, sans écriture.
La migration charge seulement `database_url` ; aucun secret IA/OIDC/chiffrement
n'est nécessaire. Le worker ne nécessite plus d'identité OIDC.

OIDC : issuer HTTPS réel dans `OIDC_ISSUER`, identifiant public réel dans
`OIDC_CLIENT_ID`, callback exact `https://atelier.preview.runagen.com/auth/callback`,
flux authorization code + PKCE S256, scopes `openid profile`, découverte et JWKS.
La protection Authelia de la passerelle ne configure pas cette identité applicative.
Deux comptes de test distincts doivent être autorisés pour vérifier l'isolation.

## Ports, communications et capacités réseau

| Émetteur | Destination et port | Usage |
| --- | --- | --- |
| Passerelle privée existante | service fixe `web:8080` → API `8090` | HTTPS externe protégé ; `/readyz` vérifie DB et schéma |
| API UID/GID `10001:10001` | `pv-db:5432` ; issuer/token/JWKS HTTPS | sessions et données ; capacité OIDC à fournir |
| worker UID/GID `10001:10001` | `pv-db:5432`, `pv-media:8091`, web public TCP 443 | file, transfert média authentifié, Gemini/Groq |
| média UID/GID `10002:10002` | `pv-egress:8092` uniquement | proxy HTTP CONNECT du téléchargement |
| egress UID/GID `10003:10003` | une IPv4 et un port WARP administrés | tunnel HTTP CONNECT, sans repli direct |
| bootstrap/migration | `pv-db:5432` | création du rôle puis schéma |

DNS autorisé par le moteur. Aucun port hôte supplémentaire, aucune sortie publique
pour média/DB/egress, aucun accès DB/stockage partagé pour média. FFmpeg utilise un
namespace réseau isolé ; yt-dlp partage uniquement le réseau restreint de son pod.

`OIDC_EGRESS` doit être une capacité administrateur ciblée si l'issuer aboutit à
l'IP protégée du VPS ou à un réseau privé ; `public-web` seul ne suffit pas dans
ce cas. Si issuer, token et JWKS ont plusieurs destinations, adapter explicitement
la liste `egress` à leurs capacités. Aucun endpoint n'est inventé.

`WARP_HTTP_PROXY` doit être l'IPv4:port réelle, **sans schéma URL ni identifiants**.
Le service doit accepter CONNECT vers une IP publique résolue et épinglée (IPv4 ou
IPv6), en conservant TLS/SNI au nom d'origine. Un proxy SOCKS seul est insuffisant.
`WARP_EGRESS` est le nom exact de cette capacité dans le catalogue. Aucun service
compatible n'est établi actuellement. Tester panne/reprise et absence de sortie
directe avant essais utilisateur de liens YouTube.

## Sandbox et capacité à qualifier

Le profil reste à fournir dans `MEDIA_SECURITY`, ou `runtime-default` seulement
après qualification réussie. La commande `tarjama sandbox-check`, également
préparée comme job explicite, exécute ffprobe et yt-dlp sous Bubblewrap, sans secret,
sans média utilisateur et sans service réseau. Le démarrage média impose le même
contrôle. La réussite est nécessaire mais ne prouve pas l'isolation complète.

Besoin précis : Bubblewrap **non setuid et non privilégié**, UID10002, création de
namespaces utilisateur, mount, PID, IPC, UTS, cgroup et réseau (`--unshare-all`),
montages internes en lecture seule de `/usr`, bibliothèques, certificats/polices,
`/proc` et `/dev` privés, tmpfs et seul dossier du job monté dans `/job`.
Pour yt-dlp uniquement : `--share-net` et lecture de `/etc/resolv.conf` ; le pod
n'a que son lien vers le proxy egress. Environnement vidé, pas de clés héritées,
`prlimit` borne CPU/fichiers/descripteurs et annulation du groupe de processus.
L'administrateur doit identifier les refus seccomp/AppArmor/userns et enregistrer
un profil ciblé s'il peut satisfaire ce besoin. Ne pas demander `privileged`,
Unconfined, SYS_ADMIN, socket du runtime ou désactivation du contrôle de démarrage.

Après le diagnostic, qualifier avec un petit média synthétique : décodage,
encodage, lecture impossible des fichiers voisins/secrets et sorties réseau
interdites. Le diagnostic Docker local ne qualifie pas le profil Kubernetes.

## Stockage et ressources

PVC local-path : `library` **14Gi**, monté en écriture par API et worker sous
`/storage` avec le même UID/GID10001 ; `database` **2Gi**, `/data/pgdata`, UID/GID70.
Le socket PostgreSQL est dans `/tmp` ; `PGSERVICEFILE` configure aussi les clients
d'initialisation de l'image officielle pour ce chemin sur racine read-only.
Total déclaré 16Gi ; pas de PVC du média. Les 12Gi applicatifs + marge de fichiers
en cours ne sont pas une limite physique local-path. Vérifier le disque libre réel,
les autres charges et la place des sauvegardes avant création de ces volumes.
Aucun volume n'a été créé pendant cette préparation.

Services : 4250m CPU / 5248Mi RAM maximum cumulés. Média : 2 CPU, 3072Mi RAM dont
`/tmp` 2560Mi ; une opération à la fois. Le tmpfs compte dans la RAM. Ce budget
est destiné aux premiers petits médias : qualifier les pics d'encodage et de
copies avant de promettre les limites applicatives (1Gi/fichier, 3h/vidéo).
Un gros fichier peut épuiser ce budget ; ne pas augmenter les privilèges pour cela.

Ne lancer les jobs bootstrap, migration et sandbox que dans la phase bootstrap
(DB seule démarrée), un à la fois. Avec tous les services actifs, le job sandbox
excéderait le quota mémoire ; les pods terminés comptent aussi selon leur état.
Prévoir sauvegardes DB+médias hors VPS et restauration testée avant données réelles.
Le script Compose de backup existant ne sauvegarde pas les PVC Kubernetes : la
procédure administrée d'export/restauration de ces PVC reste à établir.

## Procédure préparée — à exécuter seulement après levée des prérequis

1. Construire/importer localement les images testées, reporter les références
   exactes retournées, enregistrer OIDC/WARP/profil et valider fournisseurs,
   stockage et sauvegardes. Les secrets internes et fournisseurs sont déjà enregistrés.
2. Renseigner uniquement les paramètres publics dans `inputs.json`, puis :

   ```sh
   make web-preview-render PREVIEW_OUTPUT=web/deploy/preview/stopped.yml
   make web-preview-validate PREVIEW_FILE=web/deploy/preview/stopped.yml
   make web-preview-plan PREVIEW_FILE=web/deploy/preview/stopped.yml
   ```

3. Préparer la phase DB seule, relire validate/plan. Une instruction d'activation
   permettrait ensuite le `deploy` de cette recette ; même DB seule crée un état vivant.

   ```sh
   make web-preview-render PREVIEW_PHASE=bootstrap PREVIEW_OUTPUT=web/deploy/preview/bootstrap.yml
   make web-preview-validate PREVIEW_FILE=web/deploy/preview/bootstrap.yml
   make web-preview-plan PREVIEW_FILE=web/deploy/preview/bootstrap.yml
   ```

4. Après ce déploiement autorisé, lancer explicitement `bootstrap-db`, attendre son
   succès ; puis `migrate`, attendre son succès ; puis `sandbox-check`, attendre son
   succès. Le bootstrap attend la DB avec une borne inférieure à son timeout240s.
   La migration attend au plus90s, avec limite globale240s et timeout courtier300s.
   Elle n'est jamais exécutée automatiquement, même au redémarrage API/worker.
5. Seulement après succès et qualification, préparer `PREVIEW_PHASE=active` dans
   un nouveau fichier, validate/plan, puis déployer selon l'autorisation. Vérifier
   chaque service, OIDC deux comptes, upload, Groq/Gemini réels, sauvegarde blur,
   reprise de jobs, Range/export, WARP et les restrictions réseau.
6. `stop` conserve les volumes. `rollback` redémarre les services d'une ancienne
   recette et **ne restaure ni schéma ni données** ; vérifier compatibilité et
   sauvegardes avant usage. Ne jamais l'utiliser comme simple consultation.

Commandes du courtier pour les futures opérations autorisées :
`vps-preview deploy atelier --file …`, `vps-preview run atelier bootstrap-db`,
`vps-preview run atelier migrate`, `vps-preview run atelier sandbox-check`,
`vps-preview logs atelier --component NOM`, `vps-preview status atelier`.
Les cibles Make livrées n'activent rien : rendu, validation, plan, statut et tests.
Conserver les recettes résolues approuvées et le verrou de digests dans le dépôt.

## Vérifications de cette préparation

- Lors de la préparation initiale, `validate` et `plan` refusaient le modèle
  (« Montage non déclaré ou non autorisé »). Le catalogue était alors vide.
  Les secrets internes/Gemini/Groq sont maintenant enregistrés ; OIDC reste absent.
  La recette finale exige encore les paramètres OIDC, WARP et sandbox qualifiés.
- `make web-preview-test` : garde contre activation implicite, placeholders,
  valeurs secrètes supplémentaires et écrasement d'une recette revue.
- `make web-preview-db-test` : DB éphémère UID70, racine read-only, capacités
  retirées, réseau interne sans ports hôte ; bootstrap répété et migration lancée
  avant disponibilité de la DB, rôle non superuser, schéma vérifié.
- `make web-test` : suite isolée existante et nouveaux tests de démarrage borné,
  migration sans secrets applicatifs, distinction des exigences OIDC API/worker.
- Diagnostic de l’image média sous Docker read-only, UID10002, capabilities
  retirées et no-new-privileges : échec confirmé de création des namespaces
  non privilégiés (« No permissions to create new namespace »). Aucun profil
  Kubernetes qualifié et aucune protection assouplie.
- Workflow GitHub Actions archivé et inactif sur `web-vps` ; voir les imports
  locaux et l’état actualisé dans [STATUS.md](STATUS.md).
- `atelier` reste arrêté ; aucune révision Tarjama déployée.
