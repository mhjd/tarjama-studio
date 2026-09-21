# Exploitation préparée — ne pas activer pendant cette mission

## Valeurs à fournir avant une instruction de déploiement

- Domaine HTTPS et intégration au Caddy existant. L'API est prévue sur `127.0.0.1:18090`, port à revérifier avant activation.
- Issuer OIDC réel, client confidentiel, secret, URI de retour exactement `<PUBLIC_ORIGIN>/auth/callback`. Identité par issuer/subject, jamais par e-mail. Le fournisseur doit proposer code + PKCE S256, découverte et JWKS. Les comptes et la politique d'inscription sont gérés par ce fournisseur. L'installation Authelia observée n'a pas été modifiée ni supposée configurée pour cette application.
- Répertoire de secrets hors Git, lisible seulement par les UID concernés. Compose local monte les fichiers sans nécessairement appliquer `uid/mode` comme Swarm : vérifier les permissions réelles des sources. Ne jamais donner les secrets IA/DB au service média.
- Clés serveur dédiées Gemini/Groq et accès effectif aux modèles fixes. Ne pas reprendre une clé embarquée dans les releases desktop. Les droits, quotas, organisation/projet et éventuelle facturation doivent être confirmés sur le compte réel.
- Proxy **HTTP CONNECT** privé avec sortie WARP dédiée, réseau Docker externe privé qui le contient. `WARP_HTTP_PROXY` est un `host:port`, sans identifiants. Si l'installation existante fournit seulement SOCKS, préparer un adaptateur dédié sous cette même frontière avant activation. Aucun repli direct, aucun changement de route par défaut.
- Support des namespaces utilisateur non privilégiés dans le service média, avec un profil AppArmor/seccomp revu. Le VPS actuel refuse le test Bubblewrap. Le Compose conserve les restrictions par défaut et le service refuse de démarrer ; ce prérequis est volontairement bloquant, sans `privileged`, `SYS_ADMIN` ou socket Docker. Tester le profil dans un environnement isolé avant mise en service.
- Capacité de disque/backup validée. Valeurs initiales : 30 projets/compte (protection de ressources, pas quota IA), 1 Gio/fichier, 3 h/média, 12 Gio pour le stockage du service, marge disque libre de 2 Gio. Un import simultané et un worker peuvent ajouter une marge temporaire bornée. Un seul worker et un seul processus média sont prévus ; ne pas multiplier les workers sans revoir la réservation de stockage et la capacité partagée.
- Deux vidéos tutorielles absentes. Les guides texte sont livrés ; aucune fausse vidéo n'est affichée.

## Secrets runtime

Copier `.env.example` vers `.env` et renseigner uniquement les paramètres non secrets. Fichiers dans `SECRETS_DIR` :

| Fichier | Contenu |
| --- | --- |
| `postgres_password` | Mot de passe administrateur DB pour initialisation/backup |
| `app_db_password` | Mot de passe du rôle `tarjama`, non superuser |
| `database_url` | DSN `postgres://tarjama:<mot-de-passe-URL-encodé>@db:5432/tarjama?sslmode=disable` (réseau interne) |
| `encryption_key` | 32 octets aléatoires encodés en base64, à sauvegarder séparément |
| `oidc_client_secret` | Secret du client OIDC |
| `gemini_key`, `groq_key` | Clés partagées, ou fichiers vides avec erreur utilisateur explicite |
| `media_token` | Secret aléatoire d'au moins 32 caractères pour RPC média |

Le mécanisme `*_FILE` est prioritaire sur l'environnement. Les credentials personnels sont chiffrés AES-256-GCM, avec propriétaire/fournisseur/version authentifiés. Perdre la clé de chiffrement rend ces credentials inutilisables ; les textes et médias restent lisibles. Pour changer cette clé, prévoir une migration des credentials ou demander leur nouvelle saisie, jamais remplacer silencieusement le fichier.

## Commandes prêtes pour l'intervention suivante

Ces commandes **n'ont pas été utilisées pour une installation vivante** :

```sh
make web-config
make web-migrate DEPLOY_AUTHORIZED=yes
make web-up DEPLOY_AUTHORIZED=yes
```

`web-migrate` initialise le schéma et peut démarrer sa propre DB via les dépendances Compose : cela constitue déjà une activation et nécessite l'instruction séparée. `web-up` n'applique pas automatiquement de migration. Le tag d'image doit être le commit testé, pas une branche flottante. La configuration Caddy fournie est un exemple à relire, pas un fichier à écraser sur le VPS.

Vérifier ensuite depuis loopback readiness, OIDC réel et isolation à deux comptes, puis seulement selon l'autorisation configurer le proxy. Ne jamais activer le mode test pour contourner un problème de connexion ou une clé absente. Aucun service ne publie PostgreSQL, le proxy WARP ou le média sur un port hôte.

`/healthz` vérifie le processus ; `/readyz` vérifie la base et le schéma. La disponibilité de WARP/fournisseurs est indépendante : une panne est un état de job, sans rendre le site inaccessible. Les logs ne contiennent pas de requêtes fournisseur, de transcription, de cookies ou de clés. Consulter les états de jobs pour le diagnostic fonctionnel ; ne pas activer de dump de payload en production.

## Sauvegarde/restauration

Sauvegarde d'exploitation seulement, aucun historique proposé dans l'interface. Pendant une fenêtre de maintenance autorisée, mettre en pause les écritures et attendre/arrêter proprement le worker. Le script ne le fait pas de lui-même.

```sh
DEPLOY_AUTHORIZED=yes WRITES_PAUSED=yes make web-backup BACKUP_DIR=/chemin/prive/hors-volumes
```

Le script crée des fichiers datés exclusifs (`pg_dump -Fc`, archive média et SHA-256). Chiffrer et copier hors du VPS. Conserver séparément la clé de chiffrement et les secrets. Les backups ne doivent pas remplir le disque du service. Tester les checksums et `pg_restore` dans une DB isolée avec la même version majeure, puis restaurer une copie des médias dans un volume vide et vérifier la lecture/export avant tout remplacement vivant. Ne jamais restaurer sur la DB active sans périmètre et sauvegarde préalables. Le script de backup n'a pas été exécuté sur des données vivantes.

Les projets restent conservés jusqu'à suppression utilisateur. Après suppression, les objets sans référence sont ramassés après 24 h, uniquement dans le stockage web :

```sh
make web-gc DEPLOY_AUTHORIZED=yes
```

Les résultats utiles à une reprise restent en base. Il n'y a pas de purge automatique arbitraire de projets ou de snapshots desktop. La fréquence du GC et la rétention des backups sont à convenir avec l'exploitant.

## Import desktop

Ne fournir qu'une copie cohérente, application desktop fermée. Le conteneur d'import doit recevoir ce seul bundle en lecture seule ; ce montage n'est volontairement pas général dans le Compose.

```sh
make web-import DEPLOY_AUTHORIZED=yes ARGS='--bundle /imports/projet --owner IDENTIFIANT_COMPTE'
# Après lecture du rapport, dans le périmètre d'import autorisé :
make web-import DEPLOY_AUTHORIZED=yes ARGS='--bundle /imports/projet --owner IDENTIFIANT_COMPTE --apply'
```

`current.json` prime sur `transcript.json`. La traduction séparée est alignée par IDs et millisecondes ; les conflits avec une traduction embarquée sont refusés. Un digest de contenu/média empêche un second import identique pour le même propriétaire. La copie média est validée puis les textes sont importés dans une transaction. Aucun appel IA. Les dates/empreintes de validation desktop ne deviennent pas des confirmations humaines web : relecture requise. Les archives et snapshots d'origine restent intacts.
