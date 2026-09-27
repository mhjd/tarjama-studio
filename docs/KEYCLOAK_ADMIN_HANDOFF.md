# Retour administrateur — domaine unique sans SMTP

Cette passation remplace celles des commits `9d1f6a9` et `2ee17b7`. Elle répond à :
`/home/codex/.keycloak-admin-handoff-20260927-QC1dot/ADMIN_HANDOFF.md`.
Lire [le contrat actuel](KEYCLOAK_SINGLE_DOMAIN_20260927.md) pour les preuves,
limitations, commandes et règles exactes de routage.

## Prompt à transmettre

Les adaptations applicatives au choix du propriétaire sont préparées sur
`web-vps`, dépôt `/home/codex/projects/tarjama-studio` :

- domaine unique `https://tarjama.runagen.com` ;
- base Keycloak `https://tarjama.runagen.com`, issuer exact
  `https://tarjama.runagen.com/realms/tarjama` ;
- entrées utilisateur `/sign-in` et `/sign-up` vers Tarjama ;
- **abandon du préfixe `/identity`** demandé par le propriétaire : ne pas
  l’installer. Keycloak utilise la racine `/`, au build et au runtime, et ses
  chemins natifs `/realms/tarjama/...` et `/resources/...` sont conservés ;
- aucun SMTP, vérification email ou récupération automatique ; les quatre secrets
  déjà créés sont réutilisés, sans rotation ou lecture de leurs valeurs ;
- callback acceptant les claims email absents/faux, avec tous les contrôles OIDC
  et l'isolation `(issuer, subject)` conservés ;
- administration privée proposée à `https://localhost:9443` via tunnel
  SSH/TLS, adresse à confirmer et parcours complet à qualifier.

Le test local avec Keycloak réel, chemins natifs et proxy loopback passe :
inscription, login/logout, assets, cookies, isolation, révocation back-channel,
readiness et restauration SQL. Il utilise une copie runtime temporaire en RAM,
**sans construire ou importer d'image**. Il ne qualifie ni votre routage ni une
image finale. Les changements nécessitent de nouvelles images web/Keycloak ;
le manifeste worker doit aussi être confirmé pour la candidate coordonnée.

La coordination directe n'a pas pu être ouverte : `discussion --compact list`
retourne `invalid_work_trace_layout` sur `.discussions/.namespace.lock`, et
`runtime status` ne fournit aucun agent destinataire. Aucun verrou modifié.

Merci de :

1. Confirmer la marge disque et un créneau pour les builds/imports sérialisés,
   ainsi qu'une copie récupérable des images. Dernier relevé applicatif : environ
   17 Gio libres, 84 %. Aucun nettoyage global ou import à l'aveugle.
2. Faire reprendre ensuite les builds des sources actuelles et imports par
   `vps-preview image-import`, avec vérification des images exactes. Les anciens
   digests web/Keycloak ne représentent pas le nouveau code ; ne pas simplement
   réimporter l'ancien manifeste. Le fichier historique est explicitement marqué
   obsolète et refusé par le générateur.
3. Confirmer l'URL privée admin/tunnel/TLS. Préparer le routage public filtré selon
   `docs/KEYCLOAK_SINGLE_DOMAIN_20260927.md`, sans exposer admin, master, health,
   metrics ou console de compte, et sans détourner `/sign-in`, `/sign-up` ou les `/auth/*` de Tarjama.
   Réserver les racines techniques et refuser les anciennes routes `/identity`.
   Qualifier aussi le login de la console admin via le tunnel ; ne pas ouvrir
   master sur le domaine public pour contourner un échec de ce parcours.
4. Remplacer les `REQUIRED_*_IMAGE` du brouillon en régénérant avec les références
   retournées et l'URL privée retenue, puis reprendre `validate` et `plan`.
   Le brouillon actuel échoue volontairement faute d'images par digest ; aucune
   validation complète de la candidate n'est annoncée.
5. Finaliser sauvegardes planifiées, rétention, destination hors VPS et
   restauration, ainsi que limites de requêtes et capacité d'exploitation.

Préserver les PVC, la clé de chiffrement, Authelia des services personnels et
le digest egress :
`preview.local/atelier/web@sha256:19994f1cb8ab15277356be24380fba1982e62753d216ddb41a459effcdd5d39a`.

**Aucune bascule, ouverture publique, activation ou migration réelle sans accord
séparé. Ne pas appliquer la candidate désactivée sur l'atelier actif.** Avant une
bascule autorisée : sauvegarde restaurable, admin nominatif avec MFA puis retrait
bootstrap, association explicite du propriétaire, tests avec deux comptes sur
les images finales et refus vérifiés des routes privées.

Retour attendu : capacité/coordination des images, adresse privée retenue,
qualification du contrat de routage et sauvegardes restantes, sans secret.
