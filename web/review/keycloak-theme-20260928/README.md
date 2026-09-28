# Aperçu du thème de connexion Tarjama

Ouvrir `preview/index.html` : 17 captures des vrais formulaires Keycloak avec
comptes fictifs. Cliquer sur une capture pour l’agrandir.

La candidate reprend l’identité sombre/verte de Tarjama, en français et anglais.
Elle couvre connexion, inscription, erreurs, confirmation de déconnexion et MFA.
Les mots de passe restent traités directement par Keycloak ; pas de formulaire
d’authentification recréé dans l’application. La console d’administration garde
son thème actuel.

## Vérifications

- Image testée : `tarjama-keycloak:theme-v1-b2b4f08`, commit `b2b4f08`.
- 4 scénarios Playwright passent : parcours complet dans chaque format,
  isolation entre comptes/révocation, plus langue et TOTP dans le scénario desktop.
- 11 contrats Python passent ; sauvegarde/restauration de la base jetable PASS.
- Aucun appel IA ni usage de secret de production. Pas de trace contenant
  mots de passe, clé TOTP, cookies ou codes OIDC dans ce dossier.
- Ordinateur 1440×932, iPhone 15 393×852, Pixel 6 412×915 : dimensions simulées
  sous Chromium. Pas de qualification sur Safari iOS/appareils physiques.
- Les premiers essais ont révélé des conflits CSS du thème parent et des
  sélecteurs/prérequis du banc à corriger. Les journaux ici sont ceux de la
  dernière exécution réussie sur l’image candidate finale.

`candidate.json` donne le digest importé. `validate.json` et `plan.json`
confirment la préparation, sans application. `status-before.json` et
`status-after.json` confirment la révision publique inchangée `00305da3b4b44e06`.

La candidate n’est pas activée. Valider d’abord son apparence ; l’administrateur
pourra ensuite appliquer `docs/KEYCLOAK_THEME_ADMIN_HANDOFF.md` depuis le dépôt.
Cette procédure inclut le retour au thème précédent **avant** un éventuel
retour d’image, car un rollback d’image seul ne change pas le realm en base.
