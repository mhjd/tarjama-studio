# Aperçu privé Tarjama — traitements isolés, 23 septembre 2026

Cible : `atelier`, `https://atelier.preview.runagen.com`. **Activation autorisée et effectuée le23septembre.**
Voir le [bilan réel de qualification](PREVIEW_QUALIFICATION_20260923.md) pour l’état courant,
les résultats et les limites. Les indications d’arrêt ci-dessous décrivent la préparation
antérieure et la recette racine désactivée, pas l’état courant du VPS.
Le moteur applicatif retenu est désormais `MEDIA_ENGINE=isolated-jobs`.
L'ancien service Bubblewrap conserve ses contrôles dans le code et dans la
configuration Compose historique ; il n'est plus dans la recette VPS.
Aucune exception seccomp/AppArmor n'est demandée.

## Images locales et recette

Le workflow GHCR reste archivé et inactif. Les images de `f897ac6` restent
valables : aucun code embarqué ne change dans cette préparation. Pour une future
modification du code, construire sur le VPS et importer :

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
La recette intègre désormais les paramètres OIDC publics confirmés par
l'administrateur. La suppression de l'ancien service média n'est pas une preuve
de qualification du nouveau moteur dans K3s.

Le modèle est `web/deploy/preview/deploy.template.yml`, les paramètres publics
confirmés sont versionnés dans `web/deploy/preview/inputs.json`, et
`deploy.preview.yml` est la recette générée désactivée. Le générateur ne relit
jamais un ancien rendu, qui pourrait avoir été préparé pour activation.
Il reçoit uniquement des paramètres publics : image web importée,
issuer/client ID/capacité OIDC et proxy/capacité WARP. Il conserve les services
arrêtés par défaut et intègre le script public de bootstrap. Il refuse les secrets
supplémentaires, les tags d'images et l'écrasement d'une recette existante.

```sh
make web-preview-render PREVIEW_OUTPUT=web/deploy/preview/stopped.yml
make web-preview-validate PREVIEW_FILE=web/deploy/preview/stopped.yml
make web-preview-plan PREVIEW_FILE=web/deploy/preview/stopped.yml
```

Les huit profils sont enregistrés par l’administrateur selon sa passation du
23 septembre : les deux initiaux et les six profils Tarjama. Ce constat ne
résulte pas du rendu de recette et ne qualifie pas les parcours applicatifs.

## Références de secrets enregistrées dans le catalogue `atelier`

Catalogue relu le 23 septembre : DB administrateur/applicative, chiffrement,
Gemini, Groq, accès aux opérations isolées et `tarjama-oidc/client_secret` sont
enregistrés avec les clés attendues. Aucune valeur secrète n’a été consultée ;
les API fournisseurs n’ont pas été validées par cette préparation. Les fichiers sont lus avec `*_FILE` ;
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

OIDC : `OIDC_ISSUER=https://auth.runagen.com`,
`OIDC_CLIENT_ID=preview-atelier-tarjama`, capacité réseau `oidc`, callback exact
`https://atelier.preview.runagen.com/auth/callback`. Authorization code, PKCE S256,
`client_secret_basic`, scopes `openid profile`, consentement et MFA. Le secret
reste monté uniquement sur l’API. L’administrateur rapporte discovery/TLS et
authentification du client réussies ; le parcours navigateur reste à tester.

Le compte propriétaire `habib` est inchangé. L’activation du compte restreint
`tarjama-test` est reportée à la demande du propriétaire ; aucune action humaine
n’est requise maintenant. La vérification réelle avec deux comptes est également
différée, sans être considérée acquise. Pour un invité, prévoir ultérieurement
un compte personnel limité à Tarjama, sans partager le compte propriétaire.

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
CONNECT443, IP épinglée, WARP sans repli et TLS/SNI au nom original. Le relais
administré est maintenant raccordé au Service `pv-egress:8092`, dont le ClusterIP
est résolu par Ansible, sans adresse codée dans Tarjama. Conserver le nom `egress`
et le port8092. Tant que tout est arrêté, le Service n’a pas d’endpoint ; le
relais échoue sans repli. L’administrateur rapporte des essais positifs sur un
filtre temporaire, pas sur un déploiement Tarjama actif.
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
conteneurs d’opération sont supplémentaires, hors de ce total : concurrence1,
CPU2, pids128 et RAM1536/3072/4096Mi selon profil, enregistrés par l’administrateur.
Le broker conserve une réserve disque minimale8Gio et une réservation totale4Gio.
La mesure administrateur d’environ17,3Gio libres ne garantit pas16Gio de données
plus cette marge. Prévoir uniquement de petites fixtures pour les premiers essais ;
les fichiers maximum et la saturation restent à qualifier. Aucun PVC n’est créé.

Le propriétaire retient la sauvegarde OVH pour l’instant ; sa fraîcheur n’a pas
été recontrôlée dans cette intervention. La copie indépendante reste reportée.
La restauration cohérente PostgreSQL + bibliothèque/cache après ACK + clé de
chiffrement reste à vérifier : le test local ne qualifie pas les sauvegardes du VPS.
Le plafond de1000 identifiants par tenant, sans purge automatique, demeure.

## Ordre futur, après autorisation séparée

1. Prévoir de petites fixtures et une marge disque compatible avec la réserve du
   broker ; garder la qualification des tailles maximum et de la rétention séparée.
2. Les profils/relais et OIDC sont configurés ; leurs parcours applicatifs, les
   fournisseurs, la persistance et les sauvegardes restent à qualifier après activation.
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


Dernier contrôle du23septembre après retour administrateur : `validate` et `plan`
**réussissent**, révision calculée `d53694da65c63fca`, `applied: false`.
Les quatre services restent `enabled: false`, les deux tâches sont explicites,
aucun placeholder n’est présent et le script public de bootstrap est intégré.
Les cinq tests de rendu passent, dont le refus d’une activation héritée d’un ancien
rendu. Le statut d’atelier est0 replica/0 ready. Aucun déploiement, bootstrap,
migration, appel fournisseur ou test métier réel n’a été lancé dans cette mise à jour.
