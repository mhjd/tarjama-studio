# Keycloak : domaine unique, sans email automatique — 27 septembre 2026

> **Suite du 28 septembre, qualification administrateur finale :** présence CRI
> des six références confirmée, essais privés TLS/console/limites/médias réussis.
> Le réglage `master.attributes.frontendUrl=https://localhost:9443` est requis au
> bootstrap. Les réserves plus anciennes ci-dessous sont historiques ; la
> [procédure de transition actuelle](KEYCLOAK_TRANSITION_20260928.md) distingue
> ces preuves des contrôles K3s/données réelles encore nécessaires. Aucune bascule.


> **État actualisé le 28 septembre :** les images des sources `aebc87f` sont
> construites et importées ; la candidate arrêtée passe `validate`/`plan`
> (`9017da632b208055`). Voir [les digests, preuves et limites](KEYCLOAK_IMAGES_20260928.md).
> Les paragraphes historiques ci-dessous sur les placeholders et le créneau
> de construction décrivent l’état du 27 septembre, désormais dépassé.
> Le contrôle CRI, la console privée/TLS et les limites de requêtes restent
> à qualifier. Les sauvegardes hors VPS sont reportées par le propriétaire.


Ce document remplace le contrat à trois origines publiques/privées et SMTP du
commit `9d1f6a9` et le préfixe `/identity` proposé dans `2ee17b7`. Il intègre
la dernière correction du propriétaire après la passation
`/home/codex/.keycloak-admin-handoff-20260927-QC1dot/ADMIN_HANDOFF.md`.
Aucune bascule, ouverture publique ou migration de données n'est autorisée ici.

## Politique retenue

Application : `https://tarjama.runagen.com`. Connexion et inscription via
les entrées applicatives **`/sign-in` et `/sign-up`**, puis redirection OIDC vers
**la même origine**. Le préfixe `/identity` est abandonné, à la demande du
propriétaire. Pendant les formulaires, les URL natives `/realms/tarjama/...`
peuvent apparaître : les deux chemins courts sont des points d'entrée, pas un
masquage des pages Keycloak. Aucun mot de passe n'est collecté par Tarjama. Le realm conserve email comme nom de connexion,
mais cette adresse déclarée n'est **pas vérifiée** et ne prouve aucune identité.

`verifyEmail=false`, `resetPasswordAllowed=false`, aucun `smtpServer`, aucune
action `VERIFY_EMAIL` imposée. Aucun montage mail, aucune variable SMTP, aucune
capacité SMTP. Le mot de passe est défini à l'inscription. L'interface indique
l'absence de récupération par email et renvoie vers le propriétaire du service.

Le callback accepte un `email_verified` absent ou faux, sans fabriquer un claim
vrai. Toutes les vérifications cryptographiques sont conservées : signature,
issuer, audience, expiration, nonce, state, PKCE S256, et `sid` non vide. Le client
reste confidentiel, sans password grant, implicit flow ou service account.
L'espace et les autorisations restent indexés par `(issuer, subject)` uniquement.
Une adresse identique ne fusionne jamais deux identités.

Récupération et changement d'adresse : opération administrée, avec **preuve
indépendante de l'adresse déclarée**, puis réinitialisation contrôlée et logout
des sessions. Ne pas fusionner les espaces, changer un `subject` ou attribuer des
projets sur la seule affirmation « cette adresse est à moi ». La procédure de
preuve/support doit être définie par le propriétaire avant une ouverture large.
La console de compte Keycloak n'est pas exposée par le contrat public ci-dessous.
Les actions `UPDATE_PROFILE`, `VERIFY_PROFILE` et `VERIFY_EMAIL` sont explicitement
désactivées ; `UPDATE_EMAIL` n'est pas activée. Les actions initiées par le
navigateur ne doivent pas rouvrir un formulaire permettant de changer l'adresse.
`UPDATE_PASSWORD` reste disponible pour une action administrée exigeant un nouveau
mot de passe ; le realm master et son MFA ne sont pas modifiés.

## Contrat de routage à qualifier par l'administrateur

| Élément | Valeur |
| --- | --- |
| Origine applicative | `https://tarjama.runagen.com` |
| Base publique Keycloak / `KC_HOSTNAME` | `https://tarjama.runagen.com` |
| Issuer exact | `https://tarjama.runagen.com/realms/tarjama` |
| Callback exact | `https://tarjama.runagen.com/auth/callback` |
| Redirect après logout | `https://tarjama.runagen.com/` |
| Back-channel interne | `http://web:8080/auth/backchannel-logout` |
| Racine Keycloak / `KC_HTTP_RELATIVE_PATH` | `/` |
| Readiness interne | `http://pv-keycloak:8080/health/ready` |
| Base privée admin proposée | `https://localhost:9443` **non qualifiée** |

Les chemins natifs sont conservés de bout en bout : `/realms/...` et
`/resources/...` reçus par le proxy restent identiques sur `pv-keycloak:8080`.
Aucune réécriture du préfixe ni `X-Forwarded-Prefix`. La racine `/` est fixée
au build et au runtime. Une image optimisée pour `/identity` ne conviendrait pas ; il faut
reconstruire et tester l'image finale issue des sources actuelles.

Sur le domaine public, seuls ces sous-arbres Keycloak sont nécessaires :

- `/realms/tarjama/.well-known/` pour discovery ;
- `/realms/tarjama/protocol/openid-connect/` pour OIDC ;
- `/realms/tarjama/login-actions/` pour les formulaires ;
- `/resources/` pour les assets.

Réserver les racines `/realms`, `/resources`, `/admin`, `/health`, `/metrics`
et l’ancien `/identity`. En dehors de la liste autorisée ci-dessus, refuser
ces chemins, notamment `/realms/master`, `/realms/tarjama/account` et les autres
realms. Filtrer des chemins normalisés ; ne pas laisser un encodage, double slash, `..` ou point-virgule
contourner la règle. Ne pas renvoyer les refus vers le fallback React.

Les entrées `/sign-in` et `/sign-up`, les alias de compatibilité `/auth/login`,
`/auth/register`, ainsi que `/auth/callback` et
`/auth/backchannel-logout` continuent d'aller à **Tarjama**, ainsi que `/api/`,
les médias, les assets applicatifs sous `/assets/` et les routes de projets.
Ne jamais router l'ensemble de `/auth` vers Keycloak. Ne pas mettre de filtre Authelia personnel
devant la future origine publique ; maintenir celui des autres services et de
l'aperçu privé actuel.

Le proxy doit écraser `Forwarded`/`X-Forwarded-*`, terminer TLS et garder les
services inaccessibles directement. Les cookies Keycloak doivent rester sous
`/realms/tarjama/…` ; le cookie Tarjama reste à `/`, HttpOnly/Secure en production.
Le back-channel interne vérifie un JWT signé avant toute révocation.

`KC_HOSTNAME_ADMIN=https://localhost:9443` est une proposition pour le
navigateur de l'administrateur via tunnel SSH/TLS, **pas une nouvelle adresse
publique**. Certificat, écoute privée, console admin et flux du realm master
restent à qualifier : le seul paramètre hostname-admin ne protège aucune route.
Le parcours administrateur complet doit fonctionner par son accès privé, sans
ouvrir master/admin sur le proxy public pour corriger un problème de redirection.

## Générateur et secrets

Le générateur accepte désormais `--app-origin`, `--identity-base-url` et
`--admin-base-url`. HTTPS, ports, identifiants d'hôte et chemins sont validés ;
query, fragment, credentials, encodages et chemins ambigus sont refusés. La base
publique d'identité doit être exactement l'origine applicative, sans suffixe.
La base admin exige également une origine sans chemin, sur un endpoint privé distinct.

Les quatre références annoncées par l'administrateur sont présentes au catalogue,
sans lecture de leurs valeurs :

- `tarjama-keycloak-client` / `client_secret` : web et Keycloak ;
- `tarjama-keycloak-db` / `password` : rôle SQL Keycloak, init et sauvegarde ;
- `tarjama-keycloak-db-admin` / `password` : PostgreSQL dédié seulement ;
- `tarjama-keycloak-bootstrap` / `password` : bootstrap temporaire Keycloak.

`keycloak-https` existe. Aucun secret/capacité SMTP n'est demandé. Ne pas
régénérer ces secrets. Après création de l'administrateur nominatif et MFA,
supprimer le compte bootstrap et retirer son montage.

Le budget déclaratif de 19 Gio a été relevé par l'administrateur. Il ne réserve
aucun octet physique ; aucun nouveau PVC n'a été créé par ce travail. Les volumes
existants et le digest egress `19994f1cb8ab15277356be24380fba1982e62753d216ddb41a459effcdd5d39a`
sont conservés dans la candidate. Toute restauration/rétention hors VPS reste à
qualifier avec les sauvegardes applicatives et la clé de chiffrement.

## Candidate et images : état explicite

`web/deploy/preview/keycloak-candidate-20260927.yml` est un **brouillon arrêté non
déployable**. Les champs `REQUIRED_*_IMAGE` attendent les nouveaux digests : les
anciennes images ne représentent pas ce code, et leurs imports ont disparu du
cache Kubernetes. Le manifeste historique `images-20260927.json` est marqué
obsolète et le générateur refuse de le réutiliser pour cette configuration.

```sh
make web-keycloak-recipe ARGS='--base web/deploy/preview/active-long-transcript-20260927.yml --draft --app-origin https://tarjama.runagen.com --identity-base-url https://tarjama.runagen.com --admin-base-url https://localhost:9443 --output web/deploy/preview/keycloak-candidate-20260927.yml'
```

`validate` et `plan` ont été tentés sur ce brouillon : refus **« Image avec
registre autorisé et digest sha256 requis »**, attendu tant que la construction
et l'import ne sont pas autorisés/coordonnés. Ce refus n'est pas une validation
du reste de la recette. Aucun faux digest ou faux secret n'est introduit pour le
contourner. Après coordination, reconstruire web/worker/Keycloak, importer en
série, conserver les références retournées dans un nouveau JSON `web`, `worker`,
`keycloak`, puis régénérer **sans `--draft`**, avec `--images <nouveau JSON>`.
Reprendre `validate` et `plan`, sans `deploy`.

Lors du contrôle local : environ 17 Gio libres sur 96 Gio, disque à 84 %. Aucun
build d'image, import Kubernetes ou nettoyage global n'est effectué dans ce
travail. La tentative de coordination via `discussion --compact list` renvoie
`invalid_work_trace_layout` sur `.discussions/.namespace.lock` ; `runtime status`
ne fournit aucun agent destinataire. Aucune réparation du mécanisme de discussion
ni suppression de son verrou n'a été tentée. La passation administrateur sert
au relais de la coordination.

## Qualification locale et limites

```sh
make web-keycloak-recipe-test
make web-keycloak-source-test
make web-test
```

Exécuter ces cibles **séquentiellement** : les deux suites de navigateur
partagent le répertoire de build frontend. Une reconstruction concurrente peut
vider momentanément les assets servis par l’autre suite.

Le test source utilise le runtime déjà en cache Docker, une copie Keycloak
**éphémère en tmpfs borné**, réaugmentée avec la racine `/`, et l'entrypoint du
dépôt (seul le chemin du binaire est adapté au répertoire temporaire). Il ne
construit pas d'image et ne prouve aucun futur digest de déploiement. PostgreSQL
et Keycloak restent non-root, racines en lecture seule, sans capabilities ;
aucun port publié, aucun compte/secret réel, aucun SMTP ni appel IA.

Un proxy de référence loopback réunit le web et Keycloak sur une seule origine.
Les tests couvrent discovery/issuer/endpoints, inscription sans email envoyé,
claims non vérifiés, assets et chemins des cookies, reconnexion au même espace,
isolation de deux comptes, logout, back-channel signé, réinitialisation
administrative synthétique, readiness et refus des routes publiques interdites.
Le dump/restauration SQL reste testé. Les tests Go gardent les refus
cryptographiques et ajoutent l'acceptation explicite de claims email absents/faux.

Ces tests ne qualifient **pas** le proxy réel, TLS, les politiques Kubernetes,
le tunnel/console admin, le MFA, la sauvegarde hors VPS ou la présence effective
des nouvelles images. Il faudra retester l'image finale exacte après son import,
puis le parcours sur la cible administrée, avant tout accord de bascule.

Références : [hostname Keycloak](https://www.keycloak.org/server/hostname),
[reverse proxy Keycloak](https://www.keycloak.org/server/reverseproxy).

## Résultats de cette révision

- `make web-keycloak-recipe-test` : **3 tests réussis**, incluant les variantes
  d'URL refusées, les ressources préservées et le rejet du manifeste obsolète.
- `make web-keycloak-source-test` : **parcours réel Keycloak réussi**, y compris
  les nouvelles entrées, le refus des actions de changement de profil/email, puis
  dump/restauration de la base dédiée et vérification du rôle SQL non privilégié.
- `make web-test` : tests Go avec détection de courses, `go vet` et build frontend
  réussis. Premier passage UI : 58 réussites et un échec de capture desktop
  pendant la reconstruction concurrente du frontend par la suite Keycloak
  (le serveur servait alors un listing temporaire contenant `fonts.css`).
  Relance isolée de ce scénario après les deux suites : **réussie (7,1 s)**.
  Les 59 scénarios ont donc été validés, dont un après cette relance.
  La restauration applicative de cette commande a été sautée après cet échec ;
  celle de la base Keycloak est validée dans la suite dédiée.
- Journaux locaux : `web/.cache/keycloak-routes-{recipe-tests,test,regression,ui-recheck}.log`.
- `validate`/`plan` : refus attendu des champs d'image non résolus. Le dernier
  état actif contrôlé reste `39aef9dd3599278d`, web/worker/db/egress prêts.

Les tests et données synthétiques ont été supprimés par leurs scripts de
nettoyage. Aucun déploiement, import d'image Kubernetes, modification de secret,
DNS, proxy réel, NetworkPolicy, volume utilisateur ou identité réelle.
