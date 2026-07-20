# Audit de securite - Kimi K3

Date : 2026-07-20  
Modele : `moonshotai/kimi-k3` via OpenRouter  
Mode : revue statique en lecture seule  
Portee : application Electron desktop, outils embarques et scripts de packaging.  

## Verdict

**ACCEPTABLE AVEC RISQUES DOCUMENTES.** Aucune ecriture, suppression ou execution hors de `app.getPath("userData")/projects` n'est demonstrable depuis un renderer compromis ou une entree utilisateur dans les sources auditees. Aucun constat ne bloque la distribution actuelle, mais les corrections faibles listees ci-dessous meritent d'etre planifiees avant une diffusion plus large.

La premiere passe a ete revisee : la CSP stricte presente dans `ui/index.html` avait ete omise du corpus initial et n'est donc pas un constat. L'updater yt-dlp est un risque supply-chain modere, non une faille directement exploitable par le renderer ou une entree utilisateur. Le TOCTOU autour de la corbeille est un durcissement de defense en profondeur faible.

Une passe Kimi avec raisonnement a ensuite confirme ce verdict et a apporte des constats supplementaires sur la preservation des donnees, les flux reseau des outils multimedia et la chaine de packaging.

## Constats

### Modere - Chaine de confiance de la mise a jour yt-dlp

- **Code** : `ui/electron/library.ts`, `expectedYtdlpChecksum()`, `downloadFile()` et `updateYtdlp()` ; `scripts/prepare_desktop_tools.py`, `prepare_ytdlp()`.
- **Scenario** : la somme SHA-256 et le binaire sont tous deux recuperes depuis la release GitHub `latest` de yt-dlp. Une compromission de cette release ou de son origine peut servir un binaire malveillant avec une somme correspondante, ensuite executee sous les droits de l'utilisateur.
- **Impact** : compromission du poste par un binaire tiers mis a jour volontairement.
- **Limites du scenario** : ni le renderer ni l'utilisateur ne controlent l'URL, la somme ou le chemin cible. La mise a jour est explicite, HTTPS est utilise et le remplacement est effectue via un fichier temporaire puis renommage. Ce n'est pas une injection dans Tarjama Studio.
- **Correction recommandee** : documenter le modele de confiance de cette mise a jour. A terme, verifier une signature amont (GPG/minisign) ou epingler une cle publique. Journaliser les anciens et nouveaux hashes serait egalement utile.

### Moyen - Provenance de ffmpeg au moment du packaging

- **Code** : `scripts/prepare_desktop_tools.py`, `prepare_ffmpeg()`.
- **Scenario** : selon la plateforme, le script peut empaqueter le `ffmpeg` trouve dans Homebrew ou dans le `PATH`. Le filtre `subtitles` est controle, mais pas l'integrite ou la provenance du binaire.
- **Impact** : une machine de build compromise pourrait produire un paquet contenant un ffmpeg trojanise.
- **Correction recommandee** : utiliser, sur toutes les plateformes, un binaire provenant d'une source determinee et controlee par hash ou signature. Le risque concerne la chaine de build, pas les utilisateurs ordinaires qui importent une video.

### Faible - Police embarquee non epinglee

- **Code** : `scripts/prepare_desktop_tools.py`, `prepare_fonts()`.
- **Constat** : la police Noto est obtenue depuis une branche distante flottante sans hash. Elle est ensuite lue par libass/FreeType pendant l'export.
- **Correction recommandee** : epingler un commit et le SHA-256 de la police, comme pour tout binaire ou ressource parse par un composant natif.

### Info - Ressources hors ASAR et signature de distribution

- Les `extraResources` tels que ffmpeg et yt-dlp ne sont pas couverts par la validation d'integrite ASAR. Les paquets Windows actuels ne sont pas signes Authenticode. Un remplacement exige deja un processus local avec les droits de l'utilisateur, mais la signature reste un durcissement de distribution pertinent.

### Faible - Requetes reseau locales par les outils tiers

- **Code** : `safeRemoteUrl()` puis `listYoutubeFormats()`/`downloadYoutube()`; `mediaStreams()` et `exportVideo()`.
- **Constat** : une URL HTTP(S) peut viser `127.0.0.1`, une IP privee ou link-local; yt-dlp la contactera. Un media local malicieux peut aussi inciter ffmpeg a suivre des protocoles externes pendant son analyse.
- **Impact** : SSRF local de faible severite et oracle via les erreurs/outils; le renderer ne recoit pas une primitive de lecture de fichier arbitraire.
- **Correction recommandee** : refuser les IP loopback/privees/link-local et les noms d'hote locaux dans `safeRemoteUrl()`. Ajouter `-protocol_whitelist file,fd` aux appels ffmpeg dont la source est un fichier local.

### Faible - Configuration utilisateur yt-dlp chargee par defaut

- **Code** : `runYtdlp()` / `runTool()`.
- **Scenario** : yt-dlp peut charger une configuration dans le repertoire utilisateur. Un autre processus deja execute sous le meme compte peut y ajouter une option telle que `--exec` avant le prochain telechargement.
- **Correction recommandee** : passer explicitement `--ignore-config` a tous les appels yt-dlp.

### Faible - Cle Groq embarquee et cle locale en clair

- **Code** : `scripts/prepare_desktop_config.py`, `ui/electron/groq.ts`, `saveGroqApiKey()`.
- **Constat** : la cle par defaut embarquee est extractible du paquet et la cle personnelle est stockee localement. C'est une decision produit explicite, pas une surprise de l'audit.
- **Risque** : consommation abusive du quota de la cle partagee ; lecture possible par un processus executant sous le meme compte utilisateur.
- **Correction recommandee** : limiter le budget de la cle embarquee cote Groq, documenter sa revocation, et envisager `safeStorage` d'Electron pour la cle personnelle si ce choix produit evolue.

### Faible - Donnees potentiellement personnelles dans les fichiers locaux

- **Code** : `ui/electron/main.ts`, `writeStartupLog()` ; `ui/electron/groq.ts`, fichiers d'audit de reponses Groq.
- **Constat** : les logs peuvent contenir des chemins locaux et les sorties de transcription peuvent contenir du texte utilisateur.
- **Impact** : exposition locale a un autre processus utilisant le meme compte ; aucun canal d'exfiltration n'a ete observe.
- **Correction recommandee** : documenter ce stockage local. Le `startup.log` est deja reinitialise a chaque demarrage, ce qui borne son volume.

### Faible - Perte d'etat possible lors du remplacement de transcription ou video

- **Code** : `ui/electron/library.ts`, `importTranscriptContent()` et `downloadYoutube()`.
- **Constat** : le remplacement d'une transcription ne cree pas systematiquement de snapshot `pre_import`. Le remplacement d'une video generee supprime l'ancien `source.*` de maniere definitive apres le nouveau telechargement ; la confirmation est actuellement rendue par le renderer, donc contournable par un renderer compromis.
- **Impact** : perte d'un etat local ou d'une copie video dans la bibliotheque, jamais hors de celle-ci. Le fichier original importe par l'utilisateur n'est pas supprime.
- **Correction recommandee** : creer un snapshot avant import et deplacer l'ancienne video vers la corbeille ou la renommer, plutot que `unlink`.

### Faible - Risque de saturation du disque de la bibliotheque

- **Code** : `validateTranscript()`, ecriture des snapshots et `downloadYoutube()`.
- **Scenario** : de nombreuses autosauvegardes/snapshots et une transcription tres volumineuse peuvent remplir `userData`; aucun controle d'espace disque n'est effectue avant telechargement ou export.
- **Correction recommandee** : limiter la taille serializee totale, conserver les N derniers snapshots plus `initial`, et verifier l'espace disponible avant les gros traitements.

### Info - Course theorique avant la mise a la corbeille

- **Code** : `ui/electron/library.ts`, `trashProject()`.
- **Constat** : `assertInsideLibrary(dir)` resout les liens avant verification, puis une boite de dialogue laisse une fenetre entre ce controle et `shell.trashItem(dir)`.
- **Scenario requis** : un autre processus local, deja actif avec les memes droits, devrait remplacer le dossier du projet par un lien symbolique pendant cette fenetre. Le comportement exact de `shell.trashItem` sur ce lien depend de l'OS.
- **Conclusion** : ce n'est pas exploitable par le renderer et ce n'est pas une correction necessaire avant distribution. Refaire `assertInsideLibrary()` et refuser un symlink via `lstat()` juste avant `trashItem()` reste un bon durcissement peu couteux.

## Controles verifies

- Les identifiants projet sont bornes par une expression reguliere stricte avant construction des chemins.
- `assertInsideLibrary()` utilise `realpath` puis `path.relative`, ce qui bloque traversal et symlinks connus au moment du controle.
- Les fichiers importes sont copies dans la bibliotheque ; ils ne sont pas deplaces ou supprimes a leur emplacement d'origine.
- La suppression des projets utilise `shell.trashItem()` apres confirmation native, pas une suppression recursive directe.
- `removeGeneratedSourceFiles()` ne cible que les entrees `source.*` dans un projet verifie.
- Le renderer est isole : `sandbox`, `contextIsolation`, `nodeIntegration: false`, permissions refusees, navigation et webviews bloquees, DevTools desactives en production et Electron fuses actives.
- Chaque IPC est limite a la fenetre principale et a sa `mainFrame`; le preload expose une API explicite via `contextBridge`.
- Le protocole `tarjama://` n'expose que les assets de l'application et les medias associes a un identifiant de projet valide ; les ranges sont valides strictement.
- ffmpeg et yt-dlp sont lances sans shell, avec un tableau d'arguments. Les URLs sont limitees a HTTP(S) sans identifiants et les selecteurs de format sont listes blanches.
- Les contenus importes et les options d'export disposent de limites de taille et de validateurs structurels.
- Une CSP stricte est deja declaree dans `ui/index.html` : sources locales, objets, frames et formulaires interdits.

## Robustesse Electron et vie privee

- `connect-src` autorise encore les ports de developpement loopback dans le build package. Les retirer de la CSP de production reduirait la surface locale sans affecter le build de developpement.
- Deux instances de l'application peuvent ecrire les memes JSON; les ecritures JSON ne sont pas atomiques. `requestSingleInstanceLock()` et l'ecriture dans un temporaire suivie de `rename()` eviteraient une corruption lors d'un crash ou d'une concurrence locale.
- Un renderer compromis peut appeler la fonction Groq legitime pour transmettre l'audio d'un projet non encore transcrit. C'est le canal d'exfiltration de contenu identifie; un consentement explicite au premier envoi cloud par projet le rendrait visible a l'utilisateur.

## Cas analyses mais non consideres comme vulnerabilites

- **Export MP4 vers un chemin choisi** : `showSaveDialog` impose un dialogue systeme avant toute ecriture hors de la bibliotheque. Un utilisateur peut volontairement ecraser son propre fichier, mais le renderer ne fournit pas le chemin cible.
- **Lecture de fichiers importes** : les chemins viennent exclusivement des dialogues systeme. Les fichiers textes sont limites puis valides, les medias doivent contenir audio et video. Il n'existe pas de primitive de lecture arbitraire controlee par IPC.

## Tests de securite a ajouter

1. Exporter et tester `assertInsideLibrary()` avec symlink, casse Windows et separateurs mixtes.
2. Tester `trashProject()` avec un dossier remplace par un symlink entre le controle et `shell.trashItem()` ; refuser le lien apres confirmation si le durcissement est implemente.
3. Tester l'updater yt-dlp avec un serveur local : echec de hash, conservation de l'ancien binaire et absence de binaire temporaire residuel.
4. Tester de bout en bout le handler `tarjama://` avec `%2e%2e`, `%5c`, `HEAD` et ranges limites.
5. Tester l'export annule et l'export interrompu pour verifier le nettoyage du temporaire.
6. Ajouter un fuzz leger des parsers Markdown/JSON avec entrees tres grandes ou fortement imbriquees.
7. Rattacher `npm audit --audit-level=high` aux cibles de release et faire echouer le build sur une vulnerabilite haute.
8. Verifier que yt-dlp est appele avec `--ignore-config`, que les URLs privees sont refusees et que ffmpeg ne peut utiliser que `file,fd` pour les medias locaux.
9. Tester les ecritures atomiques, le verrou d'instance unique et l'absence de donnees residuelles apres annulation/crash.

## Checklist avant distribution

1. Documenter la confiance accordee aux releases yt-dlp et l'action explicite de mise a jour.
2. Fixer la provenance de ffmpeg dans le pipeline de packaging avec hash ou signature sur toutes les plateformes.
3. Epingle aussi la police embarquee et refuse le fallback ffmpeg depuis le `PATH` pour les releases.
4. Ajouter `--ignore-config`, la protection SSRF et la liste de protocoles ffmpeg.
5. Ajouter snapshots pre-import, retention, ecritures atomiques et verrou d'instance unique.
6. Ajouter le recontrole anti-symlink avant `shell.trashItem()` comme defense en profondeur.
7. Ajouter les tests de confinement et de protocole manquants a `desktop-security-test`.
8. Mettre `npm audit` dans les releases Windows et Linux, avec un scan anti-secret.
9. Appliquer des limites de depense, consentement d'envoi et procedure de rotation a la cle Groq embarquee.

## Cout de l'audit

Trois appels directs OpenRouter Kimi K3 ont ete realises : une premiere passe sans sortie utile car le raisonnement interne a consomme le plafond, l'audit final et une revision ciblee. Cout total rapporte par OpenRouter pour ces appels : **0,470 $**. Une quatrieme passe directe avec raisonnement maximal a finalement produit le rapport approfondi integre ci-dessus : **0,740 $**.

Une passe supplementaire a ensuite ete lancee avec OpenCode, l'agent en lecture seule et la variante de raisonnement `max`. Elle a lu le corpus attache et a consomme **0,331 $**, mais Kimi a interrompu sa reponse avant de produire une conclusion supplementaire. Une derniere tentative avec raisonnement `high` a ete refusee par OpenRouter faute de credit. Le cout confirme de cette campagne est donc d'au moins **1,541 $**, hors les requetes de diagnostic negligeables.

## Methode et limites

Kimi a analyse le code source et les tests indiques en lecture seule ; aucun fichier du projet, aucune cle API et aucune donnee utilisateur ne lui ont ete transmis. Ce rapport ne remplace pas un test sur les executables finaux, une analyse de dependances ou une revue manuelle des binaires ffmpeg et yt-dlp. Il etablit en revanche qu'aucun chemin de suppression ou d'ecriture hors bibliotheque n'est demonstrable dans le code audite.
