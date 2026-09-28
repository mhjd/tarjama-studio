# Retour administrateur — transition préparée, pas exécutée

Suite à `/home/codex/.keycloak-admin-handoff-20260928-final-lpwtsuav/ADMIN_HANDOFF.md`.
Les preuves CRI et la qualification privée PASS ont été lues et conservées avec
leur provenance dans `web/deploy/keycloak/admin-qualification-20260928.json`.

## Prompt à transmettre

La proposition de transition est prête sur `web-vps` dans le dépôt Tarjama :

- `docs/KEYCLOAK_TRANSITION_20260928.md` : ordre, gates, impact comptes/données,
  sauvegardes, migrations, vérifications et retour ;
- `web/deploy/preview/keycloak-transition-20260928/` : sept recettes de phase ;
- `web/deploy/keycloak/master-private-contract.json` : réglage privé attendu,
  à fusionner dans les attributs existants du realm master pendant le bootstrap ;
- `web/deploy/keycloak/transition-qualification-20260928.json` : résultats de
  préparation, révisions `validate`/`plan`, absence d’application.

**Aucune image n'a changé** : digests qualifiés du build `aebc87f` conservés,
ainsi que l’egress réparé et les volumes historiques. Aucun service, proxy,
identité réelle, migration SQL ou sauvegarde planifiée n'a été modifié.

Ordre proposé après accord :

1. Recontrôler baseline, CRI, marge disque, PVC/secrets, copies de retour et impacts
   des recréations possibles. Préparer le raccordement privé K3s/TLS durable.
2. `01-authdb`, puis `02-private-bootstrap` : anciens web/worker conservés actifs.
   Créer le socle identité dédié, régler **master.attributes.frontendUrl à
   https://localhost:9443**, vérifier la console complète et les refus publics.
   Ne pas changer l’issuer Tarjama ni exposer master/admin.
3. Créer/tester l’administrateur nominatif MFA, révoquer le bootstrap, puis
   `03-private-identity-ready` qui retire son montage. Recontrôler le login.
4. Fermer les admissions, stabiliser les traitements puis `04-maintenance`
   (web/worker arrêtés explicitement). Sauvegarde cohérente et restauration sur
   copies, inventaire SQL, migration 005 si absente, mappings d’identités en
   simulation puis application explicite, vérification des UUID/projets et
   révocation des sessions/flows de l’ancienne origine.
5. `05-private-web`, puis `06-private-worker` après leurs gates : deux comptes,
   données existantes, isolation/média/SSO, puis vidéo courte et reprise des jobs.
   Garder les restrictions privées tant que l'ouverture publique n'est pas autorisée.
6. Retour : fermer admissions, maintenance, sauvegarder l'état récent, inverser
   uniquement les mappings appliqués, révoquer sessions, puis `07-return-authelia`
   et restaurer séparément le routage privé de l’aperçu. Aucune suppression de
   nouveaux comptes, projets, textes, bases ou volumes.

À préparer avant la fenêtre autorisée :

- certificat/CA durables, confiance Mac, renouvellement et upstreams K3s ;
- point de reprise cohérent bases/médias/secrets, avec taille/marge contrôlées ;
- exécuteur admin borné pour `identity-link --file` utilisant l’image web exacte,
  le seul accès DB applicatif et un JSON privé en lecture seule ; ce job/montage
  ne figure pas dans la recette et ne doit pas être improvisé par l'application ;
- liste privée des utilisateurs à associer, identité cible créée/vérifiée avant
  son premier callback Tarjama, mappings inverses et journal d'application ;
- répétition sur copies de la migration et du retour avant d'écrire dans les bases
  réelles, puis qualification réseau/HTTP/TLS/limites sur le raccordement réel.

Les limites isolées 5 inscriptions/min/IP, 20/min global et 300 requêtes
identité/10 s/IP sont intégrées comme critères de vérification, pas comme déjà
actives en production. Le contrat de rétention proposé (3 nouvelles générations,
512 Mio cumulés dans identity-backups, validation/restauration avant remplacement)
reste opérateur : aucun automate de purge/planification ajouté. Le report des
sauvegardes hors VPS par le propriétaire est respecté ; dumps existants conservés.

**Ne pas déployer la candidate à six services arrêtés sur l’atelier actif.**
`validate`/`plan` ne sont pas une autorisation. Attendre l'accord séparé du
propriétaire couvrant l'interruption/migration/bascule ; l'ouverture publique
nécessite son autorisation explicite. Ce document ne lance aucune de ces actions.
