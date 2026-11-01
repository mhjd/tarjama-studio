# CLI locale actuelle : ChatGPT manuel et voice-over local

Cette CLI travaille avec le contrat **web** courant (`Project`, `segments`,
`start_ms`/`end_ms`, `arabic`/`french`). Elle ne passe ni par Electron, ni par
FastAPI, ni par l'ancien manifest de corpus. La version web déployée et sa base
restent inchangées. Le mode manuel et le TTS n'appellent aucune API de LLM/TTS.
Le mode `api`, explicite et facultatif, utilise les clés et crédits des fournisseurs.

## Raccourcis ChatGPT sans afficher le contenu du projet

`make cli-chatgpt` réutilise les commandes existantes de prompt/import : aucun
appel LLM, aucun affichage intégral de la transcription. Les prompts sont écrits
dans le dossier du projet et copiés dans le presse-papiers. Après chaque réponse
ChatGPT, copier la réponse complète puis lancer l'import correspondant :

```sh
make cli-chatgpt ARGS='status --project data/workspaces/tts-BtcCGfzYCsw'
make cli-chatgpt ARGS='cleanup --project data/workspaces/tts-BtcCGfzYCsw'
make cli-chatgpt ARGS='import-cleanup --project data/workspaces/tts-BtcCGfzYCsw'
make cli-chatgpt ARGS='translation --project data/workspaces/tts-BtcCGfzYCsw'
make cli-chatgpt ARGS='import-translation --project data/workspaces/tts-BtcCGfzYCsw'
```

Remplacer le chemin pour un autre projet. Les imports lisent le presse-papiers,
ou `--file /chemin/reponse.md`. Les prompts acceptent `--no-copy` pour seulement
écrire le fichier, et `--chunk N` pour les projets longs (morceaux de 20 minutes).
`status` affiche uniquement étape, version, compteurs et validité des prompts.
Il n'affiche pas les textes. Réponses et état précédent restent audités dans
`imports/`, avec les vérifications existantes de projet, segments et timestamps.
Une réponse invalide ne publie aucun changement. Préparer la traduction après
l'import de correction ; ne pas réutiliser un prompt périmé.

Pour ce Short : Groq seul a été autorisé (45 segments, environ 175 secondes).
Correction et traduction se font dans ChatGPT manuel. Ne pas lire ou afficher
toute la transcription dans le contexte de l'agent. Après les imports seulement,
préparer le TTS Villepin 0,3 en conservant des sous-titres courts issus des
segments web, indépendants des regroupements vocaux en paragraphes.

### Reprendre un morceau Groq invalide

Les checkpoints de transcription valides restent dans `api_runs/`. Si un
morceau est rejeté malgré une nouvelle tentative (par exemple, timestamps de
mots inversés), le retranscrire seul en passages plus courts :

```sh
make cli-asr-retry-chunk ARGS='--project CHEMIN_PROJET --audit CHEMIN_PROJET/api_runs/HASH --index 1'
```

L'index commence à zéro : `1` désigne le deuxième morceau de 10 minutes. La
commande vérifie projet, média, moteur et corpus contre l'identité du run ;
elle ne remplace jamais un checkpoint déjà présent. Elle fait de nouveaux
appels **Groq**, conserve chaque réponse brute et passe les sous-morceaux puis
leur fusion par le validateur web avant de publier le checkpoint. Aucune
suppression arbitraire de texte, aucun tri des mots pour masquer une erreur.
La durée des sous-morceaux est réglable avec `--part-seconds` (défaut 180,
60–300 s). Relancer ensuite `make cli ARGS='api transcribe --project …'` pour
continuer normalement. Cette reprise concerne les morceaux ASR standard de
600 s espacés de 580 s ; elle ne change pas le moteur web ni ses validations.

Base inspectée le 16 octobre 2026 : `9ac44a0` (branche distante
`admin/asr-boundary-20261005`, intégrée en avance rapide dans `web-vps`).
Les instructions desktop historiques ne constituent pas la base de cette CLI.

`make cli` lance cette CLI. L'ancien outil reste accessible par `make cli-legacy`
et son ancien TUI par `make tui`.

## Réutiliser une traduction desktop existante

```sh
make cli ARGS='import-desktop --source "/chemin/bibliotheque/projects/ID" --output data/workspaces/copie-desktop'
```

Lecture seule de `project.json`, `current.json`, `translation.json` et `source.mp4`.
Les IDs, timestamps et l'empreinte d'alignement doivent correspondre ; tous les
segments doivent avoir une traduction. La CLI crée une **nouvelle copie** avec
les JSON d'origine audités et vérifie que la source n'a pas changé pendant la
copie. Elle n'écrit ni dans la bibliothèque desktop, ni dans ses snapshots.
Une copie interrompue/invalide ne publie pas de `project.json` utilisable.

Pour une longue conférence, éviter l'expansion FFV1 en conservant directement
la piste vidéo encodée originale :

```sh
make cli ARGS='export-tts --project data/workspaces/copie-desktop --output exports/conference-tts --reference-audio /chemin/reference.wav --reference-text /chemin/reference.txt --copy-video'
```

`--copy-video` n'ajoute aucune compression vidéo et conserve la résolution et
les images originales ; l'audio mixé reste en FLAC sans perte. Le MKV contient
une piste de sous-titres ASS activée par défaut (lecteur compatible nécessaire,
par exemple VLC). La copie facultative `preview` incruste ces sous-titres dans
le MP4 de lecture, sans modifier le master. Sans cette option, l'export habituel
reste FFV1/FLAC avec sous-titres incrustés. Le choix fait partie du plan de reprise.

Essais locaux du 16 octobre 2026 : la référence féminine française France 24
(`exports/references/france24-T9CAkbmpMEM/`) a été validée à l'écoute par
l'utilisateur. Export complet : `exports/X3GRq7w_WUg-tts-france24/`.
Pour « Sirat un Nabi 4 », copie des 996 segments desktop sous
`data/workspaces/tts-sirat-un-nabi-4/`, sans nouveau traitement API.
Une référence masculine de conférence est préparée sous
`exports/references/descola-j4x8o_7Qy-Q/` : Philippe Descola, leçon inaugurale
officielle du Collège de France, extrait 151,04–180,10 s, 29,08 s, 84,1 %
de parole détectée. Essai français de 22,4 s :
`exports/sirat-un-nabi-4-descola-essai/sample.wav`. L'utilisateur a écouté cet
essai et autorisé la génération complète le 16 octobre 2026. La provenance,
l'empreinte audio et le texte de référence sont conservés à côté de l'extrait.
Le plan complet de Sirat (99 paragraphes, `--copy-video`) est préparé dans
`exports/sirat-un-nabi-4-tts-descola/`. Reprendre ce plan avec les mêmes options
et `--resume` :

```sh
make cli ARGS='export-tts --project data/workspaces/tts-sirat-un-nabi-4 --output exports/sirat-un-nabi-4-tts-descola --reference-audio exports/references/descola-j4x8o_7Qy-Q/reference.wav --reference-text exports/references/descola-j4x8o_7Qy-Q/reference.txt --copy-video --resume'
```

Après validation de l'essai masculin, l'utilisateur a demandé de générer tout
l'épisode et d'exploiter sa M4 (32 Go). `--batch-size 4` permet de grouper quatre
paragraphes **indépendants** dans un seul passage GPU MLX natif, sans charger
quatre modèles ni mélanger les textes. Cette option exige une référence audio
avec son texte (ICL). Le mode habituel reste séquentiel ; les autres backends et
VoiceDesign ne sont pas pris en charge par cette option. La taille du lot est
un réglage d'exécution : on peut la changer avec `--resume`, en conservant les
paragraphes déjà validés. Comme toute synthèse échantillonnée, les nouvelles
prises ne sont pas garanties identiques bit à bit. Les marqueurs de paragraphes
enregistrent la taille et le temps du lot (temps partagé, ne pas le sommer par
paragraphe). Reprendre la commande ci-dessus avec `--batch-size 4`.
L'adaptateur MLX sélectionne explicitement le GPU et borne son cache de buffers
libres à 1 Gio : cela ne limite ni les poids ni les tenseurs actifs du modèle,
et évite le cache par défaut potentiellement supérieur à la RAM physique.
Ne pas modifier les limites globales macOS ou la mémoire câblée pour cet usage.
Le ducking de longues conférences utilise une somme équilibrée des enveloppes :
une somme linéaire de 99 passages dépassait la profondeur du parseur FFmpeg.
Le test média couvre maintenant 99 et 500 passages. Un échec d'assemblage se
reprend avec la même commande et `--resume`, sans nouvel appel au modèle TTS.

## Démarrer depuis une vidéo locale

```sh
make cli ARGS='create --video /chemin/video.mp4 --output data/workspaces/ma-video'
```

Ou depuis un lien (yt-dlp/FFmpeg installés, proxy WARP optionnel explicite) :

```sh
make cli ARGS='create --link https://www.youtube.com/watch?v=XXXXXXXXXXX --output data/workspaces/ma-video'
```

L'import copie le fichier ; l'original reste intact. Le dossier de destination
doit être nouveau. Les médias sont validés par ffprobe.

Pour transcrire localement, installer Whisper dans un environnement séparé :

```sh
make cli-asr-setup
make cli CLI_PYTHON=.venv-cli-asr/bin/python ARGS='transcribe --project data/workspaces/ma-video'
```

Apple Silicon utilise MLX Whisper ; Linux utilise faster-whisper. Le premier
appel télécharge le modèle local. Une sortie Whisper JSON déjà disponible se
réutilise sans recalcul :

```sh
make cli ARGS='import-asr --project data/workspaces/ma-video --file /chemin/whisper.json'
```

Les sorties ASR brutes sont conservées dans le `model_outputs/` du workspace.

## API automatique : même moteur que le web

Prérequis supplémentaires : Go 1.26 ou plus récent et FFmpeg.

```sh
make cli-tts-setup # pour le TTS local et son environnement isolé, si absent
make cli-api-build
make references-import # une seule fois, si le corpus n'existe pas encore
make cli-tools-setup   # yt-dlp récent, si nécessaire pour un lien YouTube
make cli ARGS='api transcribe --project data/workspaces/ma-video'
make cli ARGS='api cleanup --project data/workspaces/ma-video'
make cli ARGS='api translation --project data/workspaces/ma-video'
make cli ARGS='export-tts --project data/workspaces/ma-video --output exports/ma-video-tts'
make cli ARGS='preview --export exports/ma-video-tts'
```

Ce mode appelle un petit pont Go vers les **vraies fonctions du backend web** :
prompts embarqués, validation stricte des IDs, voisinage contextuel, découpage
`TextChunks`, recherche/fetch Parallel, outil local `quran_fr`, modèle
`studio.TextModel` et raisonnement `studio.TextReasoningEffort`. Il n'existe pas
de copie Python des paramètres LLM. Actuellement : `openai/gpt-6-luna` via
OpenRouter, effort `medium`, plafond de sortie 32768 tokens, sans température
ajoutée. Le découpage web actuel vise **10 minutes**, avec bornes de taille et
de nombre de segments ; il ne faut pas le confondre avec les morceaux manuels
ChatGPT, réglés à 20 minutes.

La transcription utilise également le fournisseur web : Groq Whisper large v3,
arabe, température 0, timestamps mots/segments, morceaux de 10 minutes avec
20 secondes de recouvrement et fusion/validation web. Whisper local reste
accessible par `transcribe` sans le préfixe `api`.

Les clés viennent de `OPENROUTER_API_KEY` / `GROQ_API_KEY`, ou des fichiers
désignés par leurs variantes `_FILE`. Ne pas les passer dans les arguments ni
les committer. Cette commande consomme les crédits/quota de ces comptes et
**pas l'abonnement ChatGPT**. Elle ne crée ni ne modifie de projet sur le VPS.
Le corpus doit être celui du web ; `--corpus` ou `REFERENCE_CORPUS_DIR` permettent
de choisir sa copie locale vérifiée. Respecter les notices/licences du corpus.

Chaque étape conserve ses réponses structurées, réponses ASR brutes et preuves de recherche sous
`api_runs/`, puis publie atomiquement le projet seulement si tous les morceaux
sont validés. Le texte précédent est conservé dans `before.json`. En cas d'échec,
relancer la même commande : les morceaux réussis sont réutilisés tant que la
source, le moteur compilé et le corpus n'ont pas changé. Aucun retry payant
illimité n'est lancé. Le projet reste verrouillé pendant une étape API.
Après une modification Go, refaire `make cli-api-build`.

Tests sans fournisseur payant : `make cli-test` et `make cli-api-test`.

## Copier-coller avec son abonnement ChatGPT

```sh
make cli ARGS='prompt cleanup --project data/workspaces/ma-video'
```

Le prompt est écrit dans `cleanup-prompt.md` et copié dans le presse-papiers.
Le coller dans ChatGPT, copier sa réponse complète, puis :

```sh
make cli ARGS='import cleanup --project data/workspaces/ma-video --clipboard'
make cli ARGS='prompt translation --project data/workspaces/ma-video'
# Coller le prompt dans ChatGPT, puis copier sa réponse :
make cli ARGS='import translation --project data/workspaces/ma-video --clipboard'
```

Sur un terminal sans presse-papiers, `prompt --no-copy` écrit uniquement le
fichier. `import --file reponse.md` ou l'entrée standard remplacent `--clipboard`.
macOS utilise pbcopy/pbpaste ; Linux utilise wl-copy/wl-paste ou xclip.

Les consignes sont reprises des prompts actuels du dépôt, avec leurs règles de
fidélité et de références religieuses. Les instructions de routage propres aux
outils du serveur (Parallel) sont adaptées aux outils de la conversation ChatGPT ;
aucun outil serveur fictif n'est fourni. C'est ChatGPT et son utilisateur qui les
exécutent ; la CLI ne prétend pas vérifier elle-même ces références. Le document
reste en Markdown horodaté pour faciliter le copier-coller. Les réponses peuvent
être entourées d'un bloc de code Markdown.

L'import vérifie le projet, les intervalles, l'ordre, les doublons et les blocs
manquants ; il refuse de déduire une suppression d'une réponse tronquée. Les
représentations `1:00:01.120` et `01:00:01.120` sont équivalentes, pas
`60:01.120`. Le projet ne doit pas avoir changé depuis la création du prompt.
Les textes avant import et la réponse sont conservés dans `imports/`, puis
`project.json` est remplacé atomiquement. Aucun snapshot desktop n'est modifié.
Une correction arabe invalide la traduction de cette copie locale.

Pour une longue vidéo, copier/importer les morceaux successivement :

```sh
make cli ARGS='prompt translation --project data/workspaces/ma-video --chunk 1 --chunk-minutes 20'
make cli ARGS='import translation --project data/workspaces/ma-video --clipboard'
make cli ARGS='prompt translation --project data/workspaces/ma-video --chunk 2 --chunk-minutes 20'
```

La CLI indique le nombre de morceaux ; chacun contient des segments entiers.
Seul le morceau demandé est remplacé à l'import. Terminer tous les morceaux de
nettoyage avant de traduire : une nouvelle correction arabe invalide le français.

## Partir d'un projet de l'application web

Une réponse JSON de `GET /api/projects/<id>` peut servir directement de projet
local avec `--project fichier.json` et `--video video.mp4`. Les anciens JSON
desktop/corpus en secondes ne sont pas acceptés silencieusement comme des projets
web en millisecondes.

La CLI peut aussi copier le projet et son média par les routes authentifiées
existantes. Exporter les cookies de sa propre session dans un fichier Netscape
privé (hors Git), puis :

```sh
make cli ARGS='projects --url https://votre-instance --cookies /chemin/cookies.txt'
make cli ARGS='fetch --url https://votre-instance --cookies /chemin/cookies.txt --id ID --output data/workspaces/copie-web'
```

Les éventuels cookies de la protection d'accès du VPS peuvent figurer dans ce
même fichier. Il n'y a pas de contournement SSO, de nouvel endpoint administrateur
ou de secret de serveur à récupérer. Une session expirée doit être renouvelée.
HTTPS est obligatoire hors localhost. Les redirections vers une connexion sont
refusées, les cookies ne sont pas imprimés. Le projet est relu après le transfert
pour détecter une modification concurrente.

**Il s'agit d'une copie locale, pas d'une synchronisation bidirectionnelle.** Les
imports ChatGPT et les exports ne modifient pas le compte web. Les clients web
continuent d'utiliser leur workflow existant ; cette modification n'active aucun
nouveau fournisseur sur le serveur.

## Export TTS français local

```sh
make cli-tts-setup
make cli ARGS='export-tts --project data/workspaces/ma-video --output exports/ma-video-tts --plan-only'
# Examiner plan.json et paragraphs.srt avant de lancer le modèle :
make cli ARGS='export-tts --project data/workspaces/ma-video --output exports/ma-video-tts --resume'
```

La vidéo est `source.mp4` à côté du projet, ou celle indiquée par `--video`.
Un environnement `.venv-tts` isolé évite de modifier les environnements ASR et
web. `CLI_PYTHON` permet de choisir un autre Python ; sans environnement TTS,
les commandes manuelles et `--plan-only` fonctionnent avec Python standard.

- Apple Silicon : MLX Audio, Qwen3-TTS **1.7B** CustomVoice quantifié 4 bits.
- Linux/autres machines : paquet officiel qwen-tts/PyTorch, 1.7B CustomVoice.
- Voix masculine par défaut : **Ryan**, génération explicitement en français.
  `--speaker Aiden` offre une autre voix masculine. Les locuteurs prédéfinis ne
  sont pas des locuteurs français natifs ; leur diction française doit être écoutée.
  Pour une voix féminine, utiliser `--speaker Serena` et un nouveau dossier d'export.
- Le premier appel peut télécharger plusieurs Go de poids. Les dépendances et
  poids sont locaux ; aucun abonnement ChatGPT n'est utilisé pour le TTS.

Si le transport Hugging Face Xet reste bloqué, relancer la même commande avec
`HF_HUB_DISABLE_XET=1` pour utiliser HTTP. Le premier téléchargement peut être
long ; le modèle Base du clonage est un téléchargement distinct.

Les segments sont d'abord réunis en phrases complètes, puis en paragraphes
visant 60 secondes et 700 caractères. Ce sont des bornes souples : une phrase
entamée est conservée jusqu'à sa fin, même si elle les dépasse. Une coupure se
fait seulement après une fin de phrase située à une frontière de sous-titres.
Une pause de 1,5 seconde entre phrases sépare les paragraphes. Un fragment final
sans ponctuation est conservé, jamais perdu. Une phrase de plus de 4000 caractères
sans frontière sûre est refusée plutôt que coupée arbitrairement.

Chaque paragraphe est généré en une seule prise avec le même modèle/locuteur.
Sa vitesse constante est ensuite ajustée par `atempo`, sans changer la hauteur,
pour tenir dans son intervalle d'origine. Des vitesses inférieures à 0,65× ou
supérieures à 1,6× sont signalées pour écoute ; aucun mot n'est raccourci en
retouchant le texte. Les paragraphes et les silences sont placés à l'échantillon.
L'original dispose d'environ 350 ms avant et 200 ms après le français lorsque
l'intervalle le permet.

Les sous-titres affichent le paragraphe sur le même intervalle, en police plus
petite adaptée à l'ordinateur (3 % du petit côté, contre environ 7,7 % dans l'export web
français courant), sans changer le projet source. Le texte long peut occuper
plus de deux lignes ; `--paragraph-chars` permet de réduire les paragraphes si
la lisibilité du rendu l'exige. Ce choix évite de prétendre conserver une
synchronisation mot à mot à l'intérieur d'une voix générée par paragraphe.

Le master est **`export.mkv`, vidéo FFV1 et audio FLAC**, à la résolution et au
framerate d'origine : pas de réduction mobile ni de compression destructive
supplémentaire. L'incrustation des sous-titres impose un réencodage vidéo ; FFV1
le rend sans perte à partir des images décodées. Ce master peut être volumineux
et n'est pas destiné à un envoi WhatsApp. Un fichier `voice.wav`, un `mix.wav`,
les prises brutes/ajustées, les sous-titres et le plan restent disponibles.

`make cli ARGS='preview --export exports/ma-video-tts'` crée un `audit.mp4`
H.264 CRF 18/AAC 256 kbit/s à la même résolution pour une lecture facile dans
QuickTime ou un navigateur. C'est une copie avec compression destructive,
distincte du master sans perte, qui reste intact. La commande refuse d'écraser
un `audit.mp4` existant.

FFmpeg doit disposer de libass, FFV1, FLAC et loudnorm. Sur macOS, la CLI préfère
le binaire Homebrew `ffmpeg-full` s'il existe ; `TARJAMA_FFMPEG` et
`TARJAMA_FFPROBE` permettent des chemins explicites. Sur Linux, installer une
police Noto Sans pour un rendu reproductible.

## Mixage documentaire et référence ARTE

La [charte multilingue ARTE, section 3.3](https://corporate.arte.tv/files/charte-multilingue_arte_web.pdf)
préconise une place pour l'original avant/après le voice-over et une hiérarchie
intelligible des voix. Elle ne prescrit pas un rapport fixe de niveaux pour
tous les programmes. Notre réglage automatique s'en inspire, sans annoncer une
conformité de livraison ARTE.

La prise française est normalisée vers -20 LUFS et l'original vers le même
repère avant atténuation. Pendant le paragraphe français, le fond est abaissé
de **18 dB** par défaut, avec entrée/sortie progressives de 150/400 ms. Le niveau
reste stable pendant les pauses internes d'un paragraphe, pour éviter le pompage
à chaque mot. Hors narration, l'original retrouve son niveau normalisé. Le mix
est protégé par un limiteur. `--original-db -22` réduit davantage le fond ;
`--original-db -14` le laisse plus présent. Ce sont des gains techniques de départ,
pas une garantie d'écart perceptif constant sur n'importe quelle bande originale.

Avec une seule piste mixée, baisser la parole originale baisse également sa
musique et ses ambiances : une séparation de stems n'est pas faite ici.
Écouter un extrait avant un export long reste nécessaire.

## VoiceDesign ou clonage : deux modes distincts

### Décrire une narratrice française, sans voix prédéfinie ni clonage

Les voix féminines CustomVoice ne sont pas des voix françaises natives. Le
français sélectionné comme langue de sortie ne garantit pas une prononciation
française naturelle. Pour essayer une voix décrite, rester dans la même famille
avec **Qwen3-TTS VoiceDesign 1.7B**, un jeu de poids distinct :

```sh
make cli ARGS='voice-sample --project data/workspaces/ma-video --output exports/essai-voicedesign'
# Écouter sample.wav et valider l'accent avant un export long :
make cli ARGS='export-tts --project data/workspaces/ma-video --output exports/ma-video-design --voice-design'
```

La description par défaut demande en anglais une narratrice native de France,
avec prononciation, voyelles nasales, rythme et liaisons du français standard.
La langue cible reste explicitement `French`. `--voice-description` permet
d'ajuster cette description ; elle figure dans les métadonnées de l'échantillon
et dans le plan d'export, donc une modification interdit une reprise silencieuse.
VoiceDesign ne reçoit ni `speaker` prédéfini ni référence audio. Il ne garantit
pas l'absence d'accent ou un timbre parfaitement identique entre générations :
l'écoute humaine reste nécessaire. Aucun autre modèle TTS n'est installé ou utilisé
pour ce mode. Les poids et la génération restent locaux.

### Cloner le timbre d'une source existante

```sh
make cli ARGS='export-tts --project data/workspaces/ma-video --output exports/ma-video-clone --clone-source'
```

Cette option choisit le modèle **1.7B Base**, distinct de CustomVoice. La
référence vise 20 secondes, jusqu'à 30 pour terminer une phrase lorsque c'est
possible. Elle est extraite de la vidéo, pas supposée commencer à zéro.
WebRTC VAD vérifie la parole sur l'audio réel en mono 16 kHz ; les fenêtres
doivent présenter au moins 60 % de frames de parole. Le meilleur candidat des
trois premières minutes, aligné sur les sous-titres, est retenu. En l'absence
de candidat, la commande refuse la génération et demande un autre passage.

Le minimum de trois secondes annoncé par [Qwen](https://github.com/QwenLM/Qwen3-TTS)
n'est pas une preuve que 20 ou
30 secondes donnent toujours un meilleur résultat. Ici, 20 secondes est une
cible d'essai raisonnable, vérifiable et réglable avec `--reference-seconds`.
VAD ne détecte ni l'identité du locuteur ni parfaitement toute musique : il
faut écouter `reference.wav` et vérifier qu'une seule voix propre est présente.
Les positions retenues figurent dans `reference.json`.

Pour choisir un passage au-delà de l'introduction :

```sh
make cli ARGS='export-tts --project data/workspaces/ma-video --output exports/ma-video-clone-2 --clone-source --reference-start 95 --reference-seconds 20'
```

Un fichier préparé peut être fourni par `--reference-audio`. Par défaut, le clonage utilise
le timbre seul (x-vector), sans transcription de référence : cela permet
d'essayer un timbre d'une source arabe avec une sortie française sans envoyer
une référence arabe non prise en charge dans le contexte textuel de génération.
La ressemblance peut être moins bonne qu'un clonage avec référence transcrite.
La même référence est utilisée à chaque paragraphe ; PyTorch prépare une fois le prompt vocal.

Pour une référence **en français**, fournir aussi sa transcription exacte avec
`--reference-text` : Qwen Base utilise alors le contexte audio + texte (ICL),
plutôt que le seul x-vector. La transcription doit correspondre uniquement à
l'extrait fourni, sans inclure les paroles d'un autre locuteur. Son contenu est
enregistré dans le plan et vérifié lors d'une reprise. Ne pas appliquer ce mode
à une référence arabe, langue non prise en charge dans ce contexte de Qwen.

```sh
make cli ARGS='voice-sample --project data/workspaces/ma-video --output exports/essai-reference-fr --reference-audio /chemin/reference.wav --reference-text /chemin/reference.txt'
# Seulement après validation à l'écoute :
make cli ARGS='export-tts --project data/workspaces/ma-video --output exports/ma-video-reference-fr --reference-audio /chemin/reference.wav --reference-text /chemin/reference.txt'
```

Un essai synthétique fondé sur une voix de journalisme reste une génération
locale : ne pas le présenter comme une narration originale ou une approbation
de la personne/de la chaîne source. Conserver l'attribution du média de référence.
L'option de clonage peut nécessiter un second téléchargement de poids ; elle
reste indépendante de la voix masculine prédéfinie.

## Reprise et vérification

Le dossier d'export doit être nouveau, sauf `--resume`. La reprise vérifie le
plan, le texte, les réglages, les hashes vidéo/référence et ceux des prises.
Elle réutilise les paragraphes terminés ; un changement de source demande un
nouveau dossier pour éviter un mélange silencieux de versions. Un verrou
système évite deux écritures concurrentes et se libère après un crash.

```sh
make cli-test
```

Un essai réel facultatif génère une voix masculine et un export sur une vidéo
synthétique, sans média privé ni API payante :

```sh
make cli-tts-smoke TTS_SMOKE_OUTPUT=exports/essai-tts
# Pour tester aussi le second modèle Base et le clonage de cette voix synthétique :
make cli-tts-smoke TTS_SMOKE_OUTPUT=exports/essai-clone TTS_SMOKE_CLONE=1
```

Le second essai vérifie le mécanisme sur la voix que le premier modèle vient de
générer ; il ne prouve pas la fidélité d'un clonage arabe → français réel.

Les tests couvrent le contrat web, les imports manuels/stales, les timestamps
après une heure, les frontières de phrases, la sélection d'une référence hors
silence, la vitesse et la hauteur mesurées sur un signal synthétique, et un
véritable export FFmpeg sans perte avec reprise. Les tests automatiques ne
téléchargent pas de modèle et n'appellent aucun fournisseur payant. Les essais
de voix réelle sont à distinguer de ces tests déterministes.

### Vérification effectuée le 16 octobre 2026

- `make cli-test` : 25 tests réussis, dont le montage FFmpeg réel, la reprise API
  et le routage VoiceDesign sans voix prédéfinie ni référence de clonage.
- `make cli-api-test` : tests Go réussis, avec fournisseur HTTP simulé vérifiant
  le modèle, le raisonnement, le plafond de sortie et les outils du web.
- macOS Apple Silicon, MLX Audio 0.4.8 : génération française Ryan avec
  CustomVoice 1.7B 4 bits, puis clonage avec Base 1.7B 4 bits et exports complets.
- Essai local : `exports/tts-smoke-20261016-verified/`, hors Git. La référence
  extraite contient 17,55 secondes de parole détectée sur 20 secondes (87,7 %).
- Les poids sont maintenant en cache sur cette machine. Le premier téléchargement
  HTTP a nécessité des reprises après des coupures réseau.
- Le backend PyTorch/Linux et la fidélité du clonage d'une vraie voix arabe
  n'ont pas été testés ici. Aucun déploiement ni appel à une API payante.

Essai complet API demandé ensuite : vidéo YouTube `X3GRq7w_WUg`, copie locale
dans `data/workspaces/tts-X3GRq7w_WUg-v2/`. Groq a produit 47 blocs ; correction
et traduction ont utilisé le moteur web Luna/medium. Export masculin Ryan
dans `exports/X3GRq7w_WUg-tts/`, six paragraphes, source 1920 × 1080 conservée.
Les vitesses mesurées vont de 0,886× à 1,580×. Les fichiers JSON de ce dossier
et `api_runs/` contiennent les paramètres, preuves d'usage et empreintes.
Ces fichiers locaux sont hors Git ; aucun projet du serveur n'a été modifié.

À la demande de l'utilisateur, une version clonant la présentatrice est ensuite
générée dans `exports/X3GRq7w_WUg-tts-clone-presentatrice/`, avec `--clone-source
--reference-start 0.44`. La référence va de 0,44 à 21,70 secondes, sur des phrases
complètes, avec 20,7 secondes de parole détectée. Même traduction et timestamps,
modèle Base 1.7B et timbre de référence (pas Serena ni Ryan). La version masculine
reste intacte. L'essai Serena, d'abord interrompu, a ensuite été repris à la demande
de l'utilisateur : la version féminine **sans clonage** est dans
`exports/X3GRq7w_WUg-tts-feminin/` (`speaker: Serena`, `clone_source: false`).

Après retour utilisateur sur l'accent de Serena, passage demandé à VoiceDesign
1.7B, sans autre famille de modèle. L'échantillon réel et sa description sont
dans `exports/X3GRq7w_WUg-voicedesign-essai/sample.wav` et `sample.json`.
Génération MLX effectuée avec le checkpoint `5c390979e4b93af5f2932f90742ca99c7dd04687`.
La qualité de l'accent attend une validation à l'écoute par l'utilisateur avant
de refaire la vidéo entière. Aucun clonage ni lancement automatique de lecture.

Retour utilisateur : l'essai VoiceDesign n'a pas été jugé qualitatif ni adapté
au ton journalistique. À sa demande, nouvel essai avec une référence française
France 24 : `https://www.youtube.com/watch?v=T9CAkbmpMEM`, présentation de Louise
Dupont entre 61,45 et 81,55 secondes, hors réponse du collègue et dialogues de films.
Seuls les passages utiles ont été téléchargés pour cette émission, pas sa totalité.
Audio mono 24 kHz de 20,12 s (19,35 s de parole détectée), transcription et
provenance dans `exports/references/france24-T9CAkbmpMEM/`.
L'échantillon cible réel est `exports/X3GRq7w_WUg-france24-essai/sample.wav`
(15,36 s), produit par Qwen Base 1.7B avec audio + texte français (ICL).
Il attend un retour d'écoute avant de refaire le rendu long. Les sous-titres
YouTube automatiques ont servi à la transcription de référence, avec correction
des noms d'après la description officielle ; la validation auditive reste requise.

## Piper français : comparaison Tom / Pierre

Choix utilisateur actuel : lecture de conférence fidèle et sobre, sans clonage.
Kokoro a été envisagé puis annulé ; aucune vidéo Kokoro n'a été générée.
Les anciens exports Qwen restent intacts. Installation isolée, ONNX CPU limité à
4 threads intra-op et 1 inter-op, sans API payante ni changement du service web :

```sh
make cli-piper-setup
make cli-piper-compare ARGS='--project data/workspaces/tts-sirat-un-nabi-4 --output exports/sirat-un-nabi-4-piper-comparaison --seconds 300'
```

La comparaison copie uniquement les segments jusqu'à la première fin de phrase
à partir de cinq minutes, et ajoute 500 ms de marge. Elle ne modifie pas le projet
source. Chaque voix reçoit exactement le même texte. `tom/export.mkv` et
`pierre/export.mkv` conservent l'image encodée source, une piste française mixée
avec l'original atténué de 18 dB pendant la voix, et les sous-titres ASS séparés.
Chaque paragraphe est assemblé avant un unique ajustement de vitesse sans changement
de hauteur. Plans, empreintes des modèles/configurations/textes et temps de génération
permettent de vérifier ce qui a été produit. Ne pas ouvrir automatiquement les fichiers.

Export complet après choix de voix (nouveau dossier obligatoire, ou `--resume`
avec exactement le même plan) :

```sh
make cli-piper ARGS='export-tts --engine piper --speaker Tom --project data/workspaces/tts-sirat-un-nabi-4 --output exports/sirat-un-nabi-4-tts-piper-tom --copy-video'
```

`--speaker Pierre` sélectionne le modèle UPMC et son locuteur `pierre` (ID lu
dans la configuration, pas Jessica). Les poids se trouvent sous `web/.cache/piper`.
La carte Tom indique AGPLv3 pour son jeu de données ; UPMC indique CC-BY-SA 4.0.
Vérifier les obligations des voix et du moteur Piper GPL avant intégration/distribution
dans le produit hébergé ; cette commande ne réalise aucun déploiement.

## Essai Pocket TTS français (17 octobre)

Tom et Pierre ont été rejetés à l'écoute comme trop robotiques. Le candidat
suivant est Pocket TTS 3.3.0, variante `french_24l`, voix française prédéfinie
Estelle, sans nouveau clonage. Les modèles et embeddings sont téléchargés depuis
les révisions publiques référencées par la configuration du paquet installé,
pas depuis une branche `main` flottante. Le plan enregistre leurs empreintes.

```sh
make cli-pocket-setup
HF_HUB_DISABLE_XET=1 make cli-pocket-sample ARGS='--project exports/sirat-un-nabi-4-piper-comparaison --output exports/sirat-un-nabi-4-pocket-estelle-essai'
```

L'essai réutilise le même extrait de 5 min 18 s, ses neuf paragraphes et ses
sous-titres. `export.mkv` contient l'image sans recompression et le mix recalé,
avec l'original discret. `natural.wav` concatène les prises brutes, sans recalage,
avec 200 ms entre paragraphes : sa durée diffère volontairement de celle de la
vidéo. Les textes source ne changent pas ; le modèle applique son prétraitement
standard de ponctuation. Un état de voix indépendant est copié à chaque génération,
avec une graine déterministe par paragraphe. Inférence CPU, quatre threads ; aucune
API payante et aucun changement du service web. Ajouter `--resume` après une
interruption, avec les mêmes réglages. Ne rien ouvrir sans le signal de l'utilisateur.

Attention PyTorch : ne pas envelopper `generate_audio` dans `torch.inference_mode()`.
Les caches créés dans ce contexte sont ensuite modifiés par les threads internes
de Pocket, ce qui provoque « Inplace update to inference tensor outside InferenceMode ».
L'adaptateur utilise `torch.no_grad()` ; un test avec de vrais tenseurs et un thread
de travail couvre cette régression. Après l'échec initial, aucun paragraphe audio
n'avait été publié ; la relance avec `--resume` conserve le même plan.

## Nouvelle synchronisation : français naturel, vidéo et original recalés

Dernière décision utilisateur : ne plus étirer la voix française dans le rendu
final. Le post-traitement suivant réutilise les prises brutes d'un export terminé,
sans nouvelle génération ni écriture dans le projet source :

```sh
make cli-retime ARGS='--export exports/sirat-un-nabi-4-pocket-estelle-essai --output exports/sirat-un-nabi-4-pocket-video-recalee'
```

La vidéo et le fond original changent de vitesse ensemble par paragraphe ; la
hauteur de l'original est conservée avec `atempo`. Aucun `atempo` n'est appliqué
au français : seulement normalisation, rééchantillonnage et ajout de silence.
Les gaps source sont conservés à l'arrondi d'une image près. Les sous-titres
de l'export sont remappés et `timing.json` trace chaque intervalle source/sortie.
Les timestamps du projet restent inchangés. Le changement de vitesse impose un
réencodage : résolution originale, H.264 CRF 18 / préréglage fast, FLAC pour le mix.
Ce n'est plus une copie bit à bit de la piste vidéo. Les anciens exports restent
intacts ; nouveau dossier obligatoire, sans reprise automatique de ce post-traitement.
Pour exporter seulement le début d'une vidéo, `--seconds` mesure la durée dans
la source, pas la durée finale recalée. Le paragraphe qui contient la limite est
conservé en entier (et le TTS n'est jamais tronqué) :

```sh
make cli-retime ARGS='--export exports/sirat-un-nabi-4-tts-descola --output exports/sirat-un-nabi-4-qwen09-15min-video-recalee --seconds 900'
```

Dans cet essai Qwen 0,9, les prises brutes existantes des 24 premiers paragraphes
sont réutilisées, sans régénération. La source va jusqu'à 15 min 08,140 s ; la
durée finale prévue est 13 min 28,224 s. Sous-titres de sortie remappés, projet
et versions précédentes intacts. `timing.json` contient la limite demandée et
la limite source effective.

Les anciens exports `export-tts`/`cli-pocket-sample` gardent leur recalage historique
et servent ici de cache de prises brutes ; pour un rendu final, utiliser ce nouveau
post-traitement. Ne pas affirmer que les accélérations fortes seront imperceptibles.

### Mixage documentaire tenant compte de la parole

```sh
make cli-retime ARGS='--export exports/sirat-un-nabi-4-qwen05-5min/raw --output exports/NOUVEL_ESSAI --seconds 300 --speech-intro --original-db -28'
```

`--speech-intro` analyse l'original et les prises françaises avec WebRTC VAD
(fenêtres de 30 ms, mode 2, seuil d'énergie −50 dBFS). Le silence initial ne
compte pas : l'introduction préserve environ 1,5 seconde de **parole détectée**
avant le français. Les pauses rencontrées restent présentes mais ne consomment
pas ce budget. Une introduction revient seulement à une frontière de paragraphe
précédée d'au moins 3 secondes sans parole originale, pas à chaque paragraphe.
Ce n'est pas un alignement mot à mot ; une reprise interne au paragraphe ne crée
pas d'introduction supplémentaire. Pour une intervention très courte, le budget
est réduit ; une absence de parole détectée produit une erreur explicite.

L'original normalisé est atténué de **−28 dB** par défaut dans ce mode ; le fondu
atteint ce niveau au début détecté du français. Le niveau reste bas à travers
les pauses internes et les intervalles de moins de 3 secondes entre paragraphes,
sans remontée systématique de l'original. Attaque : 350 ms ; retour : 1 seconde.
La détection est heuristique : vérifier à l'écoute, notamment avec musique/bruit.
`speech-mix.json` conserve les détections, introductions et fenêtres de mixage ;
`timing.json` conserve le recalage. Les prises TTS sont réutilisées sans nouvelle
génération, le français reste à vitesse naturelle et le projet source est intact.

### Garder les sous-titres courts de l'application web

Les paragraphes vocaux n'imposent plus le découpage visuel. Après compilation
du pont local, fournir le projet traduit lors du recalage :

```sh
make cli-api-build
make cli-retime ARGS='--export exports/BtcCGfzYCsw-qwen03-villepin/raw --output exports/BtcCGfzYCsw-qwen03-villepin/documentary --speech-intro --original-db -28 --subtitle-project data/workspaces/tts-BtcCGfzYCsw'
make cli ARGS='preview --export exports/BtcCGfzYCsw-qwen03-villepin/documentary'
```

Le rendu utilise les fonctions Go `studio.ASS`/`studio.SRT` de l'app web, sans
appel fournisseur ni clé API : mêmes segments, regroupement automatique limité
des voisins courts et même style blanc sur fond noir. Il ne s'agit pas du mode
optionnel de regroupement des phrases complètes. Les sous-titres sont remappés
sur le temps de la vidéo recalée, pas alignés mot à mot sur le français généré.
Le projet, les IDs, les textes des groupes et leurs bornes sont vérifiés avant
export. Le projet source n'est pas modifié.

`subtitles.srt`, `subtitles.ass` et `subtitle-source.json` gardent les cues et
leur provenance. Le MKV contient une piste ASS ; `preview` produit `audit.mp4`
avec ces mêmes sous-titres **incrustés**, visibles aussi sur téléphone. Les
anciens exports FFV1 déjà incrustés ne sont pas incrustés une seconde fois.

Comparaison Qwen courte, sans changement de vitesse audio :

```sh
make cli-qwen-compare ARGS='--export exports/sirat-un-nabi-4-pocket-estelle-essai --reference-audio exports/references/descola-j4x8o_7Qy-Q/reference.wav --reference-text exports/references/descola-j4x8o_7Qy-Q/reference.txt --output exports/sirat-un-nabi-4-qwen-temperatures'
```

Les deux premiers paragraphes contiennent Allah et jahiliyya. Même référence,
texte, graine, top-k 50 et top-p 1 ; seule la température varie (0,9 / 0,6 / 0,35).
MLX impose une pénalité de répétition minimale de 1,5 en ICL ; elle est notée dans
le plan, sans modifier la bibliothèque. Le témoin Pocket reprend exactement les
mêmes paragraphes. Tous les WAV sont à vitesse naturelle, aucune graphie de
prononciation expérimentale n'est ajoutée aux textes. Écoute requise avant choix.

### Nouvelle génération à une température explicite

Ne pas confondre l'ancienne génération complète à 0,9 et les nouvelles prises
contrôlées à 0,9 : même température ne signifie pas même audio. Pour un nouvel
essai, générer des prises dans un nouveau cache avec paramètres et graines tracés,
puis recaler directement la vidéo, sans étirer le français :

```sh
make cli-qwen-sample ARGS='--export exports/sirat-un-nabi-4-tts-descola --reference-audio exports/references/descola-j4x8o_7Qy-Q/reference.wav --reference-text exports/references/descola-j4x8o_7Qy-Q/reference.txt --temperature 0.5 --seconds 300 --output exports/sirat-un-nabi-4-qwen05-5min'
```

`raw/plan.json` enregistre explicitement température, graines par paragraphe,
référence, texte, modèle, plafond de tokens et pénalité de répétition effective
MLX. `raw/raw-complete.json` n'est publié qu'une fois toutes les prises terminées ;
le recalage contrôle son empreinte de plan et celles des prises. `raw/natural.wav`
permet une écoute sans changement de vitesse ; `video/export.mkv` contient le
rendu avec image et fond original recalés ensemble. Aucun audio 0,9 n'est réutilisé.
La limite de cinq minutes s'applique au contenu source et termine le paragraphe
en cours. Ajouter `--resume` pour reprendre la génération avec un plan identique.
Si le rendu vidéo lui-même a été interrompu, ses prises restent réutilisables avec
`make cli-retime --export …/raw --output NOUVEAU_DOSSIER …` (via `ARGS`, comme
ci-dessus) ; ne pas écraser un dossier vidéo partiel ou un ancien essai.

Ajouter `--raw-only` à `cli-qwen-sample` pour générer les prises et l'audio
naturel sans l'ancien rendu vidéo intermédiaire ; lancer ensuite directement
`cli-retime` avec les options documentaires et `--subtitle-project`. Pour dix
minutes source, utiliser explicitement `--seconds 600` aux deux étapes. Le
recalage termine le paragraphe en cours, sans couper sa phrase. MLX utilise le
GPU Apple Silicon ; FFmpeg choisit automatiquement son nombre de threads pour
le réencodage (pas de limite fixe à quatre threads).

### Essai VoiceDesign sans référence audio

Le même générateur peut utiliser le modèle officiel Qwen VoiceDesign, avec
description d'une voix fictive et sans clonage :

```sh
make cli-qwen-sample ARGS='--export exports/logique-desktop-tts-plan --voice-design --voice-description-file exports/voice-design/conferencier-fr-mature/description.txt --temperature 0.3 --seconds 60 --raw-only --output exports/NOUVEL_ESSAI_DESIGN'
make cli-retime ARGS='--export exports/NOUVEL_ESSAI_DESIGN/raw --output exports/NOUVEL_ESSAI_DESIGN/documentary --seconds 60 --speech-intro --original-db -24 --subtitle-project data/workspaces/tts-logique-desktop'
```

Ce mode interdit les références audio/texte ; le plan enregistre le modèle
VoiceDesign, la description, les paramètres et les graines. Le nom d'un
speaker prédéfini n'est pas utilisé en VoiceDesign. La limite source termine
le paragraphe en cours (dans cet essai : deux paragraphes, 84,320 s source).
La cohérence du timbre et de la prosodie entre prises reste à vérifier à
l'écoute. Ne pas annoncer une imitation fidèle d'une personne existante.

Retour d'essai : la version finale `logique-voicedesign-conferencier-1min-v3`
utilise un plan à groupes plus courts (20 s / 240 caractères) et
`--repetition-penalty 1.5`, car le réglage 1,05 a atteint 2048 tokens sans finir.
Ce paramètre est enregistré dans le plan et ne modifie pas les anciens essais.
Cette version couvre 66,240 s source et dure 90,033 s avec français naturel.
