# Thème Keycloak Tarjama — candidate du 28 septembre 2026

**Ne pas déployer ni activer avant validation visuelle du propriétaire.**
Cette passation concerne l’apparence de l’authentification et l’inscription
sans demande de prénom ou de nom. Tarjama
est déjà public à `https://tarjama.runagen.com` ; son exposition doit le rester.

> **Mise à jour : inscription avec email et mot de passe uniquement.**
> Le thème et son digest ne changent pas. Appliquer aussi le réglage de
> [profil utilisateur](KEYCLOAK_REGISTRATION_PROFILE.md) lors de l’activation.
> Cette préparation reste sans modification de l’application publique.

## Base à préserver

Passation lue :
`/home/codex/.keycloak-transition-admin-20260928-y4j4c0ym/PUBLIC_HANDOFF.md`.
Base actualisée après le déploiement UI approuvé : `176b335c5056984a`, recette
`active-subtitle-density-20260928.yml`. La candidate du thème a été réalignée sur
cette base pour conserver les champs compacts et la récupération du lecteur.
L'ouverture publique reste gérée par le routage administrateur.

Conserver le domaine unique, les entrées `/sign-in` et `/sign-up`, les routes
OIDC natives et `/resources/`, l’administration privée sur
`https://tarjama.runagen.com:9443`, les refus des routes master/admin/account
publiques, le limiteur et les contrôles Host/source. Ne pas rouvrir
`atelier.preview.runagen.com` (503). Ne pas recréer le bootstrap. Conserver
`master.attributes.frontendUrl=https://tarjama.runagen.com:9443`, les autres
attributs du master, MFA, clients, secrets, PKCE S256 et durées de session.

L’image egress doit rester :
`preview.local/atelier/web@sha256:19994f1cb8ab15277356be24380fba1982e62753d216ddb41a459effcdd5d39a`.
Aucun changement de données métier, de réseau, de protections ou de version
Keycloak n’est nécessaire. Pas de migration applicative à lancer pour ce thème.

## Candidate et preuves

- Commit source de l’image : `b2b4f082266507a5294ff8107442c7c273487cce`.
- Tag Docker : `tarjama-keycloak:theme-v1-b2b4f08`.
- Image importée : `preview.local/atelier/web@sha256:dea98c02a8a575f8ebf3be9a1702d6e1ff5be4e082b0143baf7d436ba820158a`.
- Plan actualisé : `29bd0ed9ca04cd7b`, non appliqué ; l'ancien plan
  `e70128bdfb709a8f` concernait la base antérieure aux corrections UI.
- Résultats : 4 scénarios navigateur PASS (connexion/inscription/erreurs/
  déconnexion aux trois formats, MFA TOTP sur ordinateur, isolation/révocation),
  13 contrats PASS, dump/restauration Keycloak PASS. 17 captures produites ;
  vues principales examinées visuellement.
- Après import : environ 17.2 Go disponibles,
  marge de 15 % vérifiée avec estimation prudente du pic avant import.
  Seul le cache d’objets Go `web/.cache/build` a été supprimé (reconstructible).
- Statut public et identifiants de pods inchangés avant/après préparation.


Les références de l’image et sa qualification initiale sont inscrites dans `candidate.json`
du dossier `web/review/keycloak-theme-20260928/` et dans la recette
`web/deploy/preview/candidate-keycloak-theme-20260928.yml`.
La recette conserve la configuration active et ne change que
`services.keycloak.image`. Elle n’active pas le thème dans la base.

La qualification actualisée sans prénom/nom est conservée dans
`web/review/keycloak-theme-email-only-20260928/qualification.json`, avec les
nouvelles captures. Les preuves précédentes restent conservées à titre historique.

Thème : `tarjama-v1`, type `login` uniquement, parent `keycloak.v2`.
Activation minimale : `web/deploy/keycloak/theme-activation.json`.
Documentation et reproduction : `docs/KEYCLOAK_THEME.md`.
Galerie hors ligne : `web/review/keycloak-theme-email-only-20260928/preview/index.html`.

Les essais utilisent un Keycloak réel et PostgreSQL jetables, sur réseau Docker
interne sans ports publiés, avec comptes fictifs. Ils ne remplacent pas un
contrôle du routage/TLS public après activation. Aucune clé ou session publique
n’a été utilisée ; aucun appel IA et aucun nouveau traitement vidéo.

## Procédure après validation visuelle et accord de mise en service

1. Lire le statut et la recette **effective du moment**. Si la révision diffère,
   réappliquer uniquement le changement d’image Keycloak à cette recette : ne
   jamais écraser des changements administrateur plus récents avec notre copie.
2. Depuis le canal d’administration privé, sauvegarder le profil utilisateur
   complet (`GET /admin/realms/tarjama/users/profile`) et la valeur antérieure de
   `tarjama.loginTheme`, y compris son éventuelle absence. Conserver un point de
   retour de la recette actuelle, et vérifier la sauvegarde des deux bases.
   Ne pas exporter secrets/tokens dans des preuves publiques.
3. Recontrôler l’espace libre (au moins 15 % après marge de travail), la présence
   **dans CRI** de la candidate et de l’image de retour, ainsi que toutes les
   images référencées. Le catalogue d’import n’est pas une preuve de présence
   dans CRI. Si nécessaire, réimport sérialisé uniquement, sans nettoyage global.
4. Refaire `validate` puis `plan` sur la candidate réconciliée. Le moteur peut
   recréer tous les services même si seule l’image Keycloak change : prévoir
   l’interruption avec le propriétaire. Ne pas rejouer les phases de transition
   Keycloak ni les migrations historiques. Déployer seulement après cet accord.
5. Attendre la disponibilité de Keycloak et des six services ; vérifier la
   découverte OIDC et l’administration privée. L’ancien thème est encore actif.
6. Dans la console privée, sélectionner **realm tarjama → Realm settings →
   Themes → Login theme → tarjama-v1 → Save**, sans toucher aux autres sélecteurs.
   Équivalent administré : PUT minimal du contenu de `theme-activation.json`
   sur `/admin/realms/tarjama`. Ne pas importer un realm complet, ne pas modifier
   `master.loginTheme` ou `adminTheme`, ne pas désactiver le cache en production.
   Préparer et appliquer ensuite le profil sans prénom/nom selon
   `docs/KEYCLOAK_REGISTRATION_PROFILE.md`, à partir de la configuration courante.
   Vérifier que seuls les deux attributs prévus changent.
7. Depuis le banc Mac autorisé : connexion existante, nouvelle inscription
   fictive avec uniquement email/mot de passe, absence des champs prénom/nom,
   erreur de mot de passe, MFA d’un compte de test, déconnexion/
   reconnexion et ressources du thème en 200, sur mobile et ordinateur. Contrôler
   isolation entre comptes, cookie Secure/HttpOnly, refus des routes réservées,
   limiteur et absence d’accès à la console publique. Retirer les nouveaux
   comptes fictifs via la procédure administrée, sans toucher aux utilisateurs.

## Retour arrière

1. **D’abord**, via la console privée du master inchangé, rétablir la valeur
   précédente de `tarjama.loginTheme` (choix par défaut si le champ était absent).
   Vérifier le retour du formulaire natif et une connexion. Cela suffit pour
   désactiver la présentation candidate, sans interrompre les services.
2. Si un retour d’image est nécessaire, réconcilier la recette effective en
   remettant uniquement l’image Keycloak antérieure :
   `preview.local/atelier/web@sha256:d214360d5a06cb111d456baa766224a7863d341f1d3a9b72d3cbc64070da98a4`.
   Le tag Docker conservé est `tarjama-keycloak:keycloak-20260928-aebc87f`.
   Vérifier/importer ce digest avant le déploiement administré de retour.
3. Si le réglage du profil doit aussi être annulé, restaurer les propriétés
   antérieures de `firstName` et `lastName` en conservant les autres paramètres
   courants (voir la passation profil). Ce réglage est indépendant de l’image.
4. Requalifier disponibilité, connexion, MFA, déconnexion et protections publiques.

Un rollback de recette seul ne restaure pas la valeur `loginTheme` en base.
Ne pas revenir à une image sans `tarjama-v1` tant que le realm le sélectionne.
Aucune restauration de base ni fermeture publique n’est requise par ce retour
de présentation et de collecte des informations d’inscription. Le report des sauvegardes hors VPS reste une décision du
propriétaire ; cette candidate ne change pas ce périmètre.
