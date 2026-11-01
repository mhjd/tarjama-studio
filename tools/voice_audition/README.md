# À l'oreille — sélection locale de références françaises

Outil indépendant de Tarjama, sans dépendance Python externe ni modification des
projets de traduction. Il référence uniquement les fichiers `_enhanced.wav` du
dossier `kyutai/tts-voices/cml-tts/fr` : pas les WAV ordinaires ni les embeddings.
Le catalogue vérifié le21 octobre2026 contient35 extraits.

```sh
make voice-audition
```

Ouvrir http://127.0.0.1:8766. Serveur lié uniquement à127.0.0.1 : aucun accès réseau
externe à la base, pas de déploiement. Ctrl-C arrête le serveur, pas les données.
Les WAV sont lus directement depuis Hugging Face, seulement sur demande ; ils
ne sont pas tous téléchargés au lancement. La lecture nécessite donc Internet.
La découverte seule ne génère pas de TTS et n'exige aucune clé API. Aucune lecture automatique.

### Écouter les voix clonées sur la conférence

Mise à jour : « Ma sélection » est une **liste verticale classée**. Monter /
Descendre enregistre l'ordre en SQLite ; l'ordre initial conserve l'ancien
affichage alphabétique, il ne constitue pas une préférence déduite. Deux champs
de commentaire (référence / doublage) sont enregistrés en quittant le champ,
sans interrompre la lecture. Les brouillons restent affichés si l'écriture
échoue, et la fermeture de la page avec un brouillon déclenche un avertissement.
Les écritures sont sérialisées côté client ; les révisions SQLite refusent
l'écrasement d'une note ou d'un classement modifié dans un autre onglet.
Les commentaires restent conservés si une voix est retirée puis gardée à nouveau.
Une voix ajoutée ou restaurée rejoint la fin du classement. L'export JSON inclut
le rang et les deux commentaires. Aucune donnée existante n'est supprimée.

Les essais clonés sont désormais présentés comme **vidéos MP4**. La référence
originale reste un lecteur audio. Pour produire les vidéos à partir des prises
déjà terminées, sans régénérer les voix :

```sh
make voice-audition-videos
```

Le script réutilise `retime_video.py` et `preview_command` du CLI : borne source
300s prolongée jusqu'à la fin du paragraphe (317,380s), voix française inchangée
en vitesse, image et original recalés, introduction documentaire basée sur la
parole détectée (silences pris en compte), original atténué de24dB pendant le
doublage. Whisper Base MLX aligne le texte connu **prise par prise**, avec les
mêmes fonctions `aligned_rows` / `readable_ends` que les derniers essais du CLI.
Les sous-titres courts sont rendus par le moteur Go de l'app web et incrustés
dans le MP4 ; ni gros paragraphes ni sous-titres dépendant du lecteur navigateur.
Pas d'API externe ni de changement du projet de traduction.

L'environnement TTS existant sert au VAD/rendu ; l'environnement ASR au calage
Whisper sur le M4. Les deux sont utilisés sans réinstaller de modèles TTS.
Chaque dossier `video-v1/` contient le recalage, les caches d'alignement, les
sous-titres et `video-complete.json` avec empreintes et durée. Une vidéo n'est
annoncée prête qu'une fois terminée ; la diffusion Range/HEAD reste limitée aux
fichiers autorisés. La table `benchmark_videos` stocke progression et résultat.
Une reprise vérifie les vidéos terminées et les caches. Un rendu interrompu
avant `result.json` est conservé et signalé, pas écrasé automatiquement :
inspecter puis déplacer ce dossier avant relance.

La migration SQLite est additive (`favorite_rank`, `reference_note`,
`clone_note`, `note_revision`, table `selection_order`) et conserve le journal
de choix / annulations. Copie cohérente avant migration :
`backups/before-ranking-video-20261021-131520.sqlite3`. Le premier essai de rendu
interrompu pour corriger la borne source est conservé sous
`1770_1028_000036-0002_enhanced/video-interrupted-source-boundary/` ; il n'est
ni servi ni réutilisé. Les audios bruts et les références sont inchangés.

Tests de cette mise à jour :27 tests Python SQLite/HTTP et3 tests JavaScript
(ordre, sérialisation des notes, conservation des brouillons, lecteur vidéo
préservé lors des rafraîchissements). Les tests JavaScript utilisent un DOM
minimal simulé, pas un vrai navigateur. La vérification visuelle du nouveau
layout n'a pas été effectuée ; l'accès Firefox avait été refusé.

Les paragraphes ci-dessous documentent la génération audio préexistante ; les
MP4 se substituent à ses lecteurs dans l'interface, sans supprimer les AAC.

Dans « Ma sélection », chaque carte contient aussi un lecteur du benchmark
cloné, en plus de la référence enhanced originale. Le face-à-face A/B permet
de comparer les clones (par défaut) ou les références. Le suivi s'actualise
toutes les cinq secondes sans remplacer les lecteurs déjà prêts/en lecture.

```sh
make voice-audition-benchmark
```

Ce traitement utilise les environnements locaux existants `.venv-tts` et
`.venv-asr`, pas une API payante. Il prend un instantané des voix gardées puis
réutilise le générateur CLI `generate_raw` : Qwen3-TTS Base1.7B MLX4bit,
température0,3, top-p1, top-k50, pénalité effective ICL1,5, lots de quatre
paragraphes, même graine20261018 et même texte pour toutes les voix. Une seule
instance du modèle MLX reste en mémoire ; la référence audio/texte est fournie
explicitement à chaque génération. Le GPU M4 est utilisé, pas un worker par voix.

Passage : début de « Importance de la logique »,
`exports/logique-desktop-tts-plan/plan.json`, dix paragraphes complets jusqu'à
317380ms source (cible300s, prolongée pour finir la phrase). Français à vitesse
naturelle avec200ms entre paragraphes, sans vidéo, original en fond ou changement
de tempo. La durée audio varie donc selon la voix. Ce sont de nouvelles prises,
pas la réutilisation bit-identique des auditions historiques4193/4482.

Les références enhanced sont téléchargées une fois. Leur texte est transcrit
localement avec Whisper Base français, sauf pour4193/4482 où le texte déjà en
cache est repris uniquement si l'audio a exactement la même empreinte. Ces
transcriptions de référence ne sont pas vérifiées indépendamment à l'écoute.
Le contenu de la conférence reste dans les fichiers, pas dans les sorties console.

Données : `data/workspaces/voice-audition/benchmarks/logique-source300-qwen03-v1/`.
Recette/instantanés de sélection à la racine ; pour chaque voix : référence,
transcription, plan, prises brutes avec graines/empreintes, `raw/natural.wav`,
`benchmark.m4a` (AAC192k) et `complete.json`. La table SQLite `benchmarks` expose
statut, progression, durée et empreinte. Les choix et leur révision ne sont pas
modifiés par la génération. Le serveur léger n'importe aucun modèle TTS.

Une interruption laisse les prises terminées réutilisables. Relancer la même
commande reprend les caches de même recette/plan ; une empreinte ou recette
modifiée est refusée, pas écrasée. Les erreurs d'une voix sont enregistrées sans
empêcher les autres essais. Vérifier les statuts après le traitement. Un fichier
prêt est diffusé avec support HTTP Range/HEAD pour avancer/reculer ; ni les plans
ni les transcriptions ne sont accessibles par le serveur. Pas de fichier partiel
annoncé prêt, pas de déploiement/publication et aucune lecture automatique.

Validation du21 octobre2026 : dix voix terminées,100 prises vérifiées, même texte
et paramètres, empreintes des références/WAV/AAC contrôlées, dix lectures HTTP206
contrôlées sans lecture automatique. Voir `verification.json` à la racine du
benchmark. Durées naturelles258,8–348,1s ; choix inchangés (révision37,10 favoris).
19 tests de l'outil et84 tests du CLI passent. L'interface reste locale ; la
vérification visuelle dans Firefox n'a pas été autorisée.

## Utilisation

- Découvrir : un extrait à la fois ; passer/garder, flèches gauche/droite,
  glissement horizontal. Espace lance ou met en pause le lecteur.
- Chaque choix est écrit et confirmé par SQLite avant de passer à la suite.
  Une erreur ne valide pas silencieusement le choix. En cas de conflit entre
  onglets, le serveur refuse l'écrasement et recharge les données à jour.
- Annuler restaure le choix précédent ; l'historique technique est conservé.
- Ma sélection : toutes les voix gardées avec lecteurs, retrait possible,
  boutons Comparer pour le face-à-face A/B. Une seule lecture à la fois.
- Exporter télécharge la sélection en JSON (chemins et liens exacts).

## Données inspectables

SQLite : `data/workspaces/voice-audition/voices.sqlite3`.

```sh
make voice-audition-db
sqlite3 data/workspaces/voice-audition/voices.sqlite3 "SELECT path FROM voices WHERE decision='keep';"
```

Table `voices` : chemin exact, décision (`keep`, `pass` ouNULL), dates UTC.
Table `decisions` : journal append-only des choix et annulations. Rien n'est
enregistré uniquement dans le navigateur. Un rechargement, une fermeture du
navigateur ou un redémarrage du serveur préserve la sélection et la progression.
Ne pas copier seulement le fichier principal d'une base ouverte en mode WAL :
utiliser SQLite `.backup` pour une copie cohérente, ou fermer le serveur avant de
copier les données. Aucun bouton de réinitialisation destructeur.

```sh
make voice-audition-sync
make voice-audition-test
```

La synchronisation lit le catalogue paginé puis ajoute les nouvelles références
sans écraser les choix ni supprimer les anciennes. En cas d'échec réseau ou de
catalogue vide, les choix restent intacts. Après le premier chargement, le
catalogue local permet de démarrer sans joindre Hugging Face (les références
originales restent distantes). Le serveur ne sert que ses quatre fichiers
statiques et les benchmarks audio terminés, pas la base SQLite ni les plans.

Les tests HTTP nécessitent l'autorisation d'ouvrir un port loopback dans les
environnements isolés. Ils travaillent uniquement sur des bases temporaires.
Pour un essai manuel sans influencer la vraie sélection :

```sh
make voice-audition ARGS='--database /private/tmp/UN_DOSSIER_DE_TEST/voices.sqlite3 --port 8767'
```

Vérifications effectuées : tests SQLite/HTTP, syntaxe JavaScript, catalogue et
liens audio réels. La vérification visuelle/lecture dans Firefox n'a pas été
autorisée par l'environnement ; ergonomie mobile et glissement restent à
confirmer en navigateur. Aucune publication distante ou modification VPS.
