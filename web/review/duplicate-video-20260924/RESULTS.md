# Doublons de vidéos YouTube — 24 septembre 2026

## Comportement

- Le POST de création normalise le lien YouTube puis cherche un projet du même
  utilisateur avant d'insérer un projet ou un job. Le verrou transactionnel du
  compte sérialise aussi deux créations simultanées.
- Réponse HTTP 409 structurée `duplicate_video`, avec l'identifiant du projet
  appartenant à l'utilisateur. L'interface explique le doublon et propose
  « Ouvrir le projet existant », à son étape courante protégée par les routes.
- La protection s'applique dès la création, y compris pendant le téléchargement
  ou après son échec : réessayer dans le même projet. Elle reste applicable si
  un fichier a remplacé un téléchargement défaillant dans ce projet.
- Aucun projet existant n'est supprimé. En présence d'anciens doublons,
  privilégier un projet avec média, puis le plus ancien. La limite de 30 projets
  ne masque pas le lien vers un projet existant.
- Un autre compte peut créer son propre projet pour la même vidéo. Une
  suppression libère le lien. Les fichiers locaux ne sont pas comparés par
  empreinte ou contenu.

## Vérification

- Ensemble des tests Go de la source de livraison qualifiée :
  `go test -race -count=1 ./...` et `go vet ./...`, réussis avec PostgreSQL isolé.
- Nouveaux tests : quatre créations concurrentes watch/youtu.be/mobile/Shorts
  donnent exactement un projet et un téléchargement ; confidentialité entre
  comptes ; vidéos différentes ; fichiers sans lien ; suppression/recréation ;
  anciens doublons et limite de projets.
- Playwright : 7 tests réussis (`duplicate-video.spec.ts` et `routes.spec.ts`).
  Le message, le bouton, son effacement après changement de saisie et l'ouverture
  sans validation implicite sont vérifiés à 390 px et 1440 px. Les conflits UI
  sont simulés ; les règles serveur sont testées avec PostgreSQL réel isolé.
- Compilation TypeScript/Vite réussie. Aucun téléchargement YouTube ni appel
  fournisseur n'est nécessaire à cette validation.

## Livraison

Construction via `make web-upload-release-build` : backend qualifié et correctifs
explicitement inclus, sans activer les changements de recherche candidats.
Recette : `web/deploy/preview/active-duplicates-20260924.yml`. Seule l'image du
service web change ; aucune migration ni reprise de job n'est nécessaire.

Image importée :
`preview.local/atelier/web@sha256:64b48d8b8739b39e133ef2d1b2f9a50057d4ba4a9d02a847e714ec0714ea51b4`.
Validation et plan acceptés, révision `c30b28bb3e20861b`.
Déploiement appliqué ; service web prêt (1/1), ainsi que base, worker et egress.
Le contrôle de santé confirme le démarrage ; les parcours navigateur ci-dessus
ont été exécutés sur l'environnement local isolé, pas derrière le SSO réel.
