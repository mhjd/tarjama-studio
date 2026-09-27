# Comptes privés, inscription et ouverture de Tarjama — 27 septembre 2026

## Conclusion et périmètre

Il n'y a pas de blocage technique pour des espaces privés : ils existent déjà.
En revanche, **l'inscription autonome et la mise à disposition publique ne sont
pas prêtes**. Il manque un choix de service/parcours d'inscription et une cible
d'exposition administrée. Ajouter un formulaire dans React ne suffit pas.

Cet audit lit le code applicatif, la recette préparée, le catalogue non secret
du VPS et la documentation officielle du fournisseur. Il ne modifie ni comptes
réels, ni SSO, ni accès réseau. Les vérifications exécutables utilisent des
identités synthétiques et PostgreSQL isolé. Ce n'est pas un audit de sécurité
exhaustif, ni une preuve de parcours d'inscription réel.

## Ce qui est déjà construit

| Fonction | État et preuve dans le dépôt |
| --- | --- |
| Connexion OIDC | `auth.go` : code d'autorisation, PKCE S256, état lié au cookie, nonce, vérification signature/issuer/audience/expiration, flux consommé une fois. Tests négatifs dans `auth_test.go`. |
| Création d'un espace à la première connexion | `Store.User` fait un upsert sur `(issuer, subject)`. La reconnexion retrouve le même identifiant ; une autre personne ou un autre issuer obtient un autre espace. Aucun mot de passe n'est stocké par Tarjama. |
| Projets, textes, jobs et fichiers privés | Les routes demandent une session puis vérifient le propriétaire serveur. Les URLs média et téléchargement sont privées, même si l'identifiant est connu. Les doublons YouTube se vérifient dans le seul espace de leur propriétaire. |
| Clés personnelles | Chiffrement authentifié, choix par propriétaire, endpoints write-only. La clé personnelle de A n'est pas destinée à B. |
| Sessions | Cookie HttpOnly/Secure/SameSite=Lax en production, durée absolue 24 h en cookie et en base, CSRF + Origin pour les mutations. Déconnexion applicative et nettoyage des sessions expirées existants. |
| Comptes de test | Connexion alice/bob limitée aux modes locaux test/développement ; aucune route de ce type enregistrée en production. |
| Exploitation partagée | File persistante avec tour par utilisateur, reprises, limites de fichiers et de stockage, rétention médias. Ces mécanismes ne constituent pas un plafond de dépenses pour une inscription ouverte. |

Tests d'isolation étendus lors de cet audit aux routes récentes : renommage,
archivage, validation d'étape, réimportation/restauration des médias, SRT et liste
de projets, en plus des accès/éditions/exports/annulation/reprise/suppression
déjà couverts. Un accès à un projet d'autrui retourne 404 ; un accès anonyme
retourne 401 et une mutation avec mauvais CSRF retourne 403.

L'isolation est applicative, dans une base et un stockage partagés. Elle n'est
pas un chiffrement de bout en bout ni une séparation physique par compte : les
processus serveur et les administrateurs autorisés peuvent accéder aux données.

## Blocages concrets

1. **Pas de parcours d'inscription.** La page propose une connexion OIDC, pas
   une création d'identité. Authelia utilise un annuaire/fichier de comptes ; son
   éventuel lien `registration.custom_url` renvoie vers un service externe, il
   ne crée pas les comptes. Source officielle consultée le 27 septembre :
   [Authelia, First Factor — registration](https://www.authelia.com/configuration/first-factor/introduction/#registration).
   La disponibilité de cette option dans la version installée n'a pas été testée.
2. **La cible disponible est un aperçu privé.** `/etc/vps-preview/settings.json`
   ne déclare que `atelier.preview.runagen.com`. Le passage par le SSO privé
   précède celui de Tarjama. Un compte applicatif seul ne donne pas accès à cette
   porte extérieure. Le [skill vps-preview](/home/codex/.agents/skills/vps-preview/SKILL.md)
   indique « pas pour administrer le cluster ou publier un site public » et
   « Ne pas retirer Authelia ». La création d'une cible publique ou l'autorisation
   d'invités sur l'aperçu relève donc de l'administrateur, pas d'une modification
   de recette qui contournerait le filtre.
3. **Cycle de vie des comptes incomplet.** Pas d'interface d'administration
   applicative pour suspendre un compte, révoquer toutes ses sessions ou supprimer
   son espace. Une désactivation chez l'IdP n'invalide pas directement une session
   Tarjama déjà émise : elle peut rester valide jusqu'à son échéance de 24 h.
   Le filtre actuel du VPS est une protection supplémentaire, pas un substitut
   garanti pour une future architecture publique. Le logout actuel ferme la
   session Tarjama seulement ; une session SSO encore ouverte peut reconnecter.
4. **L'admission doit être explicite.** Tarjama accepte actuellement toute identité
   valide de l'issuer configuré. Pour une ouverture sur invitation, il faut une
   restriction au client/application côté IdP, ou une admission serveur testée.
   Ne pas supposer qu'un utilisateur du même annuaire est autorisé à Tarjama.

## Décisions et actions importantes

| Décision du propriétaire | Proposition | Action et responsable |
| --- | --- | --- |
| Quelques invités ou inscription ouverte à tous ? | Commencer avec des invitations nominatives, puis ouvrir une fois les garde-fous et les essais validés. Cela ne remplace pas l'objectif final d'inscription autonome. | Administrateur : comptes/accès limités à Tarjama sur l'aperçu. Application : états d'accès refusé, suspendu, compte prêt. Pour une inscription publique, choisir l'IdP ci-dessous. |
| Comment créer/récupérer son compte ? | Conserver OIDC et confier l'inscription à un fournisseur d'identité qui la gère, idéalement administré. Choisir ensuite email/mot de passe, lien email ou connexion sociale selon son offre. | Propriétaire + administrateur : fournisseur, coût, politique d'inscription, emails de vérification/récupération et MFA. Application : lien « Créer un compte » vers le parcours exact, callback testé et messages d'accueil. Ne pas implémenter un stockage maison de mots de passe. |
| Quelle adresse publique ? | Un domaine destiné à Tarjama, distinct de l'aperçu privé de travail. | Administrateur : cible de déploiement autorisée, HTTPS, routage, politiques d'accès ; issuer/client OIDC, redirect URI exacte `https://<domaine>/auth/callback`, secret client par référence. Application : `PUBLIC_ORIGIN`, configuration OIDC et URLs d'interface. Garder la recette privée actuelle intacte pendant la préparation. |
| Qui finance l'IA et jusqu'à quel plafond global ? | Garder les clés partagées et les clés personnelles optionnelles, sans crédits utilisateur. Fixer un budget global d'exploitation et une capacité d'admission. | Propriétaire : plafond et comportement à son atteinte (mise en attente). Application : garde-fou durable/réservations si nécessaire et limitation des créations/appels de connexion. Exploitation : alertes/coûts et limites fournisseur vérifiées. La file équitable ne borne pas le total facturé. |
| Capacité de stockage et nombre d'utilisateurs initiaux ? | Dimensionner la capacité avant une inscription sans limite. Conserver les rétentions déjà décidées. | Application : réservations atomiques pour les opérations concurrentes, admission et messages de saturation. Administrateur : capacité, surveillance et sauvegardes hors volume, essai de restauration. Les contrôles actuels (1 Gio/fichier, 12 Gio de médias, 30 projets/compte) ne réservent pas physiquement l'espace et ne limitent pas le nombre de comptes. |
| Qui peut suspendre/supprimer un compte et que conserve-t-on ? | Actions administratives explicites, traçables, révocation des sessions et des traitements ; suppression de compte confirmée par son titulaire. | Application : suspension contrôlée à chaque requête et avant travail, révocation, export/suppression de l'espace et clés ; procédure pour jobs en vol et objets médias. Propriétaire : politique de conservation des textes, accès au support et information sur les fournisseurs recevant les contenus. Administrateur : rétention/purge des sauvegardes cohérente. |

Pour limiter les changements, mon choix architectural est de **réutiliser les
espaces privés et OIDC existants**. Deux chemins restent possibles : garder
Authelia avec un service d'inscription/annuaire administré en plus, ou utiliser
un IdP destiné aux comptes de l'application. Le premier évite de changer les
identités existantes mais ajoute un service de gestion ; le second dépend du
fournisseur choisi. Aucun service payant n'est créé dans ce travail.

**Préserver les comptes existants est une action préalable importante.** Changer
d'issuer ou de `subject` crée actuellement un nouvel utilisateur vide. Préparer
une association explicite, vérifiée et sauvegardée vers l'identifiant Tarjama
existant ; jamais de fusion automatique par simple adresse email. Ne pas
réattribuer silencieusement les projets actuels et ne pas migrer les données
réelles avant validation de cette procédure.

## Ordre d'exécution après les choix

1. Fixer audience initiale, inscription/IdP, domaine, budget global et capacité.
2. Faire préparer les références et accès de la cible par l'administrateur,
   sans secret communiqué en conversation et sans ouverture prématurée.
3. Implémenter le parcours d'inscription choisi, l'admission et le cycle de vie
   des comptes ; préparer l'association des identités existantes si nécessaire.
4. Qualifier sur une cible autorisée avec deux comptes indépendants : inscription,
   vérification/récupération, connexion mobile, espace vide, reconnexion stable,
   interdiction des IDs/URLs de l'autre compte, clés séparées, suspension et
   sessions révoquées, jobs en vol, suppression, expiration et retour SSO.
5. Tester la capacité avec plusieurs utilisateurs, les mises en attente et la
   restauration de sauvegarde ; exécuter un parcours vidéo complet par compte.
6. Sauvegarde et déploiement public explicitement autorisés, puis vérifier le
   parcours d'un nouvel utilisateur externe sur l'adresse finale.

## Vérifications de ce travail

Le regroupement vidéo indépendant est décrit dans
[le document d'export](EXPORT_DOWNLOAD_AND_GROUPING_20260927.md).
Le journal final `web/.cache/grouping-auth-20260927-rerun.log` porte les tests Go avec détection
de courses, les tests OIDC/isolation et les rendus FFmpeg réels locaux, ainsi que
`go vet`. Aucun appel IA payant, aucune inscription réelle, aucune modification
des protections ou de la recette active et aucun déploiement dans ce travail.
