# Lecteur stable avec une extension — 23 septembre 2026

Décision finale : aucun contrôle ni raccourci de vitesse ajouté. Lecture par
défaut à 1× ; une extension du navigateur reste capable de changer sa vitesse.

## Vérification visuelle et régression

1. **État initial : décalage reproduit.** Un hôte de contrôles ajouté avant le
   `<video>` devenait une cellule supplémentaire de la grille. Les trois tests
   géométriques échouaient, sur desktop et mobile. [Capture desktop avant](before/player-1440-injected.png).
2. **État corrigé : commandes stables.** L'aperçu possède désormais un bloc de
   dimensions explicites, positionné et borné. Les éléments injectés à côté de
   la vidéo restent à l'intérieur de ce bloc, sans déplacer lecture/pause,
   agrandissement, temps ou timeline. [Desktop après](after/player-1440-injected.png),
   [mobile agrandi](after/player-393-expanded.png). Le contenu éventuel de
   l'extension peut être rogné dans la petite vignette ; il n'est pas effacé du DOM.
3. **Parcours enregistrés : réussis sur les trois formats.** Création par import,
   préparation, lecture/pause, seek, suivi, agrandissement, modification arabe,
   validation, relecture française, export High téléchargé depuis l'interface,
   puis modification après export et invalidation du rendu précédent.
   Images extraites des nouveaux MP4 à 10 s : [MacBook](video-macbook-air15.png),
   [Pixel 6](video-pixel6.png), [iPhone 15](video-iphone15.png). Images inspectées.

20 tests Playwright réussis : 17 tests interface/géométrie, puis 3 parcours
filmés. TypeScript/Vite réussis. Les tests de géométrie vérifient la position
inchangée des boutons et la hauteur du lecteur après injection synthétique,
puis l'agrandissement sans débordement. L'extension exacte du propriétaire
n'est pas installée ; pas de promesse de compatibilité avec toutes ses versions.
Les raccourcis Espace et flèches, la saisie/IME, la sauvegarde, les conflits et
l'export réel FFmpeg sont également exercés. Aucune conformité WCAG globale
n'est déduite des seules images.

## Limites des vidéos remises

Ce sont des tests locaux Chromium : source synthétique verte de 4 s avec son
sinusoïdal ; transcription/traduction simulées. Le stockage, le parcours API,
FFmpeg et le téléchargement sont réels. Ce n'est pas une nouvelle exécution
YouTube/Groq/Gemini, ni un test MFA ou Safari sur téléphone physique.
Les tests antérieurs sur France 24 restent documentés séparément.

| Format émulé | Viewport CSS | Durée MP4 UI |
| --- | --- | --- |
| MacBook Air 15 pouces | 1440 × 932 | 22,24 s |
| Pixel 6 | 412 × 915 | 23,76 s |
| iPhone 15 | 393 × 852 | 23,72 s |

Le MP4 iPhone est complété d'un pixel noir pour obtenir une largeur paire H.264,
sans modifier le viewport. Les trois exports High test font 4,018 s,
320 × 240 (résolution de la source), H.264/AAC. Un extrait d'export a été inspecté :
le sous-titre français est bien incrusté. Les nouvelles vidéos sont conservées
sous `web/.cache/player-ui-recordings/` ; seuls les rapports/captures sont dans Git.
Les scripts `tests/player-layout.spec.ts` et `tests/journey-record.spec.ts` font
partie de `make web-test`, pour réutilisation.

## Livraison

Frontend seul superposé au runtime qualifié avec le correctif d'import ; les
cinq couches de l'image de base sont conservées. Aucun backend candidat ni
fournisseur modifié. Le script de build épingle maintenant le Docker image ID
correct (index OCI), distinct du digest de configuration affiché au build.

Image : `preview.local/atelier/web@sha256:c649712edf28228cb900dcb494c02af11767817fd01fbc53c57ec45f3d8e4f1f`.
Recette `web/deploy/preview/active-player-20260923.yml`, révision `e5670e07fcb2f8c0`.
Validate/plan/déploiement réussis, quatre services prêts ; seule l'image web change.
Aucune migration ni modification de protection ou des traitements média.
