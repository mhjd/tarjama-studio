Le projet consiste à créer une application locale facilitant la transcription, la correction et la traduction de vidéos arabes.

## Objectif produit

L'application doit permettre de partir d'un audio/vidéo, générer ou charger une transcription horodatée, la corriger en écoutant précisément les passages difficiles, puis produire une traduction assistée par LLM. Le flux cible est: transcription automatique -> correction humaine efficace -> traduction segmentée -> export.

## Flux actuel

- La génération de transcriptions est pilotée par la CLI locale `scripts/ashrafent_cli.py`.
- L'interface web est spécialisée dans l'édition d'une transcription segmentée déjà existante.
- Une vidéo sans transcription doit afficher qu'elle doit être transcrite via la CLI, pas lancer Whisper depuis le navigateur.
- Une app desktop Electron est en cours d'introduction pour les utilisateurs non techniciens: pas de backend FastAPI à lancer, bibliothèque locale gérée automatiquement, import de transcription, téléchargement YouTube et export vidéo local.

## MVP interface

- Lecteur audio fixe en haut de page, avec barre de progression large, navigation précise, champs de début/fin d'intervalle et lecture en boucle.
- Liste de segments éditables, chacun avec horodatage cliquable, texte arabe corrigible et zone de traduction associée.
- Chargement de l'état courant depuis `data/workspaces/<corpus_id>/transcript.json` ou import depuis une sortie Whisper locale existante.
- Enregistrement silencieux de l'état courant pour éviter de perdre les corrections en cas de crash.
- Sauvegardes explicites et immuables sous `data/workspaces/<corpus_id>/snapshots/`; consulter une ancienne sauvegarde doit se faire en lecture seule. Restaurer une sauvegarde copie son contenu vers l'état courant après confirmation, mais le snapshot lui-même n'est jamais édité. Si l'état courant diffère de la dernière sauvegarde, l'interface doit demander à l'utilisateur de reprendre ou restaurer avant toute édition.
- La traduction est importée depuis un fichier Markdown produit hors de l'app. L'import vérifie que chaque bloc conserve exactement les timestamps de la transcription courante; sinon il est refusé. Une traduction attachée est stockée séparément dans `data/workspaces/<corpus_id>/translation.json`.
- L'interface peut exporter un MP4 sous-titré via `ffmpeg` uniquement quand une traduction attachée est disponible. Le rendu génère un `.ass` stylé texte blanc sur fond noir puis écrit les fichiers dans `exports/<corpus_id>/`.

## Décisions actuelles

- Les sorties ASR brutes dans `data/model_outputs/` doivent rester auditables. L'interface peut les lire, mais les corrections doivent être enregistrées comme état de travail/export, pas comme remplacement silencieux des résultats de benchmark.
- `whisper_large_v3_mlx` local est la base la plus stable pour travailler hors coût cloud.
- `openai/gpt-4o-mini-transcribe` via OpenRouter est utile comme seconde opinion, mais nécessite un découpage adaptatif et des garde-fous contre les sorties tronquées ou répétées.
- `openai/gpt-4o-transcribe` via OpenRouter s'est montré instable dans nos essais et n'est pas recommandé pour le moment.
- `openai/whisper-large-v3` via OpenRouter est une option cloud peu chère, mais les longs fichiers peuvent échouer d'un bloc; le chunking reste nécessaire.

## CLI

Chemin principal:

- `make tui`

Dans le TUI, l'action principale est `Nouvelle vidéo complète: télécharger -> transcrire -> nettoyer`. Elle télécharge une URL YouTube, extrait l'audio, ajoute l'entrée au manifest, lance Whisper local, copie le prompt de nettoyage ChatGPT dans le presse-papiers, puis attend le JSON nettoyé collé dans le terminal pour l'importer après validation.

Commande directe équivalente:

- `python scripts/ashrafent_cli.py youtube-pipeline <youtube_url>`

Commandes secondaires/deprecated, gardées pour maintenance:

- `python scripts/ashrafent_cli.py list-missing`
- `python scripts/ashrafent_cli.py transcribe <corpus_id>`
- `python scripts/ashrafent_cli.py transcribe-missing`
- `python scripts/ashrafent_cli.py download <youtube_url> --transcribe`
- `python scripts/ashrafent_cli.py copy-cleanup-prompt <corpus_id>`
- `python scripts/ashrafent_cli.py import-cleaned-transcript <corpus_id>`

La CLI télécharge les vidéos YouTube dans `data/raw/videos/youtube/`, extrait un WAV mono 16 kHz dans `data/raw/audio/youtube/`, ajoute une ligne au manifest, lance Whisper local si demandé, puis crée le workspace d'édition.

`copy-cleanup-prompt` copie dans le presse-papiers un prompt ChatGPT de nettoyage de transcription suivi du JSON workspace courant. Le prompt est personnalisable dans `prompts/transcript_cleanup.md`. Le TUI peut ensuite importer le JSON nettoyé collé; l'import vérifie le format workspace, les métadonnées et la cohérence des timestamps, tout en autorisant les ajouts/suppressions de segments.

## Données et scripts

- Corpus et médias: `data/`
- Manifest principal: `data/manifests/dedew_manifest.jsonl`
- Scripts ASR/eval: `scripts/`
- MVP local: backend FastAPI dans `server/`, frontend React/Vite dans `ui/`, lancement backend via `scripts/serve_mvp.py`.
- Desktop reviewer: `ui/electron/`, build via `cd ui && npm run desktop:build`. Le mode desktop expose une API IPC limitée via `window.ashrafentDesktop`; toute suppression doit rester bornée à la bibliothèque Electron et passer par la corbeille.
