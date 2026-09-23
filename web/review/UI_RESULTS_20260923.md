# Parcours UI réels — Flash-Lite, 23 septembre 2026

**Trois parcours complets réussis, trois enregistrements et six exports High.**
Source entière : https://www.youtube.com/watch?v=b1MKJ5gHig0 (114,96 secondes après
préparation). Groq et Gemini 3.5 Flash-Lite réels, téléchargement WARP et opérations
média administrées ; aucun fournisseur simulé dans ces parcours.

Backend testé : `b69c700`. La recette `ui-lite2-20260923.yml` épingle ses images et
monte les scripts Playwright corrigés du dépôt. Les résultats structurés et
empreintes sont dans [ui2-results.json](../deploy/preview/evidence/lite-20260923/ui2-results.json).

## Résultats

| Format émulé | Fenêtre CSS | Parcours | Durée réelle |
| --- | --- | --- | --- |
| macbook-air15-m4 | 1440 × 932 | Réussi | 356 s |
| pixel6 | 412 × 915 | Réussi | 380 s |
| iphone15 | 393 × 852 | Réussi | 348 s |

Chaque parcours crée un projet par lien YouTube, attend les traitements réels,
vérifie lecture/suivi activé par défaut et conservé après scroll manuel, seek,
activation/désactivation explicite, modification arabe puis persistance après
rechargement, traduction, modification française et flush à l'étape suivante,
persistance française après rechargement, exports High français et arabe par les
boutons de l'interface, puis lecture des fichiers téléchargés au début et au milieu.
Les étapes filmées vérifient l'absence de débordement horizontal et l'absence
d'erreurs JavaScript non interceptées. Les fichiers finaux passent aussi le probe
média du backend (audio, vidéo, durée/dimensions admissibles) avant publication.

## Fichiers conservés

Sur le PVC du VPS, **pas dans le filesystem local de Codex** :
`/storage/ui-review-20260923_lite2/artifacts/`.
Les fichiers sont téléchargés par Playwright depuis l'interface, puis conservés
avec taille et SHA-256. Aucune remise externe n'a été effectuée : le propriétaire
fournira la procédure. Le manifeste complet et les captures PNG sont aussi conservés.

| Fichier | Octets |
| --- | ---: |
| `tarjama-b1MKJ5gHig0-macbook-air15-m4-fr-high.mp4` | 25067300 |
| `tarjama-b1MKJ5gHig0-macbook-air15-m4-ar-high.mp4` | 24451558 |
| `parcours-macbook-air15-m4.webm` | 19349173 |
| `tarjama-b1MKJ5gHig0-pixel6-fr-high.mp4` | 25075035 |
| `tarjama-b1MKJ5gHig0-pixel6-ar-high.mp4` | 24525917 |
| `parcours-pixel6.webm` | 10376839 |
| `tarjama-b1MKJ5gHig0-iphone15-fr-high.mp4` | 25040292 |
| `tarjama-b1MKJ5gHig0-iphone15-ar-high.mp4` | 24520425 |
| `parcours-iphone15.webm` | 8774677 |

## Portée et limites

- Émulation responsive sous Chromium Linux ; pas de qualification d'appareils
  physiques, de Safari iOS ni du clavier natif. DPR : Mac 2, Pixel 2,625, iPhone 3.
- MFA non retesté, conformément à la confirmation du propriétaire. Identité locale
  uniquement dans le service privé de qualification et son schéma séparé.
- Enregistrements Playwright de l'écran ; ils ne constituent pas une capture audio
  de la session. Les exports MP4 conservent une piste audio vérifiée par le backend.
- Les lectures et captures début/milieu sont enregistrées ; aucune relecture
  linguistique exhaustive ni inspection visuelle image par image des six vidéos
  n'est revendiquée. La [qualité de traduction](translation-lite/RESULTS-20260923.md)
  reste celle d'un brouillon corrigible, avec des erreurs documentées.
- Le premier essai Lite a atteint l'export mais le script cherchait le label
  « Qualité » avec un nom exact trop strict. Sélecteurs corrigés ; une nouvelle
  série complète a réussi. L'essai initial reste dans
  `/storage/ui-review-20260923_lite/artifacts/`, sans écrasement des preuves.

Tests locaux : Go avec race detector, vet, build TypeScript/Vite, 8 tests Playwright,
restauration PostgreSQL synthétique et 5 tests de préparation des recettes réussis.
Le découpage de 20 minutes et la reprise d'un ancien chunk de 120 segments sont
couverts ; le changement ne redécoupe pas les résultats déjà validés.

## État livré

Application disponible à https://atelier.preview.runagen.com, avec Flash-Lite.
Recette active : `web/deploy/preview/active-lite-20260923.yml`, révision
`b6956a98dea4bb2a`. Web, worker, sortie WARP et PostgreSQL prêts ; service privé
`review` arrêté et aucune tâche active après qualification. Les preuves restent
sur le volume. `deploy.preview.yml` reste la recette désactivée, validée et planifiée
mais non appliquée. Les images sont locales, importées par digest ; aucun workflow
GitHub Actions ni publication GHCR n'a été utilisé.

Image applicative :
`preview.local/atelier/web@sha256:30eb294e540188a985f94f6de2a657681f20a7d5501b26dd0841eb485c19f2a9`.
L'image/profils du moteur média administré n'ont pas changé. Les preuves de
validate/plan, tests, appels fournisseurs et état final sont conservées sous
`web/deploy/preview/evidence/lite-20260923/`.
