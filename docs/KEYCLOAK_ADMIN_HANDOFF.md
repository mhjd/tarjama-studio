# Passation administrateur — Keycloak propre à Tarjama

## Demande à transmettre

Préparer l'infrastructure pour l'authentification publique de Tarjama avec son
**Keycloak dédié**, sans rattacher les utilisateurs à Authelia et sans modifier
les protections des services personnels. Le code est sur `web-vps` dans
`/home/codex/projects/tarjama-studio`. Lire d'abord
`docs/KEYCLOAK_INTEGRATION_20260927.md` et cette passation.

Ne pas ouvrir au public ou basculer l'aperçu actuel pendant cette préparation.
Les recettes candidates ont volontairement tous les services désactivés :
**ne pas les déployer sur l'atelier actif**, cela l'arrêterait. Ne pas écraser
la recette active. Aucune migration/réattribution réelle n'a encore été faite.

Merci de préparer les capacités suivantes et de rendre une passation avec les
origines, références et commandes utilisables, **sans valeur secrète**.

### 1. Exposition autorisée et trois origines

Confirmer les noms DNS finaux avant l'import initial du realm :

- origine publique de Tarjama → service applicatif `web:8080` (port conteneur
  8090), HTTPS, sans porte Authelia destinée aux services personnels ;
- origine publique d'identité → `pv-keycloak:8080`, HTTPS ; autoriser seulement
  les chemins nécessaires `/realms/tarjama/` et `/resources/`. Refuser notamment
  `/admin/`, `/realms/master/`, `/health/` et `/metrics` sur cette origine ;
- origine **privée** d'administration Keycloak → même composant, accès limité
  aux administrateurs, incluant les chemins admin/master/resources nécessaires.
  `KC_HOSTNAME_ADMIN` ne protège pas ce routage à lui seul.

Le moteur actuel ne propose que la passerelle privée `atelier`. Fournir une
cible/capacité administrée appropriée, sans demander à l'agent applicatif de
contourner cette passerelle. Décider explicitement de la réutilisation de la
cible actuelle ou d'une nouvelle cible et du devenir des PVC existants.
Les références `preview.local/atelier/...` ne sont pas présumées portables vers
une autre cible : réimporter et régénérer la recette si nécessaire.

Écraser les en-têtes de proxy entrants avec les valeurs de confiance, conserver
TLS, empêcher l'accès direct aux ports internes. Configurer une limitation de
requêtes adaptée sur inscription/connexion/récupération, sans exposer un endpoint
administrateur. Keycloak contient déjà une protection des échecs de connexion.

### 2. Secrets dédiés, par références seulement

| Référence demandée | Clés et format | Consommateurs |
| --- | --- | --- |
| `tarjama-keycloak-client` | `client_secret` : chaîne aléatoire forte, sans retour à la ligne | web et Keycloak seulement |
| `tarjama-keycloak-db` | `password` : mot de passe SQL du rôle `keycloak` | Keycloak, initialisation authdb, job sauvegarde |
| `tarjama-keycloak-db-admin` | `password` : mot de passe distinct du rôle SQL `postgres` | authdb seulement |
| `tarjama-keycloak-mail` | `password` : mot de passe SMTP dédié | Keycloak seulement |
| `tarjama-keycloak-bootstrap` | `password` : mot de passe temporaire de `bootstrap-tarjama` | bootstrap Keycloak seulement |

Ne pas donner le secret SQL administrateur à Keycloak ni un token administrateur
Keycloak à Tarjama. Créer ensuite un administrateur nominatif, configurer son MFA,
puis supprimer le compte bootstrap **et** retirer sa référence de la recette.
Le compte applicatif `tarjama-web` est confidentiel, Authorization Code + PKCE,
sans grant password, sans service account, sans wildcard de redirection.

Fournir séparément les métadonnées non secrètes SMTP : hôte, identifiant dédié,
adresse d'expédition. La recette vise le port **587 + STARTTLS obligatoire**.
Préparer la délivrabilité (expéditeur autorisé, DNS et politique fournisseur),
puis vérifier réellement les emails de validation et de récupération.

### 3. Communications et protections

- web → origine publique Keycloak, HTTPS 443 : nouvelle capacité
  `keycloak-https` à enregistrer avec destinations contrôlées ;
- Keycloak → relais SMTP 587 : nouvelle capacité `keycloak-smtp` ;
- Keycloak → authdb 5432 et web 8080 : liens internes explicites ;
- sauvegarde → authdb 5432 : lien interne explicite.

Le back-channel est `http://web:8080/auth/backchannel-logout` sur le réseau
interne contrôlé. Il vérifie un JWT signé avant toute révocation. Aucune route
admin n'est nécessaire à l'application. Garder les protections conteneur
existantes, aucun privileged, Unconfined, SYS_ADMIN ou socket Docker.

Conserver tous les accès média/WARP/LLM existants et le digest egress réparé :
`preview.local/atelier/web@sha256:19994f1cb8ab15277356be24380fba1982e62753d216ddb41a459effcdd5d39a`.

### 4. Capacité et sauvegardes

Deux nouveaux volumes : `identity-database` **2 GiB**, `identity-backups`
**1 GiB**, en plus des 14 + 2 GiB existants, soit **19 GiB** déclarés. La limite
courante du moteur est 16 GiB : augmenter la capacité autorisée ou proposer
une cible appropriée ; ne pas réduire/supprimer les volumes actuels.

Nouveaux composants : Keycloak 1000m CPU / 1536 MiB, authdb 500m / 512 MiB.
Six services au total ; quatre jobs existants conservés, la sauvegarde est
étendue aux deux bases. Confirmer la marge réelle, les limites et la supervision.
Keycloak démarre avec une seule instance/cache local ; `/tmp` est jetable.

Configurer sauvegardes planifiées, rétention et copie hors VPS, puis tester une
restauration. Le dump SQL est nécessaire ; le JSON du realm n'est pas une
sauvegarde des comptes, mots de passe et sessions. Conserver également la clé
applicative de chiffrement et les sauvegardes Tarjama existantes.

### 5. Validation puis bascule séparément autorisée

Après préparation des domaines/catalogue/secrets/capacité, régénérer la recette
avec `make web-keycloak-recipe` et les origines réelles, puis `validate` et `plan`.
Le générateur garde tous les services arrêtés et préserve la configuration média.
Il ne remplace pas la gestion des routes publiques par l'administrateur.

Préparer une procédure progressive, sans l'exécuter avant accord de bascule :

1. sauvegarde réussie et restaurable des données existantes ;
2. démarrage de la seule base dédiée puis Keycloak ; attendre `/health/ready`
   et la discovery OIDC avant de démarrer le web avec le nouvel issuer ;
3. création et vérification du compte propriétaire cible ; correspondance
   `(ancien issuer, ancien subject) → nouveau subject` vérifiée par l'opérateur,
   simulation `identity-link`, application en maintenance avant sa première
   connexion au web ; aucun rapprochement implicite par email ;
4. migration additive Tarjama `005`, activation web/worker de la recette finale,
   vérification du routage et maintien des protections des autres applications ;
5. essais réels avec deux comptes : inscription/email/récupération, isolation
   des projets et médias, reconnexion, logout et révocation, mobile, parcours
   vidéo ; restaurabilité, capacité et limites d'exploitation vérifiées.

Une désactivation Keycloak doit être accompagnée du logout de toutes les
sessions. Les jobs déjà en cours demandent une annulation séparée. La suppression
d'un compte et le budget global d'une inscription ouverte restent des sujets
applicatifs à finaliser avant une ouverture sans limite ; ne pas les considérer
comme résolus par l'installation de Keycloak.

Merci de retourner les opérations réalisées, les capacités restant bloquées,
les origines et références retenues, et les diagnostics utiles sans secrets.
