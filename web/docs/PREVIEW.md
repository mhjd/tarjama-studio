# Aperçu privé Tarjama — traitements isolés, 23 septembre 2026

Cible : `atelier`, `https://atelier.preview.runagen.com`. Tout reste arrêté.
Le moteur applicatif retenu est désormais `MEDIA_ENGINE=isolated-jobs`.
L'ancien service Bubblewrap conserve ses contrôles dans le code et dans la
configuration Compose historique ; il n'est plus dans la recette VPS.
Aucune exception seccomp/AppArmor n'est demandée.

## Images locales et recette

Le workflow GHCR reste archivé et inactif. Construire sur le VPS et importer :

```sh
make web-test
make web-preview-test
make web-images
make web-isolated-image-test
make web-preview-import
make web-preview-validate
make web-preview-plan
make web-preview-status
```

Les cibles de construction/import ne déploient rien. Reporter exactement les
références `image` retournées et les Docker IDs dans `images.lock.json`.
La recette utilise l'image web pour API, worker, filtre egress et migration.
L'image média sert aux **profils administrés** décrits dans
[ISOLATED_JOBS.md](ISOLATED_JOBS.md) ; elle ne constitue plus un service applicatif.
Le digest K3s `preview.local/...` n'est pas le Docker ID : le broker d'opérations
Docker doit disposer de l'image immuable dans son propre runtime.

`deploy.preview.yml` déclare quatre services `enabled: false` : web, worker,
egress, db. Deux jobs explicites : bootstrap-db et migrate. Aucun `sandbox-check`
Bubblewrap n'est requis pour ce moteur distant, qui ne lance aucun outil local.
OIDC reste explicitement incomplet. La suppression de l'ancien service média
n'est pas une preuve de qualification du nouveau moteur dans K3s.

Le générateur reçoit uniquement des paramètres publics : image web importée,
issuer/client ID/capacité OIDC et proxy/capacité WARP. Il conserve les services
arrêtés par défaut et intègre le script public de bootstrap. Il refuse les secrets
supplémentaires, les tags d'images et l'écrasement d'une recette existante.

```sh
make web-preview-render PREVIEW_OUTPUT=web/deploy/preview/stopped.yml
make web-preview-validate PREVIEW_FILE=web/deploy/preview/stopped.yml
make web-preview-plan PREVIEW_FILE=web/deploy/preview/stopped.yml
```

La recette et ses images ne valent pas enregistrement des profils dans Ansible.
Le dossier administrateur contient des propositions explicites, non installées.

## Secrets à enregistrer dans le catalogue `atelier`

Catalogue relu le 23 septembre : DB administrateur/applicative, chiffrement,
Gemini, Groq et accès aux opérations isolées sont enregistrés avec les clés attendues.
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
| `isolated-jobs` | `token` : jeton dédié du broker ; `ca.crt` : CA privée PEM | worker de confiance seul |

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

## Communications et stockage

| Composant | Accès nécessaires |
| --- | --- |
| web UID/GID10001 | DB5432 ; endpoints OIDC HTTPS réels ; bibliothèque privée |
| worker UID/GID10001 | DB5432 ; fournisseurs HTTPS ; `https://172.31.250.1:40002` via `isolated-jobs` ; bibliothèque privée |
| egress UID/GID10003 | WARP `172.31.250.2:40001` via `warp-downloads` ; écoute8092 |
| db UID/GID70 | aucune sortie métier ; volume DB |
| outils isolés | aucun réseau externe, secret, DB, bibliothèque partagée ou socket runtime ; seuls fichiers de l'opération |

Le secret `isolated-jobs` est monté sous `/run/isolated-jobs` uniquement sur le
worker. TLS valide la CA privée et l'adresse ; redirections HTTP et proxy
implicite d'environnement refusés. Aucun accès Kubernetes/Docker n'est donné
à l'application. L'API navigateur ne reçoit ni le token ni les identifiants distants.

Le filtre egress est conservé **désactivé**, avec ses contrôles domaines/DNS/IP,
CONNECT443, IP épinglée, WARP sans repli et TLS/SNI au nom original. Son chemin
vers le relais administré reste à enregistrer/qualifier : `pv-egress:8092` n'est
pas automatiquement une destination utilisable depuis le broker Docker.
Les traitements FFmpeg/ffprobe n'ont aucun relais. La fenêtre de connectivité
observée sur K3s n'est pas déclarée corrigée par cette recette.

PVC : bibliothèque14Gi, DB2Gi. Les opérations récupérées sont sous
`/storage/operations`, privées et incluses dans le calcul des12Gi applicatifs.
Des entrées, résultats et copies intermédiaires peuvent coexister ; requalifier
la marge pour fichiers1Gi et vidéos3h. L'annulation/acquittement et la collecte
applicative retirent les fichiers devenus inutiles, en conservant des métadonnées
et petits fichiers de verrou pour la reprise. Les tmpfs administrés ne sont pas
une source durable. Les limites local-path ne sont pas des quotas physiques.

Les quatre services demandent au maximum2250m CPU /2176Mi RAM cumulés. Les
conteneurs d'opération sont supplémentaires, hors de ce total : concurrence1 et
ressources à revoir par l'administrateur, sans augmentation implicite. Backups
DB+médias/cache cohérents, chiffrement séparé et restauration hors VPS restent
à préparer ; le test pg_dump/restore local ne qualifie pas les PVC ni leurs sauvegardes.

## Ordre futur, après autorisation séparée

1. Examiner/enregistrer les profils, qualifier le client K3s→API et le relais
   filtré, traiter les limites de rétention/admission et tester les ressources.
2. Configurer OIDC et qualifier fournisseurs, persistance et sauvegardes.
3. Rendre/valider/planifier une recette désactivée puis DB seule
   (`PREVIEW_PHASE=bootstrap`). L'activation de la DB attend elle aussi l'autorisation.
4. Après activation autorisée : bootstrap-db puis migrate, succès explicite
   attendu pour chaque tâche. La migration002 est obligatoire ; attente DB90s,
   budget global240s. Aucun service ne migre automatiquement.
5. Qualifier les parcours réels avant ouverture de l'application. Le rendu
   `PREVIEW_PHASE=active` ne déploie pas, mais prépare l'activation des services.
6. Stop conserve les volumes. Rollback réactive une ancienne recette, sans
   restaurer données/schéma. Ne pas revenir à l'ancien moteur Bubblewrap non qualifié.

Les preuves de tests, imports et refus éventuels du moteur sont consignées dans
[STATUS.md](STATUS.md). Aucun succès de `validate`/`plan` ne vaut essai métier.


Dernier contrôle du23septembre : images locales testées et importées depuis
`f897ac6`, digests consignés dans `images.lock.json`. Les tests d'image synthétiques
et le bootstrap/migration SQL de l'image finale réussissent. `validate` et `plan`
refusent encore « Montage non déclaré ou non autorisé » ; `tarjama-oidc` manque
au catalogue. Les profils d'opérations ne sont pas installés par ces imports.
