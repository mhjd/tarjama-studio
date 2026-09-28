# Retour administrateur — pile privée qualifiée, ouverture à autoriser

État actuel : phase 06, révision `00305da3b4b44e06`. Sources :

- `/home/codex/.keycloak-transition-admin-20260928-y4j4c0ym/LIVE_HANDOFF.md` ;
- `/home/codex/.keycloak-business-admin-20260928/README.md` et `qualification.json` ;
- `docs/KEYCLOAK_BUSINESS_QUALIFICATION_20260928.md` : résultats et limites ;
- `docs/PREOPENING_20260928.md` : derniers contrôles applicatifs.

La transition, MFA nominatif, retrait du bootstrap, migration 005, association
du propriétaire et essais réels sont faits. **Ne pas rejouer les phases 01–06,
ne pas recréer le bootstrap et ne pas utiliser l’ancienne identité Authelia pour
la nouvelle API.** Les sauvegardes de coupure et le mapping inverse restent privés.

## Recettes réconciliées dans le dépôt

`web/deploy/preview/active-keycloak-private-20260928.yml` reprend sémantiquement
la recette administrée réellement déployée. Son plan donne `00305da3b4b44e06`.
Les sept recettes de transition et la candidate sont alignées sur
`KC_HOSTNAME_ADMIN=https://tarjama.runagen.com:9443`, comme le contrat master.
Le générateur refuse désormais l’ancienne origine localhost pour cette transition.
Images, volumes, secrets référencés, issuer public et egress réparé sont préservés.
Ces recettes ne configurent pas les protections du proxy administré et ne les
remplacent pas. Aucun nouveau déploiement nécessaire pour les tests ajoutés.

## Ouverture limitée — après accord distinct du propriétaire seulement

La demande actuelle est de terminer le travail **avant** l’ouverture. Lorsqu’elle
sera autorisée, utiliser la configuration Ansible administrée du routage, conserver
la pile phase 06 et :

1. Recontrôler sa santé, la marge disque, le certificat HTTPS et le point de reprise.
2. Ouvrir uniquement l’application et les endpoints publics nécessaires du realm
   Tarjama, en conservant le limiteur déjà qualifié et l’issuer exact. Master,
   console admin, autres realms, health et metrics restent privés/refusés.
   Ne pas ouvrir le port admin9443 sur Internet ni lever le garde UID de codex.
3. Contrôler depuis une connexion extérieure ordinaire accueil, inscription,
   connexion, déconnexion/reconnexion, médias privés, isolation entre deux comptes
   de test, refus admin/master et limitation. Ne pas utiliser les comptes personnels
   ni relancer le pipeline IA déjà qualifié pour prouver seulement le routage.
4. Garder l’ancien aperçu en maintenance ou le traiter explicitement selon le
   contrat de routage, sans créer d’accès alternatif qui contourne Keycloak.
5. Retour d’exposition : refermer les seules routes nouvellement ouvertes en
   conservant l’accès privé. Un retour d’identité/migration serait une opération
   différente, avec point de reprise et mappings inverses, jamais un rollback
   aveugle de recette ou de base.

Conserver les décisions du propriétaire : pas de SMTP ni de récupération email,
sauvegardes hors VPS reportées, crédits fournisseurs partagés avec files d’attente.
Le succès sur une vidéo courte ne démontre pas la capacité à accueillir un grand
nombre d’utilisateurs : privilégier une première ouverture limitée et surveillée.
Les limites de rendu SRT et le chevauchement de l’habillage original ne bloquent
pas ce périmètre ; elles restent documentées, sans promesse de traduction parfaite.

Aucune autorisation d’ouverture ne découle de ce fichier. Le parcours réel et les
preuves sont déjà conservés hors rétention 24 h ; ne pas les régénérer inutilement.
