# Déploiement Luna et références locales — 25 septembre 2026

Activation explicitement demandée par le propriétaire après le choix de Luna.
Cible privée : https://atelier.preview.runagen.com.
Source des images : `6c6a9d6e67859f77aba85ae18e43ee8967a797e0`, branche `web-vps`.
Révision active : `6b720a240cec4a7a` ; précédente : `8c6f045bff5432e9`.

## Comportement livré

- Correction arabe et traduction : `openai/gpt-6-luna`, raisonnement `medium`.
- Trois outils locaux disponibles dans le worker : `quran_fr`, `sahih_ar`,
  `hadith_ar`. Corpus `20260925-v2`, 23 745 entrées, empreinte des entrées
  `b984603912ed869f12735d6da99c9cb3c139aee29df703a8d98d263cefde5f96`.
- Corpus embarqué dans l'image worker en lecture seule, validé au build et au
  démarrage. Contexte de build limité aux entrées, manifeste, provenance et
  notices. Aucune archive brute, donnée utilisateur ou clé embarquée.
- Références, URLs et réponses d'outils conservées dans l'audit du traitement.
  Le panneau UI et l'association précise aux timecodes **restent à réaliser**.
- Groq, outils Parallel, frontières média isolées, OIDC et données conservés.
  Le découpage applicatif et les checkpoints existants ne sont pas réécrits.

## Opérations et preuves

La [recette active](../web/deploy/preview/active-luna-references-20260925.yml)
épingle les trois images par les digests retournés par l'importeur local : API,
worker et qualification. Pas de publication GHCR ni de GitHub Actions.
Les [preuves](../web/deploy/preview/evidence/luna-references-20260925/) incluent
builds, imports, validation, plan, déploiement, journaux et état final.

Sauvegarde avant activation : `pv-job-backup-66a6a867`, réussie, archive
`/storage/backups/pre-response-recovery-dab84b9-20260925T210505Z.dump`, empreinte
`f99de1cdffe9b19f414c5115ac665d70d934782198c401b9ca6230a8ef1572eb`.
Le préfixe historique vient du script encore actif au moment de la sauvegarde.
Archive contrôlée avec `pg_restore --list` ; aucun média modifié.
Aucune modification SQL depuis la source déployée précédente : aucune migration
exécutée. Aucun nouveau volume, secret ou droit réseau ; protections conservées.

Vérifications réussies :

- Tests Go `go test ./...`, compilation des tests explicites `preview_live`,
  vérification des prompts et builds des trois images.
- `validate` et `plan`, puis quatre services prêts après déploiement.
- Worker : chargement des trois outils et modèle Luna confirmés dans les logs.
- `pv-job-preview-check-14c3d635` : readiness, page HTML, refus des API anonymes,
  démarrage OIDC avec PKCE et TLS/passerelle, réussis.
- `pv-job-reference-check-78ee2673` : le vrai Luna medium a appelé les trois
  outils, reçu Coran 112:1, Bukhari 1 et Riyad 1 avec leurs URLs, puis produit le
  JSON final attendu. Deux requêtes, trois appels locaux, 8,64 secondes ; coût
  déclaré par OpenRouter : 0,00041273 USD. Aucun accès aux projets ou à la base.
  Diagnostic borné à trois minutes, cinq requêtes maximum, sans relance externe.
- Les deux jobs de qualification et la sauvegarde sont terminés, aucun job
  payant de qualification laissé en arrière-plan.

Ces contrôles prouvent l'activation et la chaîne modèle → outils → résultats.
Ils ne prouvent ni que chaque citation sera spontanément recherchée, ni qu'une
traduction complète sera exempte de contresens. Le parcours vidéo complet et
la MFA n'ont pas été rejoués pour cette livraison sans changement d'interface.
Les limites de couverture et de licence restent décrites dans
[le contrat du corpus](LOCAL_REFERENCE_TOOLS.md).

## Reproduction et retour arrière

`make web-api-image` et `make web-worker-image` construisent les images.
Pour le diagnostic : `make web-worker-image WORKER_IMAGE_TARGET=reference-check
WORKER_IMAGE_TAG=tarjama-reference-check:review`.
Importer chacune avec `vps-preview image-import atelier --name web --image TAG`,
puis reporter le champ `image` dans une nouvelle recette versionnée.
Utiliser les cibles `make web-preview-validate`, `web-preview-plan` et
`web-preview-deploy` avec `PREVIEW_FILE` pointant vers cette recette.
Les jobs sont explicites via `make web-preview-run PREVIEW_JOB=preview-check`
ou `PREVIEW_JOB=reference-check` ; ce dernier consomme de l'API.

Retour arrière disponible vers `8c6f045bff5432e9` avec `vps-preview rollback` :
pas de changement de schéma à inverser. Le rollback conserve les données et
ne retire pas les résultats déjà générés par Luna.
