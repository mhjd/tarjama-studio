# Relecture mobile — 23 septembre 2026

Livraison de l'interface sur https://atelier.preview.runagen.com ; révision
`d019d83e8279d525`. Web, worker, DB et egress prêts (1/1), service de review arrêté.
Aucune migration lancée. Les volumes, secrets et règles réseau sont inchangés.

## Résultat visuel

- [iPhone avant](iphone-avant.png) : titre coupé, commandes sur deux lignes,
  avertissement dominant, étape suivante après toute la transcription.
- [iPhone après](iphone-apres.png) : titre complet, étapes centrées, action suivante
  en début de page, suivi séparé, lecteur en bas avec timeline complète.
- [Export Pixel](pixel-export.png) : options avant la transcription, français seul,
  bouton de création visible au-dessus du lecteur.
- [Ordinateur](ordinateur-apres.png) : même hiérarchie, lecteur supérieur sticky,
  flèches clavier ±5 s hors saisie.

Lecteur agrandissable, noms accessibles sur les boutons à icônes. Le suivi est
conservé après un scroll manuel et attend la fin d'une saisie. L'ouverture initiale
reste en haut pour montrer le titre et l'étape suivante.

## Vérifications effectuées

`make web-test` : parité des prompts (2 tests), Go avec race detector, go vet,
TypeScript/Vite, **12 tests Playwright réussis**, sauvegarde/restauration PostgreSQL.
Le premier passage complet avait réutilisé la base temporaire d'un essai précédent
et échoué sur des données déjà modifiées ; les passages sur une base de test
fraîche réussissent. Aucun nettoyage de données utilisateur.

Les tests incluent sauvegarde inchangée, panne réseau, conflit entre onglets,
composition arabe, maintien de l'audio et du focus, suivi après seek, progression,
import réel d'une fixture, export FFmpeg réel et récupération de son MP4. Les
nouveaux contrôles vérifient le titre entier, les étapes, le lecteur, les commandes
suivantes, l'export français et les flèches hors zones de saisie/range.

Captures et enregistrements locaux Chromium : 393×852, 412×915, 1440×932. Images
extraites des clips avant/après et examinées. Ces fixtures servent au design et
aux interactions : **pas de nouvel essai YouTube/Groq/Gemini**, pas de qualification
Safari ou clavier virtuel sur téléphone physique. Les anciens résultats réels et
les vidéos déjà remises ne sont pas réécrits.

## Image et recette

- `make web-ui-release-build`, puis import local, validate et plan réussis.
- Image web : `preview.local/atelier/web@sha256:ddbf42079cda6a5872bdf2d80bac024152b075bfa99a241b7ffb4f1047d318cd`.
- Recette : `web/deploy/preview/active-mobile-20260923.yml`.
- Base runtime qualifiée : `30eb294e…`, backend b69c700. Binaire serveur comparé
  dans les deux images : SHA-256 identique
  `08375017b6d17ebfea63cbecf6c335fbf04aeb03fe161366d265f38c4ed33bc7`.
- Seule l'image du service web change. Worker et egress restent sur leurs images.
  Le mécanisme de déploiement recrée les services ; état prêt contrôlé ensuite.
- Le contrôle HTTP public depuis le compte agent ne peut pas joindre le port
  443 (connexion refusée, également sur loopback). La disponibilité constatée
  repose sur readiness 1/1 et le journal « Tarjama API prête », pas sur un nouveau
  parcours HTTPS/MFA authentifié. Aucune protection réseau modifiée.

Le candidat de recherche web de HEAD reste non activé. L'avertissement intrusif a
été remplacé par une aide repliée honnête. Le retrait de l'option arabe concerne
les nouveaux choix de l'interface ; aucun ancien fichier, job ou texte arabe n'est
effacé, ni l'API historique retirée.

Les principes et sources de design figurent dans [UI_DESIGN.md](../../docs/UI_DESIGN.md).
