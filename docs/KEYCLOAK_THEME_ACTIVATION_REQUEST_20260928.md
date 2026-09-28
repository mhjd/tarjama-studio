# Activation administrateur — demande historique terminée

> Terminée le 28 septembre à 20:32 UTC ; qualification publique PASS à 20:36 UTC.
> Voir `KEYCLOAK_THEME_ADMIN_HANDOFF.md` et la passation administrateur `THEME_HANDOFF.md`.
> Les instructions suivantes documentent la préparation, pas une action à relancer.

Le propriétaire a validé la présentation et demandé explicitement « active le »
puis « puis déploie ». L'autorisation couvre le thème de connexion/inscription
Tarjama et le formulaire sans prénom/nom. Aucun nouvel accord de principe à
solliciter pour cette activation. Ne modifier ni MFA ni les autres protections.

## Partie applicative

L'image contenant `tarjama-v1` est installée en révision `29bd0ed9ca04cd7b`.
Recette : `web/deploy/preview/active-keycloak-theme-image-20260928.yml`.
Elle reprend la révision UI `176b335c5056984a` et ne change que l'image Keycloak :

`preview.local/atelier/web@sha256:dea98c02a8a575f8ebf3be9a1702d6e1ff5be4e082b0143baf7d436ba820158a`

Copie Docker : `tarjama-keycloak:theme-v1-b2b4f08`. Réimport réussi, sauvegarde
des deux bases `pv-job-backup-b1e904dc` Succeeded avant déploiement. Le cache Go
reconstructible `web/.cache/build` (341 Mio) a été retiré pour maintenir la marge
disque ; aucune preuve, donnée ni image de retour supprimée.

Après déploiement : six services prêts, `partial=false`, contrôle interne
`pv-job-preview-check-3678ee80` Succeeded (readiness, refus anonyme des projets,
assets UI exacts). Preuves : `web/review/keycloak-theme-installed-20260928/`.
Ce contrôle ne vérifie pas la sélection du thème ou le profil natif dans le realm.

Le compte projet n'a pas d'identité administrateur Keycloak. Le canal Discussion
ne permet même pas l'inspection : `invalid_work_trace_layout: unexpected file
type: /home/codex/.discussions/.namespace.lock`. Ce fichier n'a pas été modifié.
Ne pas créer de compte bootstrap, lire les secrets administrateur ou contourner
la console privée par une écriture SQL pour réaliser ce changement.

## Action via l'administration privée

Lire `docs/KEYCLOAK_THEME_ADMIN_HANDOFF.md` et
`docs/KEYCLOAK_REGISTRATION_PROFILE.md`. L'image est déjà installée : ne pas
redéployer une ancienne recette ni rejouer la transition.

1. Vérifier l'état courant et sauvegarder en privé la valeur de `loginTheme` du
   realm `tarjama` ainsi que son profil utilisateur complet
   (`GET /admin/realms/tarjama/users/profile`).
2. Appliquer uniquement `web/deploy/keycloak/theme-activation.json`
   (`{"loginTheme":"tarjama-v1"}`) au realm `tarjama` via son API admin privée,
   ou sélectionner Login theme = tarjama-v1 dans la console. Ne pas modifier
   master, adminTheme, accountTheme ou les autres réglages du realm.
3. Passer le profil courant au générateur hors ligne
   `web/scripts/keycloak-user-profile.py` (cible Make
   `web-keycloak-profile-prepare`). Vérifier que seuls `firstName` et `lastName`
   perdent leur contrainte required et deviennent visibles/éditables uniquement
   par admin. Les valeurs existantes et les autres attributs restent conservés.
   Relire le profil avant le PUT complet ; régénérer s'il a changé.
4. Contrôler le rendu et les ressources du thème via le banc Mac autorisé,
   connexion, inscription sans prénom/nom, erreurs, MFA et déconnexion. Maintenir
   `https://tarjama.runagen.com` public, l'administration9443 privée, les refus
   master/admin/account publics, le limiteur et le garde UID des agents.
5. Renvoyer une passation sans secrets indiquant les réglages effectivement
   appliqués, les résultats et les éventuelles limites. Ne pas relancer l'IA.

Retour : rétablir d'abord la valeur précédente de loginTheme et, si nécessaire,
les seules propriétés des deux attributs sauvegardées. Si une image doit être
retirée, rétablir ensuite uniquement l'ancien digest Keycloak
`d214360d5a06cb111d456baa766224a7863d341f1d3a9b72d3cbc64070da98a4`.
Ne pas retirer l'image du thème pendant qu'il est sélectionné dans le realm.

Cette passation ne prétend pas que le thème ou le profil ont déjà été activés.
