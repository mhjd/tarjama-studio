# Retour administrateur — répétition intégrée, transition non exécutée

Suite à `/home/codex/.keycloak-transition-admin-20260928-y4j4c0ym/ADMIN_HANDOFF.md`,
`REPORT.md` et `rehearsal.json`, lus intégralement. Provenance/empreintes et preuve
conservées dans `web/deploy/keycloak/admin-rehearsal-20260928.json`.

## État actuel

- Répétition administrateur PASS sur copies : restauration, migration 005,
  simulation/association/inversion et retour avec l’ancienne API. Elle utilise
  une session et une clé de chiffrement synthétiques ; aucun login Authelia réel
  ni déchiffrement de clés fournisseurs qualifié par ce banc.
- CA/certificat durables créés, chemin Mac SSH → TLS vérifié → Service K3s testé.
  Exécuteur root `vps-keycloak-identity-link` installé, sans privilège ajouté à codex.
  Unités privées admin/limiteur/renouvellement préparées, non activées.
- Sept recettes inchangées, `validate`/`plan` rejoués après correction du courtier.
  Le plan 04 annonce bien web/worker dans `services_to_stop` ; preuves dans
  `web/deploy/keycloak/transition-plan-revised-20260928.json`. Les anciens reçus
  restent conservés ; leurs listes d’arrêts vides sont historiques.
- Aucune image ni recette modifiée. Revision active `39aef9dd3599278d` et readiness
  des quatre services inchangées avant/après ces contrôles en lecture seule.
  Aucune phase, migration réelle, association ou activation exécutée.

## Prochain échange avec l’administrateur

La préparation est intégrée au dépôt Tarjama sur `web-vps`. Ne pas répéter les
constructions, la création de CA ou le banc déjà réussis sans nouvelle raison.
La procédure de référence est `docs/KEYCLOAK_TRANSITION_20260928.md`, avec les sept
recettes dans `web/deploy/preview/keycloak-transition-20260928/` et le contrat
`web/deploy/keycloak/master-private-contract.json`.

Avant tout lancement :

1. Le propriétaire crée l’entrée DNS A `tarjama` → `178.32.16.177` dans la zone
   `runagen.com`, TTL 300 ou défaut. Pas d’AAAA sans qualification IPv6. Le DNS
   seul n’autorise aucune route publique ni transition.
2. Obtenir l’accord séparé de maintenance, avec disponibilité du propriétaire
   pour MFA et vérification du compte cible. Budget prudent proposé : créneau de
   30 minutes, dont environ 10–15 minutes de coupure, sans garantie de durée.
3. Recontrôler baseline, présence CRI, DiskPressure, marge disque, volumes/secrets
   et activité. Les déploiements peuvent recréer les services inchangés.

Pendant une fenêtre ensuite autorisée uniquement, suivre les phases avec arrêt
à chaque contrôle, jamais une boucle :

- 01–03 : authdb, Keycloak, raccordement privé au vrai Service, confiance navigateur
  explicite, `master.attributes.frontendUrl=https://localhost:9443`, admin nominatif
  MFA et révocation du bootstrap. Les unités préparées restent inactives avant
  cette autorisation. Le compte utilisateur cible réel doit être créé et sa
  possession vérifiée avant son premier callback Tarjama.
- 04 : fermer les admissions, stabiliser les traitements, arrêter web/worker,
  refaire les dumps et comparer les médias figés à l’archive avant réutilisation.
  Si elle diffère, recalculer la capacité ; ne pas écraser/purger les copies
  validées. Les 19,08 Gio libres observés à 10:25:55 UTC restent à remesurer.
  Vérifier les points de reprise, migrer 005 si absente, puis mappings réels via
  l’exécuteur root en simulation/application explicitement autorisée. Ne jamais
  réutiliser les sujets aléatoires du banc. Conserver les inverses et le journal
  privé des applications réussies ; vérifier UUID/projets et révoquer les sessions.
- Avant 05 : TLS public, discovery depuis web sur l’issuer exact et restrictions
  privées qualifiés. 05 : propriétaire retrouvant ses données, second compte
  isolé, login/logout/cookies/médias/révocation et console privée vérifiés.
- 06 : reprise contrôlée des jobs et parcours métier court, appels fournisseurs
  compris seulement dans le périmètre autorisé. L’ouverture aux visiteurs reste
  soumise à une autorisation distincte.
- Retour : maintenance, point de reprise récent, inversion des seuls mappings
  appliqués, sessions révoquées, puis 07 et routage Authelia rétabli séparément.
  Préserver comptes, textes, médias, bases et volumes, y compris ceux créés après
  bascule. Le rollback de recette ne restaure ni les données ni les identités.

Les sauvegardes hors VPS restent reportées selon la décision du propriétaire.
Les copies de répétition ne sont pas le point de coupure définitif. Le contrat
proposé de rétention des nouvelles générations Keycloak reste manuel, sans purge
ni planification activée ; copies historiques conservées.

**Ne déployer aucune phase ni la candidate désactivée avant l’accord séparé.**
La lecture de cette passation, les plans réussis et la répétition ne l’accordent pas.
