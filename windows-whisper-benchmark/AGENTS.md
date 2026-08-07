# Instructions Agent

Objectif : mesurer quelle taille de modèle Whisper cette machine peut utiliser pour transcrire `audio.mp3`.

Script de lancement : `benchmark_whisper_windows.py`. Ne pas recréer de script ou de lanceur : utiliser celui-ci et le corriger seulement s’il bloque le benchmark.

Commande attendue depuis ce dossier :

```bash
python benchmark_whisper_windows.py
```

Règles :

- Lancer les modèles un par un, jamais en parallèle.
- Garder `audio.mp3` inchangé.
- Le script doit écrire progressivement dans `log.txt`; consulter ce fichier si la machine plante.
- Les résultats sont écrits dans `results/`.
- Les modèles Whisper sont chargés via `transformers` et téléchargés dans le cache Hugging Face de l’utilisateur Windows, pas dans ce dossier.
- Considérer un timeout ou un crash comme une limite de la machine, sauf bug évident d’installation.
- Corriger seulement les problèmes d’environnement utiles au benchmark : Python, dépendances, ffmpeg, PyTorch/CUDA.
- À la fin, écrire `RAPPORT.md` dans ce dossier avec : modèle recommandé, temps par modèle, erreurs/timeouts, et chemin de `results/.../summary.json`.
- Si le script a dû être modifié pour fonctionner sur Windows, documenter chaque modification dans `RAPPORT.md` : problème observé, fichier/zone corrigée, raison de la correction, et impact pour les prochains ordinateurs sans agent.
