# Images Keycloak préparées — 28 septembre 2026

Suite à `/home/codex/.keycloak-admin-handoff-20260928-4QGMcB/ADMIN_HANDOFF.md`.
Sources : `aebc87f190ac78167573d9821cf23177403a2518` sur `web-vps`.
Cette révision ajoute uniquement un label de provenance au build Keycloak et
limite son contexte Docker à Dockerfile/entrypoint ; le code applicatif testé
reste celui de `cfdd9ed`. Aucun nouveau secret ni changement de données.

## Artefacts et recette

- **web** : `preview.local/atelier/web@sha256:b5655ab7a7f604ab66b3f87f9e03a1a8ffec648f1d748337b33434aa1e32179b` (155,713,016 octets).
- **worker** : `preview.local/atelier/web@sha256:cd36a50a4ffae2ee97630eda4eda26e702fbff2ca392b29b1e8206d6d14119cb` (192,219,985 octets).
- **keycloak** : `preview.local/atelier/web@sha256:d214360d5a06cb111d456baa766224a7863d341f1d3a9b72d3cbc64070da98a4` (762,262,407 octets).

Le [manifeste](../web/deploy/keycloak/images-20260928.json) conserve les IDs Docker
immuables, tags datés, tailles, architecture amd64 et commit source. Les IDs
Docker (index OCI) diffèrent des digests de manifeste retournés par l’importeur :
la recette reprend exactement ces derniers. Les copies Docker restent sur ce
VPS pour un réimport, **pas comme sauvegarde hors VPS**. Les anciens tags `review`
ont également été conservés sous `before-keycloak-20260928` avant remplacement.

[Candidate](../web/deploy/preview/keycloak-candidate-20260927.yml) régénérée sans
placeholder : six services `enabled: false`, quatre jobs explicites, 19 Gio de
stockage déclaré. Le digest egress de récupération et les volumes existants sont
inchangés. `validate` et `plan` réussissent, révision **`9017da632b208055`**,
`applied: false`. Ne pas appliquer cette recette arrêtée sur l’atelier actif.

## Marge disque et opérations

Réserve minimale : **15 433 214 362 octets** (15 % de la partition, 14,37 Gio).
Avant chaque opération : espace disponible moins pic estimé >= réserve.
Import : pic estimé = **4 × taille Docker complète**, sans déduire les couches
partagées. Les builds ont été sérialisés avec les imports. Un contrôle toutes
les deux secondes arrête la commande si l’espace s’approche de la réserve ; les
valeurs ci-dessous sont des mesures échantillonnées, pas une réservation disque.

| Opération | Disponible avant (Gio) | Pic provisionné (Gio) | Disponible projeté (Gio) | Minimum mesuré (Gio) |
| --- | ---: | ---: | ---: | ---: |
| build-keycloak | 17.44 | 1.00 | 16.44 | 17.08 |
| import-keycloak | 17.34 | 2.84 | 14.50 | 16.33 |
| build-web | 16.63 | 1.00 | 15.63 | 16.14 |
| import-web | 16.20 | 0.58 | 15.62 | 16.11 |
| build-worker | 16.16 | 0.50 | 15.66 | 16.05 |
| import-worker | 16.07 | 0.72 | 15.35 | 15.99 |

Les estimations des builds utilisent les couches existantes : sources et
compilation web/backend, corpus worker inchangé, runtime Keycloak déjà local.
Aucun téléchargement d’une nouvelle image de base ni build concurrent détecté.

Caches supprimés, tous reconstructibles : `web/.cache/build` (compilation Go),
`web/.cache/npm` (téléchargements npm), `web/.cache/go` (modules Go) et
`web/.cache/playwright/firefox-1490` (runtime téléchargé, aucun enregistrement).
Des entrées BuildKit identifiées par ID ont été retirées : anciens étages de
construction Tarjama/Keycloak, sans retrait d’image. Inventaire et suppressions
exactes sont conservés dans `web/.cache/keycloak-images-20260928/`.
Aucune suppression globale, preuve, sortie de benchmark, média, donnée, dump,
volume ou image. Les preuves du précédent test Keycloak sont conservées dans
`web/.cache/keycloak-test-evidence-before-20260928/` ; elles n’ont pas été écrasées.

## Vérifications et limites

- Builds web, worker et Keycloak réussis ; labels de commit et architecture vérifiés.
- Trois imports confirmés par le courtier ; copies Docker exactes conservées.
- Trois tests du générateur réussis ; comparaison explicite de la candidate aux
  volumes et à l’egress existants réussie, aucune référence provisoire restante.
- L’image worker charge et valide les outils du corpus en conteneur non privilégié,
  racine en lecture seule et sans réseau. Aucun appel à un fournisseur IA.
- Le test navigateur de l’image Keycloak finale est consigné dans
  `web/.cache/keycloak-images-20260928/test-keycloak-image.log` : **réussi, 9,9 s**
  de navigateur. Inscription/connexion/logout, isolation de deux comptes,
  cookies/assets, révocation signée et récupération administrée synthétique.
  Dump/restauration de la base dédiée et rôle SQL restreint : **réussis**.
  Le serveur Tarjama de cet essai est exécuté depuis les sources identiques
  au build, pas depuis l’image web finale ; aucune qualification Kubernetes
  ou du proxy public n’est déduite de cet essai Docker local.

**Présence CRI indépendante restant à contrôler par l’administrateur** : le
courtier a confirmé les imports, mais ni son catalogue ni `validate`/`plan` ne
prouvent une présence persistante après GC. Aucun accès CRI direct n’est disponible
au compte applicatif. `discussion --compact list` reste en erreur sur
`.discussions/.namespace.lock`, sans destinataire joignable. Aucun contournement
via Docker, socket de runtime ou sudo n’a été tenté. Contrôler les digests de
*toute* la candidate (dont PostgreSQL, egress et qualification historique), puis
les recontrôler juste avant toute activation autorisée.

Les jobs `preview-check`/`reference-check` sont les anciens outils privés ; leur
présence dans la recette n’en fait pas une qualification de la nouvelle origine.
Le routage administrateur n’a été qualifié que sur les upstreams synthétiques
(33 cas annoncés). Le proxy réel, les médias, TLS, cookies en HTTPS, la console
privée complète/master et la limitation des inscriptions/requêtes restent à tester.
Le hostname admin `https://localhost:9443` reste proposé, non qualifié.

## Sauvegardes et arrêt

Le propriétaire reporte les sauvegardes hors VPS et accepte le risque de perte
du VPS entier. Ne pas en faire une dépendance bloquante automatique pour cette
préparation, ni annoncer qu’une sauvegarde opérationnelle existe. Les dumps et
copies actuels sont conservés. Planification/restauration et rétention locale
bornée restent à organiser ; aucune nouvelle planification n’a été activée.

Aucune bascule, publication, migration réelle, modification de proxy/DNS/SSO,
ou activation de service n’est effectuée. La candidate reste une préparation.

Les [preuves structurées](../web/deploy/keycloak/qualification-20260928.json)
conservent reçus, budgets, résultats validate/plan et statut final.
Espace disponible final : **15.40 Gio**
(16.07 %).
L’atelier reste à la révision **`39aef9dd3599278d`**, web/worker/db/egress prêts.
