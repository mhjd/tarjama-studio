# Audit de sécurité desktop

Audit ciblé de Tarjama Studio 0.1.28, réalisé le 13 juillet 2026. Le modèle de menace couvre un renderer compromis, des identifiants IPC forgés, des médias ou imports malformés et des outils externes remplacés. Il ne prétend pas rendre sûre une machine déjà compromise.

## Protections vérifiées

- Renderer Electron isolé et sandboxé, sans Node.js, sans ouverture de fenêtre, navigation externe ni permission système.
- CSP restrictive; l'interface et les médias sont servis par un protocole local limité à l'application et au projet validé. Le développement distant est refusé et limité aux adresses loopback.
- Chaque appel IPC vérifie qu'il provient de la frame principale de la fenêtre attendue.
- Identifiants de projet et de sauvegarde validés; toute opération de bibliothèque reste sous `userData/projects`.
- Suppression limitée à un projet connu, confirmée par une boîte de dialogue native, puis envoyée dans la corbeille du système.
- `ffmpeg` et `yt-dlp` sont lancés sans shell, avec des arguments séparés et une sortie mémoire bornée.
- URL et format `yt-dlp` validés; le format doit provenir de l'analyse qui précède le téléchargement.
- Mise à jour `yt-dlp` vérifiée avec le SHA-256 publié par le projet avant remplacement atomique.
- Imports texte, prompts et segments bornés pour limiter les dénis de service par épuisement mémoire.
- Package ASAR avec fuses Electron: `RunAsNode`, `NODE_OPTIONS`, inspection CLI et privilèges supplémentaires de `file:` désactivés; intégrité ASAR activée.

## Risques résiduels

- Les exécutables ne sont pas signés. Windows SmartScreen peut avertir l'utilisateur et l'origine du fichier doit être vérifiée.
- La clé Groq par défaut embarquée est récupérable par un utilisateur déterminé. Elle doit être considérée comme une clé distribuée, révocable et soumise à quota, jamais comme un secret fort.
- Le processus principal conserve les droits de l'utilisateur pour lire une vidéo choisie et écrire un export choisi. Une AppImage dans une VM Linux reste l'option d'isolation maximale.
- `yt-dlp`, FFmpeg et Electron restent des dépendances privilégiées. `yt-dlp` et le FFmpeg Linux sont contrôlés par les sommes publiées; leurs versions doivent rester à jour.

## Vérification

```sh
make desktop-security-test
make desktop-build
make npm-audit
```

Les releases sont publiées dans `desktop-releases/windows/` et `desktop-releases/linux/`. Les fichiers de test restent séparés dans `test-fixtures/`.
