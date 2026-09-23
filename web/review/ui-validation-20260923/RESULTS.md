# Validation en bas, raccourci en haut — 23 septembre 2026

Le lien « Aller à la validation » remplace le bouton principal du haut. Il place
le focus sur la zone de validation et y descend, sans appeler `/advance`.
Le seul bouton principal est après les segments : « Valider et traduire »,
« Valider et relire la traduction » si elle est déjà courante, ou « Valider et exporter ».
Sur ordinateur, Espace alterne lecture/pause hors champs de saisie ; un appui
prolongé ne répète pas la bascule et ne fait pas défiler la page. Les boutons
conservent leur activation native au clavier, sans double bascule.
Le flush, les confirmations de remplacement et l’attente pendant la composition
arabe sont conservés. Le parcours de capture réelle utilise les nouveaux libellés.

[Haut mobile](mobile-top.png) · [Après le raccourci mobile](mobile-validation.png)
· [Après le raccourci desktop](desktop-validation.png).

`make web-test` réussi : 13 tests Playwright, Go race/vet, TypeScript/Vite,
parité des prompts, sauvegarde/restauration PostgreSQL. Aux trois viewports
393×852, 412×915 et 1440×932, le test du raccourci vérifie : aucune demande
`/advance`, focus déplacé, un seul bouton principal et bouton non recouvert par
le lecteur. Le test clavier vérifie également lecture/pause avec Espace, appui prolongé,
absence de défilement, saisie, slider et activation native du bouton. Captures examinées. Tests sur fixtures Chromium, pas de nouveau test
MFA, Safari physique ou fournisseurs. Correction et nouvel export restent testés.

Image locale : `preview.local/atelier/web@sha256:e61811e1ad47e9b22164690c96ab3b362e37a48d135912ef5078af74101c202b`.
Recette : `web/deploy/preview/active-validation-20260923.yml`.
Révision : `cf09d51b011dddd6`. Build frontend sur le runtime qualifié précédent,
import, validate et plan réussis. Seule l’image web change ; aucune migration,
activation du candidat recherche ou modification des protections.
