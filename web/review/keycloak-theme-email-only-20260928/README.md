# Tarjama : inscription sans prénom ni nom

Ouvrir `preview/index.html` pour voir la galerie actualisée. La page
Inscription ne demande que l’adresse email, le mot de passe et sa confirmation.

4 scénarios navigateur PASS (ordinateur, iPhone 15, Pixel 6 simulés sous Chromium,
isolation/révocation), 13 tests de contrat PASS, MFA et sauvegarde/restauration
PASS. Un compte créé avant le changement conserve son prénom et son nom.
Les attributs de nom ne sont plus visibles ni obligatoires dans les formulaires
utilisateur. Pas de masquage CSS ni de formulaire recréé dans Tarjama.

Le changement relève du profil utilisateur natif de Keycloak. L’image du thème
reste inchangée. Rien n’a été modifié sur le site public. La configuration doit
être appliquée par l’administrateur lors de l’activation autorisée ; voir
`docs/KEYCLOAK_THEME_ADMIN_HANDOFF.md` et `docs/KEYCLOAK_REGISTRATION_PROFILE.md`
dans le dépôt (également joints au dossier de livraison).

Les fichiers `profile-before.json` et `profile-after.json` sont des preuves
issues du realm jetable. Ne pas les appliquer au serveur public : préparer le
changement à partir du profil réellement en place, en préservant ses autres
paramètres. Les comptes, projets, permissions applicatives et secrets ne sont
pas modifiés par le générateur de configuration.
