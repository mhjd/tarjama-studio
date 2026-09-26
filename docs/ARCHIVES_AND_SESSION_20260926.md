# Archives, navigation du lecteur et erreur 431 — 26 septembre 2026

## Diagnostic

La création du lien YouTube signalé est bloquée par un projet encore présent,
nommé « test », avec média téléchargé, au stade `transcribing`. La vérification
en lecture seule n'a trouvé aucune entrée supprimée fantôme. L'identité d'une
vidéo est son URL canonique dans l'espace du propriétaire, pas son titre.
Le message de conflit indique désormais le titre du projet réellement concerné.
Le propriétaire conserve ses projets ; aucun n'a été supprimé pour résoudre
ce diagnostic. La suppression effective autorise toujours la recréation du lien.

L'erreur 431 est reproductible sur l'API déployée avant cette correction :
un en-tête Cookie synthétique de 24 Kio reçoit 431, ceux de 4 et 16 Kio reçoivent
204 sur `/readyz`. L'ancienne limite Go est de 16 Kio (avec sa marge de lecture).
La passerelle accepte au moins 64 Kio de cookies lors d'une requête anonyme.

Autre observation, sans utiliser de session utilisateur : douze requêtes
anonymes successives à la passerelle créent douze cookies CSRF distincts,
soit 4 642 octets. Le client Tarjama suivait automatiquement les redirections
des appels API et réessayait sa lecture toutes les deux secondes, même après
expiration de l'authentification. Cette combinaison peut faire grossir les
en-têtes rapidement. Le contenu réel des cookies du propriétaire n'a pas été lu ;
le mécanisme est démontré, son historique de navigation n'est pas reconstitué.

## Comportement corrigé

- Le client traite les redirections d'authentification et les réponses 401 comme
  une expiration. Il revient à la connexion, démonte le lecteur et arrête les
  requêtes périodiques ; les brouillons de sous-titres restent dans leur stockage
  local associé au compte. Les erreurs réseau ordinaires conservent leur reprise.
- Les redirections des requêtes API et des uploads ne sont plus suivies en fond.
- Le serveur accepte jusqu'à 64 Kio d'en-têtes, conserve son délai de lecture de
  dix secondes et refuse toujours les tailles excessives. Cette marge complète
  l'arrêt des requêtes ; elle ne remplace pas la limitation des cookies au proxy.
- Aucun allongement implicite de session : Tarjama émet toujours une session
  absolue de douze heures. La durée et le renouvellement de la session passerelle
  restent à vérifier par l'administrateur ; une expiration rapide n'est donc pas
  attribuée sans preuve au cookie propre à Tarjama.

## Archivage et navigation

`archived` est un booléen facultatif dans le document projet, sans migration SQL.
L'archivage est réversible et ne change ni génération, ni version des sous-titres,
ni média, ni tâches. Les traitements en cours continuent. Les archives comptent
toujours dans les limites de projets et de stockage ; aucun fichier n'est libéré.
Les anciens documents sans ce champ sont des projets actifs.

La bibliothèque distingue `/projets` et `/projets/archives`. L'utilisateur peut
archiver/restaurer depuis une carte ou depuis le projet. Un projet archivé reste
consultable, avec un bandeau explicite permettant de le restaurer. Un lien déjà
archivé propose de rouvrir ce projet ; il ne déclenche pas un autre téléchargement.
La suppression définitive reste disponible dans une section secondaire, avec
confirmation. Les contrôles d'appartenance au compte et de CSRF s'appliquent aux
deux opérations.

Les boutons Haut/Bas sont sur une ligne distincte du lecteur, sans déplacer le
centre de lecture/±5 s. Un saut explicite met la lecture en pause pour empêcher le
suivi de ramener immédiatement au sous-titre. La préférence « Suivi activé » reste
conservée pour la prochaine lecture/recherche de position. L'espace inférieur
mobile s'adapte à la hauteur réelle du lecteur.

Retour arrière : pas de migration SQL à inverser. Une ancienne version du backend
ignore toutefois le champ `archived` et peut le perdre lors d'une réécriture du
document. Conserver les sauvegardes ; éviter un rollback prolongé avec des écritures.

## Point administrateur restant

Le réglage de la passerelle relève de l'infrastructure administrée, hors recette
applicative `vps-preview`. Besoin précis à transmettre, sans cookie ni secret :

> Sur atelier, les requêtes anonymes accumulent des cookies
> `__Host-vps_gateway_*_csrf` : 12 requêtes → 12 cookies, 4 642 octets. Vérifier
> et borner `cookie_csrf_per_request_limit` (par exemple 5 après qualification),
> conserver les protections CSRF/PKCE/MFA et tester les connexions multi-onglets.
> Vérifier aussi la durée effective, le renouvellement et l'expiration de la
> session passerelle ; la session applicative Tarjama dure 12 h. Ne pas se limiter
> à augmenter les buffers HTTP. Prévoir la récupération d'un navigateur qui a
> déjà trop de cookies, sans divulguer leurs valeurs.

L'option est explicitement documentée pour éviter les 431 dans la
[documentation officielle OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/#cookie-options).
Sa disponibilité dans la version installée et le réglage effectivement appliqué
sont à vérifier. Aucune configuration SSO, aucun proxy ni protection du VPS n'a
été modifié par l'application.
