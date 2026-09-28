# Retour administrateur — images du 28 septembre, aucune bascule

Réponse à `/home/codex/.keycloak-admin-handoff-20260928-4QGMcB/ADMIN_HANDOFF.md`.
Cette passation remplace le précédent état « images à construire ».
Lire [le rapport des images](KEYCLOAK_IMAGES_20260928.md),
[le contrat de routage](KEYCLOAK_SINGLE_DOMAIN_20260927.md) et
[les preuves structurées](../web/deploy/keycloak/qualification-20260928.json).

## Prompt à transmettre

Les nouvelles images Tarjama sont construites et importées depuis
`aebc87f190ac78167573d9821cf23177403a2518`, sur `web-vps`, dépôt
`/home/codex/projects/tarjama-studio`. Les builds/imports ont été sérialisés,
avec marge calculée après pic >= 15 % du disque, et 4 × taille Docker par import.
Seuls les caches reconstructibles identifiés de Tarjama ont été nettoyés ; preuves,
projets, vidéos, dumps, anciennes images et volumes sont conservés.

Références exactes :

- web : `preview.local/atelier/web@sha256:b5655ab7a7f604ab66b3f87f9e03a1a8ffec648f1d748337b33434aa1e32179b`
- worker : `preview.local/atelier/web@sha256:cd36a50a4ffae2ee97630eda4eda26e702fbff2ca392b29b1e8206d6d14119cb`
- Keycloak : `preview.local/atelier/web@sha256:d214360d5a06cb111d456baa766224a7863d341f1d3a9b72d3cbc64070da98a4`

Correspondance IDs Docker immuables / tags datés / tailles / digests dans
`web/deploy/keycloak/images-20260928.json`. Les copies Docker sont conservées
sur ce VPS pour réimport, sans prétendre constituer une sauvegarde hors VPS.

`web/deploy/preview/keycloak-candidate-20260927.yml` est régénérée, sans
placeholders, avec les six services **désactivés**. `validate` et `plan` passent :
révision `9017da632b208055`, `applied: false`, volumes déclarés 19 Gio.
L’atelier actif reste `39aef9dd3599278d`, web/worker/db/egress prêts.
Ne pas appliquer cette candidate arrêtée sur cet atelier.

L’image Keycloak finale a réussi le parcours navigateur Docker isolé :
inscription sans SMTP, connexion/logout, isolation de deux comptes, cookies,
assets, révocation back-channel, puis dump/restauration SQL et rôle restreint.
Le web de ce test est exécuté depuis les sources du build ; cela ne qualifie
ni Kubernetes ni votre proxy/TLS. Le worker final valide le corpus et expose
les outils sans réseau. Aucun fournisseur IA ni secret réel n’a été utilisé.

Travail administratif restant :

1. Vérifier **maintenant par CRI** la présence des nouveaux digests, puis de toutes
   les références de la candidate, et refaire cette vérification juste avant une
   éventuelle activation. Le courtier a confirmé les imports ; l’agent applicatif
   ne dispose pas d’accès CRI indépendant. Les jobs privés historiques
   `preview-check`/`reference-check` ne qualifient pas la future origine publique.
2. Qualifier la console privée complète à `https://localhost:9443` via SSH/TLS,
   avec certificat vérifiable et parcours master/admin privé. Aucun `-k`, aucune
   exposition de master/admin pour corriger un problème de redirection.
3. Finaliser la limitation des inscriptions/requêtes, distincte de la protection
   brute-force du realm. Le routage Caddy annoncé à 33 cas synthétiques doit
   ensuite être qualifié sur les vrais chemins applicatifs et médias, les
   cookies et les en-têtes HTTPS, dans un cadre isolé autorisé.
4. Documenter une rétention locale bornée et une restauration reproductible.
   Le propriétaire **reporte les sauvegardes hors VPS**, risque de perte du VPS
   accepté ; conserver les dumps/copies actuels. Ne pas traiter ce report comme
   une sauvegarde opérationnelle, ni activer une planification implicitement.

Le contrat reste : `tarjama.runagen.com`, `/sign-in` et `/sign-up` vers Tarjama,
issuer `https://tarjama.runagen.com/realms/tarjama`, Keycloak à la racine `/` sans
préfixe `/identity`. Aucun SMTP, email vérifié obligatoire ou récupération
automatique. Les quatre secrets existants ne sont ni lus ni renouvelés.
L’identité reste `(issuer, subject)` ; aucune association automatique par email.

Préserver les PVC, la clé de chiffrement et Authelia des services personnels.
L’egress demeure exactement :
`preview.local/atelier/web@sha256:19994f1cb8ab15277356be24380fba1982e62753d216ddb41a459effcdd5d39a`.

**Aucune bascule, ouverture publique, activation ou migration réelle sans accord
séparé.** L’import des images et la validation de recette ne constituent pas cet
accord. La coordination directe via `discussion --compact list` reste bloquée
par `invalid_work_trace_layout` sur `.discussions/.namespace.lock` ; aucun verrou
modifié, aucun message administrateur prétendument transmis.

Retour attendu : présence CRI des images, qualification console privée/TLS,
limitation des requêtes et état du routage, sans valeur secrète.
