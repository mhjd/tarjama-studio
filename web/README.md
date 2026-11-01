# Tarjama web

La CLI locale actuelle (API web ou copier-coller ChatGPT, Whisper local/Groq, export voice-over
Qwen3-TTS 1.7B ou Piper français) est décrite dans [cli/README.md](cli/README.md). Elle utilise le
format des projets web et ne modifie pas l'application déployée.

Application Go/PostgreSQL/React séparée du desktop. La référence métier est `DesktopApp`, `ui/electron/groq.ts`, `editor-logic.ts`, `export-options.ts` et `library.ts` au commit `183cf9b`. Le backend FastAPI et l'ancien `App` n'interviennent pas.

**Aucune mise en service dans cette livraison.** [Bilan](docs/STATUS.md), [exploitation préparée](docs/OPERATIONS.md), [sécurité et limites](docs/SECURITY.md).

## Vérifier localement

Prérequis : Docker, Compose, Make. Go/Node/FFmpeg/Chromium sont dans l'image d'outils. Aucun secret réel n'est nécessaire.

```sh
make web-tools
make web-deps
make web-test
make web-build
make web-images
make web-config WEB_ENV=web/deploy/.env.example
```

`web-test` crée uniquement `tarjama-isolated-test`, sur réseau Docker interne sans port hôte. PostgreSQL est temporaire, avec des données synthétiques. Le navigateur et son serveur écoutent sur loopback à l'intérieur du conteneur. FFmpeg effectue réellement les exports ; Gemini/Groq sont simulés et OIDC utilise un fournisseur local signé. La commande arrête ensuite cette stack de test. Les tests ne touchent pas aux conteneurs préexistants, au proxy, au DNS ou aux routes du VPS.

Un Make absent peut être installé par l'administrateur. Pendant cette mission, son exécutable a simplement été extrait de l'image d'outils dans `web/.cache/make`, sans installation système. Les résultats de test et builds sont ignorés par Git.

```sh
make web-dev
make web-dev-down
```

La démonstration de développement, facultative, expose seulement `127.0.0.1:8090`. Elle porte explicitement la mention de développement et propose Alice/Bob. Les fournisseurs sont simulés ; elle n'est pas une préproduction et ne doit jamais être reliée au proxy public. Ses volumes sont distincts et conservés par `web-dev-down`.

## Organisation

- `backend/internal/studio/` : API, sessions, documents courants, transactions, jobs, fournisseurs et média. SQL intégré à l'exécutable. Une version de concurrence n'est pas une révision restaurable.
- `backend/cmd/tarjama` : commandes `api`, `worker`, `media`, `egress`, `migrate`, `import`, `gc`, `healthcheck`.
- `backend/cmd/fixture` : serveur de tests/démonstration ; absent de l'image de production.
- `frontend/src/` : bibliothèque, création, éditeur, clés et file de sauvegardes. Aucune dépendance Electron ou ancien adaptateur `/api/videos`.
- `deploy/` : images, trois Compose distincts, exemple de proxy et initialisation du rôle DB.
- `docs/` : décisions, vérifications et procédure de future mise en service.

## Contrats essentiels

Textes sauvegardés au blur uniquement lorsqu'ils ont changé. Navigation, validation et export attendent le flush, y compris la composition IME. Un conflit conserve le brouillon ; son remplacement exige une action explicite. Les brouillons locaux sont séparés par compte/projet et purgés à la déconnexion. Fermer brutalement un téléphone ne garantit jamais une écriture serveur.

Chaque média/segment/job/export appartient au propriétaire du projet. Les sessions ne prennent aucun ID utilisateur du navigateur. Les URL de vidéos sont normalisées vers des vidéos YouTube individuelles ; import de fichier disponible dès la création ou dans le même projet après échec d'un lien.

Le candidat utilise `whisper-large-v3` pour la transcription et
`deepseek/deepseek-v4.1-flash` via OpenRouter pour correction/traduction. Gemini
est retiré. Search/Fetch passent exclusivement par Parallel. Clé partagée par
défaut, personnelle facultative, aucune bascule silencieuse d'une clé personnelle
invalide. Pas de crédits applicatifs, prompts personnalisés, historique utilisateur
ou sauvegarde manuelle. Ce candidat attend sa qualification réelle Parallel et
la migration 003 ; voir [les décisions](../docs/REFERENCE_TOOLS_AND_PARALLEL.md).

## Aperçu privé administré

La recette du moteur générique `vps-preview` et ses prérequis sont décrits dans
[docs/PREVIEW.md](docs/PREVIEW.md). Le modèle racine `deploy.preview.yml` conserve
tous les services arrêtés ; aucune activation sans images privées, secrets,
identité, réseau et sandbox qualifiés.

### Découpage texte et modèle (24 septembre 2026)

Correction et traduction utilisent DeepSeek V4.1 Flash via OpenRouter, avec les
outils Parallel. Les chunks visent 10 minutes, aux frontières des segments, avec des garde-fous de 600 segments et
64 000 octets arabes. Le budget de réponse est de 32 768 tokens ; une réponse
tronquée ou mal alignée est toujours refusée. La limite temporelle est une cible,
les entrées denses peuvent être coupées plus tôt. Les appels restent bornés à
5 minutes et annulables. Le découpage Groq demeure indépendant (10 minutes).
Les anciens morceaux validés conservent leurs frontières ; seule la suite encore
à traiter adopte les nouveaux plafonds. Les quotas du compte ne sont pas codés en
dur : les 429 conservent la file d’attente et la reprise automatique.
# Local TTS performance and caption timing

`make cli-qwen-sample ARGS='… --raw-only --resume --batch-size 4'` enables
four-paragraph MLX batches with the same reference audio/text (default: one).
Completed hash-verified takes are reused even when changing batch size. Batch
markers record the actual shared RNG seed and indices; batch output is not
bit-identical to independently seeded generation. On the M4, a measured four-take
test took 31.9 s versus 50.4 s sequentially (1.58×, 7.96 GiB peak MLX); other
paragraph lengths can produce different gains. Reproduce in a fresh directory
using `make cli-qwen-batch-benchmark ARGS='--source RAW_DIR --reference REF.wav --output NEW_DIR'`.

For natural-speed dubbing, `make cli-retime ARGS='--export RAW_DIR --output NEW_DIR --seconds 4747 --speech-intro --original-db -24 --subtitle-project PROJECT_DIR --subtitle-timing voice --lean'`
retimes the source picture/audio, not the French voice. Replace the source limit
as appropriate. Optional `voice` captions divide each take by text-length weights
and reset at every paragraph; they cannot accumulate global drift but are not
word-level alignment. The default remains `video`. `--lean` removes only new
temporary fitted WAVs/video pieces/mix after their validated successors exist;
keep originals and raw takes. To burn captions and embed attribution:
`make cli ARGS='preview --export NEW_DIR --credits-file ATTRIBUTION.txt'`.
To limit the shared clip to the first 900 seconds of the OUTPUT timeline, add
`--seconds 900` (creates `audit-first-900s.mp4`, preserves other previews).
`--retimed-input` can mix and burn captions directly from existing
`retimed-source.mkv`, `voice.wav`, `mix.ffscript` and `timing.json`, without first
finishing a complete master. It does not regenerate TTS or source-picture retiming.

Optional, explicitly quota-consuming timing audit:
`make cli-subtitle-audit ARGS='--export NEW_DIR --project PROJECT_DIR --output NEW_AUDIT_DIR'`.
It sends only the first 600 seconds of the generated French voice to Groq
(`GROQ_API_KEY` or `_FILE`), with French word timestamps, not the mixed original.
Raw STT text stays in audit files; stdout contains only timing metrics. Repeating
the same audit reuses its saved response. Comparison uses monotone normalized
text matches (runs of at least three tokens, >=80% cue coverage and matched
endpoints), excludes unreliable STT endpoints rather than fixing them, and also
checks the actual rendered SRT. STT timestamps are approximate reference points,
not ground truth. This is a diagnostic only: it changes neither captions nor
source projects and adds no STT dependency to normal subtitle generation.

Optional audio-informed mode: `cli-retime --subtitle-timing audio` keeps the
voice-timing paragraph endpoints and uses 10 ms energy windows to locate pauses.
Punctuation (also inside subtitle text) can anchor to nearby 200–1500 ms pauses;
each boundary correction is capped at 600 ms. Interpolation stays local to one
take, with unchanged endpoints and fallback on crossing/non-positive/out-of-bound
results. No STT, extra model, paid request or new dependency in normal exports.
This is a cautious refinement, not word alignment. On the audited lecture the
median barely changed (407→402 ms), while boundaries >2 s fell from 5 to 2/328.
Defaults remain unchanged; the already published sample is not modified.
`make cli-subtitle-experiment ARGS='--export EXISTING_DOCUMENTARY --project PROJECT_DIR --audit SAVED_GROQ_AUDIT --output NEW_DIR'`
reproduces the diagnostic comparisons and writes separate refined ASS/SRT files.
Repeated tests on the same lecture do not establish generalization to other voices.

Local word-timing trials (no paid API, never change project text or TTS):

- `make cli-subtitle-align ARGS='--export EXISTING_DOCUMENTARY --project PROJECT_DIR --audit SAVED_GROQ_AUDIT --output NEW_DIR --model base --prepare-preview'`
  runs known-text alignment with cached Whisper Base MLX. Paragraphs reset the
  timing map; invalid/overlapping/exact-text-mismatched results are refused.
  `small` and `ctc-fr` are diagnostic alternatives, not default exports.
- `make cli-canary-setup` creates a separate `.venv-canary` (Python 3.11, `uv`),
  leaving existing TTS/ASR environments untouched. The official NeMo runtime is
  much larger than the model; the official FP32 model download is about 737 MB,
  unlike the quantized download sizes shown by third-party desktop apps.
- `make cli-canary-align ARGS='--export EXISTING_DOCUMENTARY --project PROJECT_DIR --output NEW_CANARY_DIR --seconds 900 --audit SAVED_GROQ_AUDIT'`
  tests pinned NVIDIA Canary 180M Flash French word timestamps. `--audit` is
  optional and reads only an existing response, never calls Groq. Natural French
  takes are analyzed in <=10 s windows, preferring silence for cuts. Optional
  `--context-seconds 1` adds context on each side; this did not improve complete
  coverage in the lecture trial (44 unresolved cues versus 41 without context).
  Only the central interval owns timestamps, never
  duplicated elapsed time. Only exact
  monotone word runs can place existing cue endpoints. Any unmatched cue refuses
  rendering and leaves diagnostics on disk instead of guessing or changing text.
  Canary timestamps are experimental; do not claim they outperform the other
  aligners without testing. CPU uses up to eight threads by default. MPS is an
  explicit experimental `--device mps` option: on this M4, NeMo 3.0/PyTorch 2.12
  loaded the model but the beam decoder produced invalid IDs, so use CPU.
  For the local FFmpeg-full library conflict encountered during this trial,
  prefix the analysis command with `TARJAMA_FFMPEG=/opt/homebrew/bin/ffmpeg`;
  analysis needs only WAV resampling, not subtitle filters. This changes neither
  the system installation nor the separate final-render command.

Successful trials write separate ASS/SRT and references to the same retimed
picture, voice and documentary mix. Preview with
`make cli ARGS='preview --export NEW_DIR --retimed-input --seconds 900 --credits-file ATTRIBUTION.txt'`.
Reading holds and energy-detected spoken tails may extend caption ends, never
move onsets or cross the next caption/take. Reports compare the saved first
600-second STT audit (approximate, not ground truth) and audio activity coverage;
they do not prove every word boundary is correct. No full lecture render or
automatic playback is authorized by an alignment trial.
