# Déploiement des exports — 29 septembre 2026

## Livraison terminée après libération d'espace

Sources testées `830d828`, nouvelle révision **`2a740f0348a2bbab`**, application
publique https://tarjama.runagen.com. Recette courante :
`web/deploy/preview/active-subtitle-exports-20260929.yml`.

- Web : `preview.local/atelier/web@sha256:0422883a80ce9a6d20d9aafa028a664677e26af5ab8aaa57d520d54393d1be91`.
- Worker : `preview.local/atelier/web@sha256:82365d566137914050b1a0dae634cb92cde71bb75a1db1c186418354e09aefb9`.
- Copies Docker : `tarjama-web:exports-830d828` et `tarjama-worker:exports-830d828` ;
  IDs immuables, tailles et reçus dans `imports.json` des preuves.

Builds/imports sérialisés. Réimport exact des sept références locales de la recette
précédente, incluant les copies de retour arrière. Images externes PostgreSQL
inchangées ; les services et la sauvegarde ont démarré avec succès. La comparaison
sémantique de recette ne change que les images web/worker et les empreintes/chemins
CSS/JS attendus du job de qualification. Pas de migration ni de changement des
protections, du thème, du realm, du routage ou des volumes.

Sauvegarde des deux bases `pv-job-backup-2613d4e4` Succeeded avant déploiement.
`validate`/`plan` réussis, puis deploy appliqué. Pendant le redémarrage, une première
découverte OIDC a échoué avant la disponibilité de Keycloak ; l'API a ensuite
redémarré correctement. Six services prêts, `partial=false`, contrôle
`pv-job-preview-check-60ad6959` Succeeded : readiness, accueil, refus anonyme des
projets et SHA256 des deux assets réellement servis conformes. Le worker confirme
le chargement des trois outils du corpus local et le modèle GPT-6 Luna.

Qualification avant livraison : 13 tests Go avec détecteur de courses et 22 tests
Playwright réussis pour la version finale, plus les tests des correctifs antérieurs.
Contrôle après livraison HTTP interne uniquement ; aucune nouvelle connexion
navigateur publique ni appel IA. Réserve finale : **25,72 Gio libres** pour
14,37 Gio minimum. Aucun nettoyage de données effectué par l'agent applicatif.

Les nouveaux rendus utilisent le réglage Gros ; les MP4 existants restent
inchangés. Les téléchargements SRT sont désormais regroupés. La limite de police
Arial/Noto reste documentée dans `SUBTITLE_EXPORT_PARITY_20260929.md`.

Retour arrière applicatif, si nécessaire après vérification des images :

```sh
vps-preview rollback atelier --revision 29bd0ed9ca04cd7b
vps-preview status atelier
```

Il conserve les bases et les paramètres d'identité persistés. Ne pas relancer
la transition Keycloak ni restaurer une ancienne configuration de proxy.

## Historique du blocage initial

Déploiement initialement arrêté avant construction faute de marge disque.
Les constatations suivantes décrivent cet état antérieur, résolu par
l'intervention administrateur puis les opérations ci-dessus.

## État constaté

Révision active `29bd0ed9ca04cd7b`, six services prêts, `partial=false`.
Recette de référence : `web/deploy/preview/active-keycloak-theme-image-20260928.yml`.
Passations PUBLIC_HANDOFF et THEME_HANDOFF lues ; conserver l'ouverture publique,
le thème actif, Keycloak et son origine admin9443, les bases et l'egress réparé.

Disque : 102 888 095 744 octets, 13 243 248 640 disponibles (12,33 Gio).
La réserve de 15 % représente 15 433 214 361 octets (14,37 Gio).
Il manque déjà 2,04 Gio avant toute construction/import. Les caches applicatifs
identifiés, `web/.cache/build` (421 Mio) et `web/.cache/go` (45 Mio), ne suffisent
pas. Les preuves sous `.cache`, corpus, données, images actives et copies de retour
ne sont pas considérés comme supprimables. Aucun nettoyage global.

La passation administrateur du 28 septembre impose la réserve APRÈS le pic de
travail et au moins quatre fois la taille de chaque image pour l'import, en série.
Le garde-fou de 4 Gio de l'importeur est explicitement insuffisant. Les images
actuelles API/worker font environ 156/192 Mo ; leurs remplaçantes restent à
construire et mesurer. Viser environ 18 Gio libres pour la reprise, puis recalculer
la borne avec les tailles réelles et les caches nécessaires. Ce chiffre est une
marge préparatoire, pas une mesure du pic du futur build.

Preuves : `web/review/deployment-subtitle-exports-20260929/`.

## Reprise après restitution de capacité

1. Recontrôler statut, disque et concurrence de construction ; ne pas modifier
   le seuil administrateur. Vérifier que la recette de référence correspond encore
   au déploiement effectif.
2. Construire API puis worker à partir du commit testé, avec le corpus local
   validé (`make web-api-image`, `make web-worker-image`). Conserver les images
   actives et leurs copies Docker pour retour arrière. Nul besoin de changer
   l'image Keycloak, egress ni les profils média administrés : l'ASS vient du worker.
3. Importer chaque image en série par `vps-preview image-import`. Reporter les
   digests effectivement retournés dans une nouvelle recette copiée de la référence
   actuelle, uniquement pour web/worker. Mettre les empreintes des nouveaux assets
   dans le job `preview-check`. Conserver les réglages de tous les autres composants.
4. Contrôler la disponibilité réelle des images, `validate`, `plan` et la différence
   sémantique des recettes. Aucune migration de schéma attendue pour ces correctifs.
5. Sauvegarder les deux bases avec le job existant, attendre son succès. Déployer
   la candidate autorisée, vérifier six services prêts puis exécuter le contrôle
   interne des assets, readiness et refus anonyme. Aucun appel IA nécessaire.
6. Conserver preuves, digests, nouvelle révision et commande de retour vers
   `29bd0ed9ca04cd7b` ; ce retour ne restaure pas les bases. Ne jamais réappliquer
   une ancienne recette Authelia/Keycloak sans les adaptations publiques actuelles.

Le garde réseau des agents reste applicable : le contrôle interne ne doit pas
être présenté comme une nouvelle connexion navigateur publique authentifiée.
Les MP4 existants ne changent pas de taille ; seuls les nouveaux rendus utilisent
Gros. Les nouveaux téléchargements SRT utiliseront le regroupement après livraison.
