# Interface de relecture — principes et qualification du 23 septembre 2026

La référence reste le produit existant : sombre, arabe → français, sauvegarde sur
blur et confirmation explicite avant traduction/export. Aucun framework UI ajouté.
Les icônes Lucide React sont importées individuellement. Les boutons conservent
leurs noms accessibles, états pressés et focus natif.

Sources examinées : le skill Product Design installé (audit/redesign) et le
[skill communautaire Astra frontend design](https://github.com/Enixes/astra-frontend-design)
avec ses références product-ui, redesign et quality-gates. Ce dernier cible Astra,
mais n'est ni officiel OpenAI ni une preuve comparative de performance. Ses conseils
utiles ici : conserver les contrats existants, travailler la hiérarchie avant les
ornements, vérifier dans le navigateur à plusieurs dimensions. Pas d'installation
globale, de template marketing ni de remplacement du produit par un kit générique.
[Lucide React](https://lucide.dev/guide/react) fournit les pictogrammes cohérents.

## Règles locales

- Identité sombre et sauge conservée ; texte principal clair, contraste et focus
  visibles. Espacements réguliers, cartes de segments simples, pas de chrome inutile.
- Quatre étapes en colonnes égales, chiffres et libellés centrés. Validation uniquement après les segments, avec « Valider et traduire » ou
  « Valider et exporter », qui attend toujours le flush et sa réussite. En haut,
  « Aller à la validation » est un lien discret : déplacement et focus seulement,
  sans confirmer l’étape ni lancer de traitement.
- Titre modifiable sur plusieurs lignes, hauteur ajustée au texte et au viewport.
  Lien YouTube juste dessous, copiable au clic avec retour de succès/échec, et
  ouverture de la source dans un autre onglet. Les imports sans URL n’en inventent pas.
- Sur téléphone : lecteur fixé en bas avec marge safe-area, timeline pleine largeur,
  commandes de 44–48 px et aperçu agrandissable. Marge de défilement pour que le
  segment recherché reste au-dessus du lecteur. Sur ordinateur : lecteur sticky, commandes centrées de 64 px et lecture/pause
  de 76 px. Le français est sous l’arabe sur toutes les tailles d’écran.
- Suivi dans la barre de l'éditeur, séparé du lecteur ; actif par défaut, conservé
  lors d'un scroll manuel, suspendu pendant la saisie. L'ouverture ne défile plus
  automatiquement jusqu'au premier segment et ne masque plus le contexte du projet.
- Espace : lecture/pause, sans défilement de page ni répétition lors d’un appui
  prolongé. Sur un bouton, conserver son activation native ; pendant la saisie,
  conserver l’insertion d’espaces.
- Flèches gauche/droite : ±5 s, bornées à la vidéo. Les champs, compositions IME,
  sélecteurs, sliders et combinaisons de touches conservent leur comportement natif.
- Commandes d’export placées avant la transcription, avec espace de défilement
  pour que le lecteur ne recouvre pas le bouton. Export proposé uniquement en français. Les anciens fichiers/jobs arabes restent
  accessibles, le moteur et l'API historiques ne sont pas supprimés.
- Grand avertissement retiré du parcours. Une aide repliée conserve l'information
  exacte : la recherche automatique n'est pas activée sur le runtime qualifié.

## Audit visuel et reproductibilité

Les captures initiales montrent le titre tronqué, les étapes non centrées et le
lecteur mobile qui fait passer le bouton +5 s à la ligne ; en relecture, le lecteur
supérieur recouvre le début du segment. Ces problèmes sont visibles aussi sur les
captures transmises par le propriétaire. Les vidéos historiques reçues par le
propriétaire ne sont plus disponibles localement ; des enregistrements **locaux
sur fixtures** avant/après servent à la comparaison, sans se faire passer pour un
nouveau test YouTube/Gemini.

`make web-deps` installe les dépendances et le petit binaire ffmpeg Playwright.
`make web-test` exécute les tests Go, TypeScript/build, Playwright, et la restauration
PostgreSQL sur données synthétiques. `tests/design-capture.spec.ts` enregistre les
vues 393×852 (iPhone 15), 412×915 (Pixel 6), 1440×932 (MacBook 15 pouces) : correction,
traduction, relecture, export et lecteur agrandi. Captures/vidéos dans
`web/frontend/test-results/design-*`. Les assertions contrôlent le titre entier,
l'absence de débordement horizontal, le centrage, la position basse et le bouton
suivant. `editor.spec.ts` couvre saisie/IME/conflits, audio, suivi, raccourcis et
véritable export FFmpeg synthétique téléchargé via l'API privée.

Les captures sont examinées visuellement, y compris des images extraites des
vidéos. Ce sont des viewports Chromium ; elles ne qualifient pas Safari iOS, le
clavier matériel du téléphone, la MFA ni la qualité linguistique des fournisseurs.
Le script de parcours réel `web/review/record.mjs` est mis à jour pour les nouveaux
libellés et le seul export français High. Les anciens rapports restent inchangés.

## Livraison sans activer le candidat recherche

`make web-ui-release-build` construit le frontend et le superpose à l'image
qualifiée importée `30eb294e…`, runtime Docker `a5abf964…` (backend b69c700).
Le script vérifie l'identité immuable de la base locale avant de lui donner un tag
de build ; aucun backend de HEAD n'est compilé dans cette livraison. Les anciens
artefacts et paramètres réseau/secrets sont conservés. L'image finale et la recette
active sont consignées dans le rapport de livraison associé.

Complément : la suite vérifie aussi la correction après export, l’invalidation du
rendu proposé, la création d’un nouveau MP4, la conservation du précédent fichier
et de la traduction lorsque l’arabe change. Voir le rapport de relecture desktop
pour la dernière recette active ; le précédent rapport mobile reste historique.
