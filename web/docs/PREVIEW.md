# Aperçu privé Tarjama — préparation du 22 septembre 2026

Cible : `atelier`, `https://atelier.preview.runagen.com`, moteur générique
`vps-preview` 6.5.0. Branche `web-vps`. Aucun déploiement, job de courtier,
publication d'image ou changement d'infrastructure effectué pendant cette préparation.
La validation du moteur sur une application synthétique ne qualifie pas Tarjama.

## Recette et images

`deploy.preview.yml` est un **modèle non activable en l'état** : tous les services
sont `enabled: false`, les références non disponibles sont `REQUIRED_*`.
`web/scripts/preview-render.py` intègre le script SQL public et les seuls paramètres
publics fournis dans `web/deploy/preview/inputs.json` (voir l'exemple adjacent).
Il refuse des champs supplémentaires, les tags à la place de digests et
l'écrasement d'une recette existante. Aucun générateur ne lance le courtier.

Images prévues : `ghcr.io/mhjd/tarjama-web@sha256:…` (API, worker, egress, migration)
et `ghcr.io/mhjd/tarjama-media@sha256:…` (média, diagnostic). Dockerfile existant,
cibles `api` et `media`, architecture Linux amd64 ; aucune clé embarquée.
Les ID d'images locales ne sont pas des digests de manifeste GHCR.
Le digest PostgreSQL du modèle provient de l'image 17 Alpine réellement présente
localement, architecture amd64 et UID/GID `70:70` vérifiés lors du test isolé.

Le workflow manuel `.github/workflows/web-preview-images.yml` est limité à
`mhjd/tarjama-studio`, branche `web-vps`. Il teste avant publication, refuse les
packages absents ou non privés, vérifie à nouveau leur visibilité avant/après push,
et produit un artefact contenant les deux références par digest et le commit.
Il ne déploie rien et n'a pas été exécuté sur GitHub.

À préparer par l'administrateur : deux packages **privés**, `tarjama-web` et
`tarjama-media`, initialisés si nécessaire avec une image inoffensive, reliés au
dépôt et autorisant son workflow Actions à écrire/lire les métadonnées via
`GITHUB_TOKEN`. Ne pas y publier le code avant vérification de la visibilité.
Enregistrer séparément un accès de lecture GHCR pour le VPS ; tester un pull privé
réel par le mécanisme administré. Un login Docker local ne configure pas le courtier.
Le précontrôle CI échoue si la lecture des métadonnées n'est pas autorisée ; il
ne considère jamais un refus d'accès comme un package neuf à publier.

Référence : [documentation officielle GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Secrets à enregistrer dans le catalogue `atelier`

Noms proposés par la recette, **aucun n'est actuellement enregistré**. Ils ne sont
pas des preuves de capacités disponibles. Les fichiers sont lus avec `*_FILE` ;
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

1. Publier les images privées testées, obtenir les digests réels, qualifier leur
   lecture par le VPS, enregistrer secrets/OIDC/WARP/profil et valider le stockage.
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

- `validate` et `plan` exécutés sur le modèle : tous deux refusent « Montage non
  déclaré ou non autorisé ». Le catalogue est vide ; les images/paramètres restent
  également à résoudre. Cela n'est **pas** une validation réussie du schéma final.
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
- Images construites localement ; aucune publication GHCR ni CI distante lancée.
- `atelier` reste arrêté ; aucune révision Tarjama déployée.
