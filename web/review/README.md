# Enregistrements des parcours réels

Qualification explicitement demandée par le propriétaire le 23 septembre 2026.
Le MFA est confirmé séparément par le propriétaire. Aucun compte SSO, cookie ou
credential de production n'est utilisé par le navigateur de test.

`make web-review-images` construit deux images distinctes, exclues des cibles
`api` et `media` de production :

- `ui-review` : API et worker réels, schéma `ui_review_20260923`, répertoire
  `/storage/ui-review-20260923`, identité locale de test. Fournisseurs Gemini/Groq
  réels et opérations média via le courtier administré. Aucun traitement FFmpeg
  ou yt-dlp exécuté dans ce service. Durée bornée à trois heures.
- `ui-recorder` : Chromium et Playwright, sans secret, sans volume applicatif,
  sans accès Kubernetes/Docker. Communique uniquement avec le service privé de
  qualification ; son proxy écoute exclusivement sur loopback. Les opérations UI
  réalisent les téléchargements des exports, puis les artefacts sont conservés
  dans le répertoire de qualification par transfert HTTP privé.

Le service de qualification ne remplace pas `web`, n'est pas routé par la
passerelle publique et ne dispose pas de secrets OIDC. Sa connexion de test ne
s'applique qu'au schéma séparé. Ne jamais publier cette image ou ses routes
`/review-artifacts` sur le service `web`.

Les parcours utilisent la vidéo entière `b1MKJ5gHig0`, sans faux fournisseur ni
réponse API simulée. Les enregistrements conservent les attentes réelles. Le script
vérifie création, préparation, transcription/correction, lecture, suivi,
déplacement temporel, édition et sauvegarde après rechargement, traduction,
relecture et exports High français/arabe téléchargés par clic dans l'interface.
Les exports téléchargés sont ensuite ouverts pour inspecter leur rendu vidéo.

Formats CSS émulés, sans barres du navigateur ou système :

| Format | Fenêtre CSS | Densité | Moteur |
| --- | --- | --- | --- |
| MacBook Air 15 M4 | 1440 × 932 | 2 | Chromium Linux |
| Pixel 6 | 412 × 915 | 2,625 | Chromium Linux |
| iPhone 15 | 393 × 852 | 3 | Chromium Linux |

Ce sont des tests responsive, pas des tests matériels ni une qualification Safari.
Les tailles natives de référence sont documentées par
[Apple MacBook Air](https://support.apple.com/en-ie/122210),
[Google Pixel](https://support.google.com/pixelphone/answer/7158570?hl=en) et
[Apple iPhone](https://support.apple.com/en-sg/111831).
Les fichiers vidéo des parcours utilisent les dimensions CSS pour leur lisibilité.

Le manifeste associe noms, tailles et SHA-256. Aucune valeur secrète ni contenu de
projet utilisateur existant n'est inclus. La procédure de remise des fichiers sera
fournie séparément par le propriétaire. Ne pas supprimer les artefacts avant remise.
Une recette finale doit désactiver/retirer le service temporaire, tout en préservant
les artefacts sur le volume ; conserver le schéma de test tant que des opérations
média doivent encore être acquittées. Aucune suppression du schéma `public`.
