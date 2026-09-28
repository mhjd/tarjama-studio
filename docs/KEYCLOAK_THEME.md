# Thème de connexion Tarjama

Le thème `tarjama-v1` appartient au dépôt et à l’image Keycloak. Il reprend les
couleurs et la pile typographique de `web/frontend/src/styles.css` : fond
`#111719`, surface `#192624`, action `#b2d89d`, texte `#e5ece9`, police
Inter/system-ui/sans-serif. Comme l’application, il utilise la police système
si Inter n’est pas installée. Aucun téléchargement de police ou CDN.

Le formulaire d’inscription demande uniquement l’email et le mot de passe
(avec confirmation). Ce choix relève du [profil Keycloak](KEYCLOAK_REGISTRATION_PROFILE.md),
à appliquer séparément au realm existant ; aucun nom n’est demandé.

## Périmètre et maintenance

`web/deploy/keycloak/themes/tarjama-v1/login/` hérite de `keycloak.v2` dans
Keycloak 26.7.4, dont l’image de base est épinglée par digest. La présentation
est sombre même si le système préfère le clair. Les ressources restent sous
`/resources/`, déjà prévu par le routage administrateur.

Les formulaires, champs, scripts de visibilité du mot de passe, validations,
protection CSRF, OIDC, PKCE, étapes MFA et déconnexion restent ceux de Keycloak.
Seul le point d’extension natif `footer.ftl` est personnalisé, en plus des CSS,
messages français/anglais et favicon. Pas de copie des templates de formulaire,
pas de JavaScript ajouté, aucun mot de passe ne passe par Tarjama. Les messages
d’erreur natifs restent spécifiques à leurs champs et leur sémantique est
conservée. La récupération par email n’est pas proposée puisqu’elle n’existe pas.

Le thème ne contient aucun répertoire `admin`, `account` ou `email`. Il doit être
sélectionné uniquement comme **Login theme du realm tarjama**, jamais pour
`master`. Le Dockerfile l’installe mais ne l’active pas : le realm importé et
l’entrypoint ne sont pas modifiés. L’import au démarrage ne mettrait de toute
façon pas à jour un realm déjà existant.

Approche fondée sur la [documentation officielle des thèmes Keycloak](https://www.keycloak.org/ui-customization/themes),
et vérifiée contre les templates de l’image 26.7.4 réellement construite.
Lors d’une montée de version, relancer les tests et examiner les captures :
l’héritage réduit les duplications, mais les classes CSS natives peuvent évoluer.

## Reproduire les contrôles

```sh
make web-keycloak-theme-test
make web-keycloak-recipe-test
```

Nécessite Docker Compose, une image `tarjama-web-tools:test` construite, les
caches de dépendances du projet et les images PostgreSQL/Keycloak. Le premier
objectif construit l’image puis exécute les vrais parcours Keycloak/OIDC contre
des bases éphémères, sur un réseau Docker interne **sans port publié**. Aucun
secret de production, appel IA, modification de protection réseau ou traitement
de vidéo. Le nettoyage automatique retire uniquement ce banc de test.

Si `make` n’est pas installé sur l’hôte (cas du banc du 28 septembre), les deux
commandes du target peuvent être exécutées littéralement : construction Docker,
puis `KEYCLOAK_THEME_TEST=1 sh web/scripts/keycloak-test.sh`.

`theme.spec.ts` contrôle les parcours aux dimensions 1440×932 (ordinateur),
393×852 (iPhone 15) et 412×915 (Pixel 6), avec Chromium. Ce sont des dimensions
simulées, pas des essais sur appareils physiques ou Safari iOS. Les captures
sont dans `web/.cache/keycloak-test/preview/`. Les secrets TOTP, mots de passe,
cookies et codes OIDC ne sont pas enregistrés en vidéo ni trace.

Pour l’essai MFA, l’action d’enrôlement TOTP est enregistrée uniquement dans
le realm jetable ; aucun réglage MFA du serveur public n’est modifié. Le test
utilise la clé manuelle en mémoire et ne la conserve dans aucune preuve.

Le banc contrôle également l’isolation entre deux utilisateurs, la révocation
par déconnexion, la récupération administrée synthétique et une sauvegarde/
restauration de la base Keycloak. Ces contrôles locaux complètent les preuves
administrateur sur le proxy/TLS public ; ils ne les remplacent pas.

## Activation

Voir `docs/KEYCLOAK_THEME_ADMIN_HANDOFF.md` pour l’image candidate et le résultat
exact des essais. Le patch `web/deploy/keycloak/theme-activation.json` est destiné
au realm `tarjama` via son administration privée **après validation visuelle**.
Ne jamais réimporter un realm complet pour appliquer ce changement graphique.

Pour composer un aperçu hors ligne à partir de ces captures :

```sh
make web-keycloak-theme-gallery
```

Une évolution visuelle ultérieure utilisera un nouveau nom de thème (`tarjama-v2`,
par exemple) afin de distinguer les assets mis en cache et de garder un retour
arrière explicite. Ne pas désactiver le cache de thème sur le serveur public.
