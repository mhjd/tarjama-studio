# Essais locaux de doublage et d'alignement

Ces outils sont des prototypes locaux, pas une implémentation hébergée. Le
backend web est la référence de contrat. Voir `web/cli/README.md` pour les
commandes, les dépendances, les limites et les protocoles de reprise ; voir
`tools/voice_audition/README.md` pour l'outil de comparaison de voix.
Les projets, audios, médias, réponses STT et caches locaux ne sont pas inclus.

## Décisions et méthodes testées

- Qwen3-TTS Base 1.7B, français, clonage à partir d'une référence audio et de
  sa transcription. Sur le Mac M4, MLX 4 bits, température 0,3 pour les essais
  de conférence ; top-p 1, top-k 50, pénalité ICL effective au moins 1,5. Les
  lots partagent un état aléatoire : ils ne sont pas identiques à des prises
  générées indépendamment avec les mêmes graines. Pas de validation sur VPS.
- Paragraphes vocaux aux frontières de phrases lorsque possible. Les prises
  restent à leur vitesse naturelle ; `retime_video.py` adapte par intervalle
  la vidéo et l'audio original, sans modifier les timestamps du projet source.
  Les fortes variations de vitesse peuvent être visibles.
- `speech_mix.py` détecte la parole et introduit l'original avant la voix
  française ; le silence initial ne compte pas comme parole. Niveau original
  testé à -24 dB pour la conférence. Les cas bruités exigent une écoute.
- Les sous-titres courts restent distincts des paragraphes vocaux. Le pont CLI
  utilise `studio.ASS` / `studio.SRT`, et non le regroupement S1 optionnel des
  exports web : ne pas supposer que les partitions sont identiques.
- `align_subtitles.py` aligne le texte connu sur chaque prise avec Whisper Base
  MLX et refuse les alignements incohérents. Les bornes sont réinitialisées à
  chaque prise. Un test sur une conférence et une référence Groq approximative
  a donné une médiane de 119 ms et un 90e percentile de 368 ms sur 328 bornes ;
  ce n'est ni une vérité terrain ni une garantie générale.
- L'heuristique de pauses dans `subtitle_audio.py` limite ses corrections à
  600 ms et conserve un repli sur les bornes initiales. Son gain mesuré était
  faible. Les heuristiques plus agressives ont été écartées.
- Canary 180M Flash CPU : 225/266 sous-titres correspondants, 41 non résolus ;
  le rendu a été refusé. Avec contexte chevauchant : 222/266. Canary reste
  expérimental et n'a pas été validé comme remplacement complet de Whisper.
- Les voix Piper Tom et Pierre ont été jugées trop robotiques. Qwen VoiceDesign
  n'a pas été retenu pour cette audition ; une voix de référence CML-TTS 4482
  enhanced a été appréciée et utilisée pour les essais suivants. Les voix 1770
  et 6318 sont d'autres candidates, à comparer et à vérifier juridiquement.

## Points d'entrée

`web/cli/` contient la CLI, les tests, les générateurs TTS, les expériences
d'alignement et les scripts de rendu. `web/backend/cmd/local-api/` est son pont
local vers les types et fournisseurs web. `tools/voice_audition/` contient
l'outil de sélection local, son serveur SQLite et ses tests. Les cibles `make`
correspondantes sont dans le Makefile ; les environnements et modèles ne sont
pas inclus. La comparaison audio utilisait le même passage source d'environ
cinq minutes pour chaque voix et des prises Qwen nouvellement générées.

Les essais reposent sur des chemins et données propres à la machine d'origine.
Adapter la configuration, confirmer les licences et mesurer les ressources sur
le serveur avant toute intégration. Éviter d'envoyer des transcriptions, clés,
fichiers médias ou données utilisateur dans les journaux et le dépôt.
