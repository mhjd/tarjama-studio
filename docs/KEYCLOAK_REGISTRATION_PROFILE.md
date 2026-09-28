# Inscription sans prénom ni nom

Décision du propriétaire, 28 septembre 2026 : demander uniquement l’adresse
email, le mot de passe et sa confirmation. L’email reste l’identifiant de
connexion ; aucune vérification email ou récupération automatique n’est ajoutée.

Le thème `tarjama-v1` conserve les formulaires natifs. Les champs sont retirés
via le profil utilisateur du realm `tarjama` : pour `firstName` et `lastName`,
supprimer la contrainte `required` et régler les permissions `view`/`edit` sur
`["admin"]`. Ils ne sont donc ni affichés ni exigés lors de l’inscription.
Les valeurs déjà présentes restent conservées et visibles à l’administrateur.
L’identité `(issuer, subject)`, les comptes et leurs projets ne changent pas.

Ce mécanisme est celui du [profil utilisateur natif de Keycloak](https://www.keycloak.org/docs/latest/server_admin/#user-profile).
Il ne nécessite ni CSS pour masquer les champs, ni copie du formulaire, ni
nouvelle image. Le digest du thème candidat reste inchangé.

## Préparation administrateur, hors ligne

Après accord de mise en service, lire via l’administration privée :
`GET /admin/realms/tarjama/users/profile`. Conserver cette réponse complète en
fichier privé `profile-before.json`, puis préparer :

```sh
make web-keycloak-profile-prepare < profile-before.json > profile-after.json
```

Ce générateur ne contacte aucun service. Il conserve tous les autres attributs,
validations, groupes et paramètres, et refuse une configuration où un des deux
attributs est absent ou dupliqué. Examiner le diff avant application.

Avant `PUT /admin/realms/tarjama/users/profile` avec **la configuration complète
préparée**, relire la configuration courante : si elle a changé, régénérer la
candidate à partir de cette nouvelle lecture. Ne pas appliquer un profil exemple
issu du banc de test sur le serveur public. Ne pas PUT uniquement ces deux
attributs : l’API remplace la configuration et cela perdrait les autres champs.

Alternative console privée : realm `tarjama` → Realm settings → User profile →
`firstName` puis `lastName` : Required désactivé, lecture/édition réservées à
Admin. Conserver les réglages d’email, username et tous les autres attributs.
Ne rien modifier dans le realm `master`.

Pour revenir en arrière, rétablir seulement les propriétés `required` et
`permissions` antérieures de ces deux attributs, à partir de la sauvegarde et
de la configuration courante. Ne pas effacer d’autres changements intervenus
entre-temps. Ce retour n’a pas besoin d’une restauration de base ni d’un
changement d’image. Le rollback d’image seul ne modifie pas ce réglage en base.

## Qualification reproductible

`make web-keycloak-theme-test` applique le générateur au profil d’un Keycloak
jetable avant les essais navigateur. Le banc crée d’abord un compte portant
un prénom et un nom, puis vérifie que toute sa représentation est conservée.
L’inscription doit réussir sans ces champs sur les trois formats, y compris
après des erreurs de mot de passe. Connexion, MFA, révocation, isolation et
sauvegarde/restauration restent couvertes. Les tests Python vérifient aussi
que le générateur est idempotent et laisse les autres réglages intacts.

Cette préparation n’active aucun réglage sur l’application publique.
