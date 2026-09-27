# Lecteur et sous-titres compacts sur téléphone — 27 septembre 2026

> Dernier correctif déployé : `fc2b468`, révision `f60c1123e19079a2`.
> Première version compacte déployée le 2026-09-27 13:34 UTC, révision `035f4cac81045995`.
> Sauvegarde, disponibilité des quatre services et qualification HTTP/OIDC/TLS réussies.
> Les mentions de préparation/non-déploiement plus bas sont historiques.

## Décision et comportement

Le propriétaire signale deux problèmes : la vitesse et la navigation haut/bas
occupent deux lignes permanentes près du transport ; les champs de texte et leurs
marges laissent trop peu de place aux sous-titres.

À 640 px et moins :

- Lecture/pause et ±5 secondes restent les commandes principales, centrées.
- `Options · 1×` est placé à côté de la barre de lecture. La vitesse actuelle
  reste visible, mais les changements demandent une ouverture explicite.
- L'ouverture affiche vitesse, Haut et Bas sur une seule ligne dans un panneau
  au-dessus du lecteur. Elle ne change ni sa hauteur ni la position du transport.
- Le panneau se ferme après Haut/Bas, avec Échap (focus rendu au bouton), ou au
  toucher extérieur. Les cibles tactiles gardent 44 px : on réduit l'encombrement
  permanent plutôt que la précision nécessaire pour toucher un bouton.
- Marges, intervalles bilingues et espaces de titre sont réduits. Le français
  reste à 16 px, l'arabe à 22 px avec une hauteur de ligne adaptée.
- La hauteur des champs suit le texte, y compris pendant l'édition, après
  chargement des fontes et après changement de largeur/orientation. Pas de
  troncature, de limite de lignes ni de petit ascenseur interne sur téléphone.
  Un très long sous-titre nécessite naturellement de faire défiler la page.

Sur ordinateur, la disposition des commandes secondaires et les raccourcis
restent disponibles. Les champs gardent leur hauteur et leur redimensionnement
habituels. Aucune modification backend, de modèle, de sauvegarde ou de rétention.

## Vérification

Tests Playwright sous Chromium avec vues 320 px, iPhone 15 (393 × 852), Pixel 6
(412 × 915) et ordinateur (1440 px). Il s'agit d'émulation de dimensions, pas
d'essais sur du matériel iOS/Android ni de qualification Safari.

- Centrage des commandes conservé en mode compact/agrandi et après changement
  de vitesse ; options cachées initialement et alignées à l'ouverture.
- Hauteur du lecteur mobile compact inférieure à 165 px dans les fixtures.
- Au moins deux blocs courts complets arabe/français visibles au-dessus du lecteur
  après défilement jusqu'aux sous-titres ; captures inspectées visuellement.
- Longs textes arabes/français non coupés, champ qui grandit pendant la frappe,
  nouvelle mesure après changement de largeur.
- Navigation haut/bas, pause et préférence de suivi conservées.
- Contrôles d'extension vidéo contenus dans leur vignette.

Captures locales : `web/.cache/mobile-compact-20260927/`.
Journaux : `web/.cache/mobile-density-tests.log` et
`web/.cache/mobile-compact-regression.log`.


Résultat : build TypeScript/Vite réussi, 53 cas UI distincts réussis : 15 tests
ciblés puis 42 tests de régression (les quatre tests de vitesse ont été rejoués
après raccourcissement du libellé de la vitesse normale). Parcours UI complets
avec source et IA de test sur ordinateur, iPhone et Pixel ; export FFmpeg réel.
Aucun appel fournisseur réel facturé. Les tests de saisie, IME, conflit entre
onglets, sauvegarde sur blur et navigation passent avec les champs adaptatifs.

Livraison non déployée. L'image API doit être reconstruite avant activation ;
conserver le worker et le digest egress `19994f1…` de la recette active de rétention.
Les fichiers de déploiement existants restent ceux de la version déjà en ligne.


## Vidéos remises à disposition

Le test `mobile-density.spec.ts` enregistre désormais automatiquement son parcours
(lecture des blocs courts, panneau Options, texte long, frappe et redimensionnement),
avec pauses de lecture. Les deux cas sont repassés avec succès après cet ajout.
Les trois enregistrements des parcours complets ont été conservés avant la nouvelle
exécution. Cinq MP4 H.264 ont été préparés et contrôlés par ffprobe, sans piste audio.

Livraison `tarjama-ui-mobile-compact` publiée dans l'espace privé vps-share,
à récupérer avec `vps pull` sur le Mac. Le README distingue les fixtures locales
et l'émulation de viewport d'une qualification réelle en production.
Originaux durables côté projet : `web/.cache/mobile-compact-20260927/videos/`.


## Déploiement autorisé — 2026-09-27 13:34 UTC

Interface `1907710`, image construite depuis `e537f93`.
Révision active : `035f4cac81045995`.
URL : https://atelier.preview.runagen.com.
Recette : `web/deploy/preview/active-mobile-compact-20260927.yml`.

Seule l'image `services.web.image` change dans la recette :
`preview.local/atelier/web@sha256:1cc2eabd8cc24839fdc2200e45a762019e0e3490afa774f6755561535ed1023e`.
Worker, egress rétabli par l'administrateur, base, tâches et configuration conservés.
Toutes les références locales nécessaires réimportées au digest exact avant
activation. Aucune migration SQL ni appel LLM réel.

Sauvegarde `pv-job-backup-24bd7e45` : nouvelle exécution `Succeeded` avant déploiement.
Quatre services prêts, `partial: false`.
Qualification `pv-job-preview-check-7d68235f` : nouvelle exécution `Succeeded` après déploiement,
contrôles `HTTPAndOIDCStart`, `SSOHeaders`, `GatewayTLS`.
Les journaux bornés ont listé des exécutions plus anciennes : la preuve retenue
est le statut terminal du nouveau pod, pas leurs journaux. Les parcours UI
complets sont les tests locaux documentés plus haut ; aucun parcours MFA/vidéo
complet relancé sur des données utilisateur en production.

Preuves : `web/deploy/preview/evidence/deploy-mobile-compact-20260927/`.

## Correctif Haut/Bas — préparé, pas encore déployé

Signalement sur Pixel avec Firefox : après « Bas », la ligne contenant le curseur
et Options disparaît, puis revient au défilement manuel. La cause exacte sur cet
appareil n'est pas démontrée. Les tests précédents utilisaient un viewport fixe
et ne vérifiaient pas cette ligne immédiatement après le saut.

Deux corrections :

- Rendre le focus à Options sans faire défiler, fermer le panneau, puis seulement
  effectuer le saut après la mise à jour DOM. La destination est bornée à la fin
  du document. La pause et la préférence de suivi sont conservées.
- Sur téléphone, contrôler la position réelle du lecteur par rapport à
  `visualViewport` après les événements de défilement et de redimensionnement.
  Compenser uniquement le débordement inférieur, y compris lorsque les barres
  du navigateur changent la surface visible. Retirer la compensation lorsque
  cette surface revient à la normale. La mesure tient compte de la compensation
  précédente et du placement natif pour éviter un double décalage. Aucun
  déplacement correctif pendant un zoom tactile ; comportement desktop conservé.

Le test `player-page-jump.spec.ts` vérifie Haut/Bas répétés, fermeture du panneau,
focus, pause, visibilité et ciblage du curseur et d'Options. Il inspecte les
rectangles et `elementFromPoint` sans clic automatique susceptible de remettre le
contrôle à l'écran. Un scénario distinct simule explicitement une réduction de
80 px du viewport visuel : échec avant correctif, les deux contrôles étant hors
de la zone visible (`web/.cache/player-jump-before.log`). Ce scénario est une
simulation contrôlée, pas une reproduction du navigateur Android ni la preuve
que sa cause est identique au signalement.

La configuration Playwright accepte `PLAYWRIGHT_BROWSER=firefox` pour exécuter
ces mêmes tests avec Gecko. Il s'agit du Firefox desktop fourni par Playwright,
avec dimensions/tactile de téléphone, sans les barres natives de Firefox Android.
La qualification sur le Pixel réel reste donc à confirmer après mise en ligne.

Résultat local : build TypeScript/Vite réussi et 19 tests Chromium réussis
(navigation, vitesse, disposition, densité et quatre nouveaux cas Haut/Bas).
Journal : `web/.cache/player-jump-after.log`. L'essai Firefox est interrompu
avant tout résultat applicatif : son lancement headless ne se termine pas dans
le conteneur de test. Un second lancement isolé, borné à 20 secondes, expire
également ; journaux de démarrage dans
`web/.cache/firefox-launch-diagnostic.log` (avertissements namespaces/graphisme,
cause du blocage non établie). Aucun profil de sécurité modifié. Ne pas compter
ces quatre cas Firefox comme réussis, ni comme échecs de l'application.

Références techniques :
[VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
et [signalement Mozilla sur les éléments fixes pendant une transition de barre](https://bugzilla.mozilla.org/show_bug.cgi?id=1796228).
Elles justifient de tester la surface visible ; elles ne prouvent pas la cause
du problème de Tarjama.


## Déploiement du correctif Haut/Bas — 2026-09-27 13:52 UTC

Autorisé par le propriétaire après les tests. Code `fc2b468` ; révision
`f60c1123e19079a2`. La section « préparé » ci-dessus décrit l'état historique.
Recette : `web/deploy/preview/active-player-jump-20260927.yml`.
Seule `services.web.image` change, avec la référence importée :
`preview.local/atelier/web@sha256:1acdd773ccb1f040c9c944979301cb71a074e07a8e19d7e411910393dee826cd`.
Les images conservées ont été réimportées à leurs digests exacts, y compris
le proxy administrateur `19994f1…` et l'image précédente pour un retour arrière.

- `validate` et `plan` réussis.
- Sauvegarde `pv-job-backup-c2fc20fe` réussie avant activation.
- Quatre services prêts, `partial: false`.
- Qualification `pv-job-preview-check-0c7c7360` réussie :
  HTTPAndOIDCStart, SSOHeaders et GatewayTLS.
- Aucune migration SQL, aucun appel fournisseur facturé.

Preuves : `web/deploy/preview/evidence/deploy-player-jump-20260927/`.
Les limites du test Firefox documentées plus haut restent applicables :
ce déploiement ne constitue pas une validation sur le Pixel physique.
