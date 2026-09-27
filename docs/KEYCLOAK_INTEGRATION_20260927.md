# Identités propres à Tarjama — préparation du 27 septembre 2026

## Décision

Keycloak est un composant de Tarjama, avec une base PostgreSQL et un realm
`tarjama` dédiés. Aucun partage d'annuaire, fédération ou rattachement automatique
avec Authelia. Authelia continue de protéger les services personnels et l'aperçu
privé actuel. Ce travail prépare la future exposition ; il ne la réalise pas.

La source de configuration est `web/deploy/keycloak/`. L'image officielle
26.7.4 est épinglée par digest dans le Dockerfile, optimisée pendant le build,
exécutée sans root, sans capabilities, avec racine en lecture seule et un `/tmp`
jetable. La base contient les données persistantes ; le cache local implique
une seule instance Keycloak dans cette première recette.

## Parcours et sécurité applicative

- `OIDC_PROVIDER=keycloak` active le lien « Créer mon compte ». Sa destination est
  la page d'inscription Keycloak ; Tarjama ne reçoit jamais le mot de passe.
- L'inscription exige un mot de passe d'au moins 12 caractères et la vérification
  de l'adresse email **avant** de définir le mot de passe (parcours Keycloak
  26.7 natif). Récupération du mot de passe via Keycloak et SMTP.
- Authorization Code, client confidentiel, PKCE S256, state lié au navigateur,
  nonce, issuer/audience/signature/expiration vérifiés. Redirect URI exacte.
  Le callback exige aussi `email_verified=true` et un identifiant de session.
- L'espace privé est indexé sur `(issuer, subject)`, jamais sur l'email. Les
  contrôles de propriétaire restent côté serveur pour projets, médias, textes,
  clés et traitements. Une reconnexion retrouve le même espace.
- Sessions applicatives : 24 heures absolues, cookie HttpOnly/Secure/SameSite=Lax
  en production, protection CSRF et Origin pour les mutations. Même maximum SSO
  dans le realm préparé ; aucun cookie « se souvenir » plus long.
- Déconnexion : session locale supprimée, puis redirection vers la déconnexion
  Keycloak. Sans conservation d'ID token, Keycloak peut demander confirmation.
- Révocation administrative : notification back-channel JWT signée, issuer,
  audience, fraîcheur, événement et portée vérifiés. Replay `jti` inoffensif ;
  tombstones et verrou transactionnel empêchent un callback retardé de recréer
  la session révoquée. Migration additive `005_oidc_sessions.sql`.
- **Désactiver un utilisateur ne suffit pas à révoquer une session déjà émise** :
  exécuter aussi la déconnexion de toutes ses sessions dans Keycloak. Les jobs
  déjà acceptés ne sont pas annulés par une déconnexion. La suspension complète
  avec annulation des jobs reste une opération applicative distincte.
- L'application n'obtient aucun compte administrateur Keycloak, credential
  Kubernetes ou accès Docker. Son seul secret d'identité est celui du client OIDC.

Les valeurs de secrets sont injectées depuis des fichiers administrés au
lancement, jamais copiées dans le realm versionné, les images ou la recette.
Le mot de passe du rôle SQL `keycloak` est distinct de celui du rôle bootstrap
PostgreSQL. Le rôle applicatif n'est ni superuser, ni créateur de rôles/bases.

## Préserver les projets existants lors du changement d'issuer

L'opérateur crée et vérifie le compte cible Keycloak, puis prépare ce fichier
**privé** avant sa première connexion à Tarjama :

```json
{
  "user_id": "IDENTIFIANT_TARJAMA_EXISTANT",
  "old_issuer": "ISSUER_ACTUEL",
  "old_subject": "SUBJECT_ACTUEL",
  "new_issuer": "https://IDENTITE/realms/tarjama",
  "new_subject": "IDENTIFIANT_KEYCLOAK_VERIFIE"
}
```

Après une sauvegarde restaurable, en fenêtre de maintenance, avec l'environnement
DB administré de la cible :

```sh
make web-identity-link ARGS='--file /chemin/prive/identity-map.json'
make web-identity-link ARGS='--file /chemin/prive/identity-map.json --apply'
```

La simulation est le défaut. L'identité source doit correspondre exactement ;
une identité cible déjà rattachée provoque un refus, jamais une fusion. L'UUID
Tarjama et les projets restent identiques, les anciennes sessions sont révoquées.
Le binaire est construit par `make web-build`. Ne pas lancer ces commandes contre
la base réelle avant la procédure de bascule autorisée. Le retour à l'ancien
issuer exige une association inverse explicitement vérifiée ; un rollback
Kubernetes ne restaure ni identités ni base de données.

## Sauvegardes et configuration

Le générateur conserve la sauvegarde applicative et lui ajoute un `pg_dump -Fc`
Keycloak sur un volume distinct, inaccessible au service web et aux médias.
Une sauvegarde incomplète reste `.partial`. La copie hors VPS, la rétention,
les alertes et un exercice de restauration réel appartiennent à la mise en
exploitation administrée. Une sauvegarde locale seule ne couvre pas la perte
ou la saturation du VPS.

L'import de realm se fait seulement à sa création. Modifier le JSON, les
origines ou un secret monté **ne modifie pas un realm existant** : utiliser
l'administration Keycloak pour la mise à jour/rotation correspondante, puis
qualifier. Ne jamais effacer la base pour appliquer une configuration.

## Tests reproductibles

```sh
make web-keycloak-test
make web-test
make web-keycloak-recipe ARGS='--help'
```

Le premier construit l'image épinglée puis utilise un réseau Docker interne,
sans port publié, deux PostgreSQL jetables, une boîte SMTP locale et Playwright.
Seuls des comptes et mots de passe synthétiques y sont utilisés. Le realm testé
vient du fichier de production ; HTTP loopback et SMTP sans authentification
sont des exceptions de ce banc isolé, pas de la recette de production.

Scénarios : inscription, refus de session avant vérification email, deux comptes
aux projets séparés, reconnexion stable, logout SSO, révocation administrative
réelle et récupération du mot de passe. Contrôles Go négatifs supplémentaires :
claims invalides, notification falsifiée/périmée/rejouée, callback retardé,
association d'identité ambiguë, isolation des ressources.

Résultat du banc Keycloak (`web/.cache/keycloak-test-final.log`) : **PASS**,
parcours navigateur complet 12,6 s, `/health/ready` opérationnel et restauration
SQL vérifiée. Keycloak et PostgreSQL dédiés ont été exécutés avec UID non-root,
racine en lecture seule, capabilities retirées et `no-new-privileges`. Le test
SQL vérifie aussi que le rôle Keycloak n'a aucun privilège d'administration.

La révocation immédiate dépend de la livraison de la notification back-channel.
La qualification réseau finale doit vérifier sa réception et le passage des
sessions à 401 ; une panne de livraison demande une révocation applicative
administrée, pas l'hypothèse que le seul clic dans Keycloak a suffi.

La qualification locale ne démontre pas le routage HTTPS final, les politiques
réseau Kubernetes, la délivrabilité SMTP réelle, le MFA administrateur, la
capacité multiutilisateur, ni les coûts de l'inscription publique. Aucun appel
IA payant, aucun compte réel et aucune donnée utilisateur ne sont nécessaires.

## Références officielles

- [Keycloak containers](https://www.keycloak.org/server/containers)
- [Import/export et limites](https://www.keycloak.org/server/importExport)
- [Reverse proxy et chemins exposés](https://www.keycloak.org/server/reverseproxy)
- [Health checks](https://www.keycloak.org/observability/health)
- [OIDC Back-Channel Logout](https://openid.net/specs/openid-connect-backchannel-1_0.html)

La passation et les prérequis précis sont dans [KEYCLOAK_ADMIN_HANDOFF.md](KEYCLOAK_ADMIN_HANDOFF.md).
