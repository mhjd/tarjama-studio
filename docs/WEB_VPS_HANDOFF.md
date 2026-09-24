# Passation complète — Tarjama Studio web sur VPS

Actualisation du 23 septembre 2026 : le propriétaire choisit désormais
`gemini-3.5-flash-lite` pour correction/traduction, en remplacement de 3.8 Flash,
et accepte un premier jet à relire et corriger. Les erreurs observées et les
limites du benchmark sont documentées dans
[le rapport qualité](../web/review/translation-lite/RESULTS-20260923.md).
La cible Gemini reste 20 minutes, avec des bornes de volume adaptées ; les chunks
Groq demeurent distincts. Le suivi des sous-titres reste activé pendant un
scroll manuel, sauf désactivation explicite, et son état est visible. Ces
décisions récentes priment sur les paragraphes historiques correspondants.
Les autorisations de mise en service et de tests réels ont été données séparément
dans la session ; elles ne constituent pas une autorisation générale pour un
nouvel intervenant de déployer sans vérifier son périmètre.

Complément du 23 septembre : la comparaison indépendante DeepSeek/Flash-Lite
via OpenRouter est documentée dans
[le rapport comparatif](../web/review/model-comparison/RESULTS-20260923.md).
Elle n'ajoute aucun fournisseur au produit et n'utilise aucune recherche web.
Le propriétaire demande ensuite de rétablir les mêmes consignes de traduction
que le desktop. Le prompt web est désormais généré depuis `prompts/translation.md`
avec adaptation JSON uniquement ; voir
[la parité des prompts](../web/docs/TRANSLATION_PROMPT_PARITY.md).
**Candidat non activé** : deux essais Gemini avec outils de recherche ont reçu
429. Ne pas annoncer la recherche ou Hamidullah vérifiés dans l'application
active, qui conserve son image antérieure. Finaliser la qualification réelle et
l'affichage des références/Search Suggestions avant cette mise en service.

Complément UI du 23 septembre : lecteur mobile inférieur agrandissable, titre
multiligne, étapes centrées, actions suivantes explicites, suivi séparé et
raccourcis ±5 s hors saisie. Le nouvel export proposé est français uniquement ;
les fichiers historiques sont conservés. Voir
[le rapport visuel](../web/review/ui-mobile-20260923/RESULTS.md).
La recette active est `web/deploy/preview/active-mobile-20260923.yml` ; cette
livraison frontend conserve le binaire backend qualifié b69c700 et n'active pas
le candidat de recherche. Ces décisions récentes priment sur l'ancien sélecteur
arabe/français et l'ancien emplacement du lecteur.

Complément desktop après revue des captures : français sous l’arabe à toutes les
tailles, commandes du lecteur desktop agrandies/centrées, étape suivante en haut
et en bas, URL YouTube sous le titre et copiable. La correction après export est
qualifiée sur fixture jusqu’à un nouveau MP4. Dernière recette active :
`web/deploy/preview/active-desktop-20260923.yml` ;
[rapport](../web/review/ui-desktop-20260923/RESULTS.md).

Décision suivante sur la validation : le propriétaire remplace l’action principale
du haut par le lien discret « Aller à la validation ». Celui-ci descend et place
le focus sur la validation sans lancer l’étape. Sur ordinateur, Espace alterne
lecture/pause hors saisie, en préservant l’activation native des boutons. Les seuls boutons de confirmation
restent en bas : « Valider et traduire » / « Valider et exporter » (ou relire une
traduction déjà courante). Cette décision remplace les deux boutons précédents. Recette active :
`web/deploy/preview/active-validation-20260923.yml` ;
[rapport](../web/review/ui-validation-20260923/RESULTS.md).

Date : 21 septembre 2026. Destinataire : un nouvel agent Codex travaillant sur le VPS de l'utilisateur, dans le même dépôt, sans accès à la conversation précédente.

Complément de décision après la passation initiale : l'utilisateur indique que l'IP de son serveur est bloquée par YouTube, mais qu'il a réussi avec Cloudflare WARP + yt-dlp. Il approuve une sortie WARP réservée aux téléchargements vidéo. L'import de fichier est désormais un choix de premier niveau à la création d'un projet, et doit aussi être proposé lorsqu'un téléchargement échoue. Ces décisions sont intégrées ci-dessous ; elles ne décrivent pas une implémentation déjà livrée.

**Lire ce document entièrement, puis inspecter les modules desktop indiqués avant toute implémentation.** Le code présent est une application desktop opérationnelle. La version web décrite ici reste à construire. Cette passation ne prétend pas qu'un backend Go, une authentification ou une file distribuée existent déjà.

## 0. Périmètre de la mission : réaliser et tester, s'arrêter avant le déploiement

**L'utilisateur demande explicitement que l'agent s'arrête avant tout déploiement.** Réaliser l'application complète décrite ici, ses tests et builds, préparer les fichiers/configurations/scripts nécessaires à son exploitation, puis livrer un état prêt pour la prochaine intervention. L'utilisateur donnera séparément les instructions de mise en service.

- Autorisé dans cette mission : développement sur `web-vps`, inventaire en lecture seule du VPS, tests dans un environnement de développement isolé et limité à loopback, données de test, services temporaires dédiés aux tests, préparation des images et des commandes de déploiement sans leur activation.
- Ne pas publier l'application ni activer une installation de préproduction/production, même derrière un accès privé. Ne pas modifier le proxy en service, les DNS, les certificats de service, les règles du pare-feu, la configuration SSO existante ou le routage global du VPS pour la mettre à disposition.
- Ne pas migrer de données utilisateur dans une installation vivante ; tester l'import sur des fixtures ou une copie autorisée dans l'environnement de test.
- Les sections architecture, sécurité et exploitation décrivent ce que le code et la configuration doivent permettre. Elles n'autorisent pas leur mise en service dans cette mission. Une future cible Make de déploiement peut être préparée mais ne doit pas être exécutée ; une cible de test/développement doit rester clairement distincte.
- En fin de travail, fournir le commit testé, les fonctionnalités terminées, les vérifications réellement exécutées, les prérequis externes manquants et les commandes préparées. Distinguer sans ambiguïté application implémentée, intégrations simulées et validation réelle encore nécessaire.

Le domaine, l'identité réelle, les clés runtime, les ressources du VPS et les vidéos tutorielles restent à préciser lorsqu'ils sont nécessaires. Ils ne doivent pas empêcher d'implémenter et de tester le reste, ni être inventés pour annoncer un résultat complet.

## 1. Instruction centrale : partir du desktop, ignorer l'ancien web

L'utilisateur demande expressément de prendre comme référence la version desktop la plus avancée. Il faut **ignorer comme base de développement** l'ancienne version séparant FastAPI et frontend web : elle est totalement dépassée.

Attention : les deux générations cohabitent dans le dépôt, parfois dans le même fichier.

- **Référence fonctionnelle actuelle :** `DesktopApp` dans `ui/src/main.tsx`, `ui/electron/library.ts`, `ui/electron/groq.ts`, les autres modules `ui/electron/`, et les prompts actuels.
- **Ancienne version à ne pas ressusciter :** `server/main.py`, `scripts/serve_mvp.py`, l'ancien composant `App` dans `ui/src/main.tsx`, l'adaptateur qui appelle `/api/videos`, et le pipeline CLI comme architecture de la future app web.
- La présence de FastAPI dans `AGENTS.md`, `PROJECT.md`, les requirements et les commandes `make dev-api` / `make dev-ui` ne signifie pas qu'il faut repartir de cette architecture. Des avertissements ont été ajoutés aux documents d'entrée pour lever cette ambiguïté.
- En l'état, ouvrir l'interface existante sans `window.tarjamaDesktop` charge l'ancien `App`. Cela **ne constitue pas** une version navigateur du desktop actuel.
- L'objectif n'est pas de porter chaque bouton du desktop : reprendre ses acquis métier, puis construire le parcours simplifié décrit ci-dessous.
- Conserver le desktop utilisable sur sa branche ; ne pas supprimer son code ou ses données pour commencer la migration.

## 2. Dépôt, commit de départ et branches

Dépôt : `git@github.com:mhjd/tarjama-studio.git` (URL web : https://github.com/mhjd/tarjama-studio).

État vérifié après `git fetch origin` avant la rédaction :

| Référence | Commit complet | Signification |
| --- | --- | --- |
| `desktop`, `origin/desktop` | `9b3cc9fb1584ea195cfd2b8065a688a2bfca0cb7` | Dernier état desktop avant cette passation |
| `main`, `origin/main` | `a247734f06f5f3397a08845662883f5511efe0fe` | Merge desktop ; même arbre de fichiers au moment de l'inspection |
| Dernière release desktop | `bf2c3c8`, version `0.1.30` | Version dans `ui/package.json` |

`main` contient deux commits supplémentaires dans son histoire à ce moment-là, mais `git diff origin/main origin/desktop` ne montre aucune différence de contenu. Ne pas confondre le nombre de commits et le niveau d'avancement fonctionnel.

La livraison de cette passation doit ajouter un commit sur `desktop`, incluant les documents et le skill desktop déjà développé, puis publier **`web-vps` au même commit**. Ce commit de livraison devient le départ précis de la migration. L'agent auteur vérifie les deux références distantes après le push et donne le SHA dans son message final ; ce SHA n'est pas écrit récursivement dans le commit qui le contient.

Sur le VPS, avec un clone existant :

```sh
git status --short --branch
git fetch origin
git log -5 --oneline origin/web-vps
git merge-base --is-ancestor 9b3cc9fb1584ea195cfd2b8065a688a2bfca0cb7 origin/web-vps
git show origin/web-vps:docs/WEB_VPS_HANDOFF.md
```

Si l'arbre de travail est propre et qu'aucune branche locale `web-vps` n'existe :

```sh
git switch --track -c web-vps origin/web-vps
```

Si elle existe déjà, la sélectionner, inspecter ses commits, puis avancer avec `git merge --ff-only origin/web-vps` lorsque c'est possible. Ne jamais la réinitialiser pour suivre ces instructions. En présence de travaux locaux, les préserver ; utiliser un worktree dédié si utile. Si `origin/web-vps` manque, vérifier la publication avant de choisir un autre point de départ.

Pour identifier ultérieurement le commit de passation dans l'historique :

```sh
git log --diff-filter=A --format='%H %s' origin/web-vps -- docs/WEB_VPS_HANDOFF.md
```

Pour un nouveau clone dédié au web, les gros exécutables desktop ne sont pas nécessaires :

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone --branch web-vps git@github.com:mhjd/tarjama-studio.git tarjama-studio-web
```

Les `.exe` et AppImage historiques sont suivis par Git LFS. Ne pas reconstruire ni publier une release desktop pour démarrer le web. Ne pas appeler `make desktop-release`, qui incrémente la version et remplace des artefacts.

Règle de branches : `desktop` reste la branche de maintenance desktop ; **le nouveau travail se fait sur `web-vps`**. Aucun merge vers `main`, force-push ou changement de branche par défaut n'est nécessaire pour cette mission.

## 3. Pourquoi ce nouveau produit

Tarjama aide à transformer une vidéo arabe en transcription corrigée puis traduction française sous-titrée. Les utilisateurs et correcteurs ont trouvé l'application trop difficile : trop de réglages, copier-coller de prompts, sauvegardes difficiles à comprendre, lecteur trop complexe. L'application installée seulement chez le propriétaire impose également des corrections manuelles à partir de retours reçus ailleurs.

La cible est maintenant une petite application web, accessible sans installation sur smartphone et ordinateur. Chacun crée son compte et possède un espace privé. Un lien vidéo doit suffire pour commencer. Les appels IA sont automatiques. Le parcours guide jusqu'à l'export en demandant le minimum de décisions.

Le propriétaire possède déjà un VPS. Sa configuration, ses services existants, son domaine et son éventuel fournisseur SSO **n'ont pas été communiqués**. Une tentative de début d'implémentation locale a été arrêtée par l'utilisateur avant toute modification de code web. Il souhaite que l'agent VPS réalise le travail à partir de cette passation.

## 4. Décisions produit finales et idées abandonnées

Cette section fixe l'état final de la discussion. Ne pas réimplémenter une proposition antérieure au motif qu'elle apparaît ailleurs dans le dépôt ou dans un ancien message.

| Sujet | Décision finale |
| --- | --- |
| Application | Web, utilisable sur smartphone, sans téléchargement d'application |
| Comptes | Un compte et un espace privé par utilisateur ; SSO envisagé, fournisseur à déterminer |
| Backend | Préférence explicite pour Go ; ne pas réutiliser l'ancien FastAPI comme base |
| Déploiement | Docker Compose sur VPS recommandé ; Kubernetes n'est pas requis |
| Transcription audio | Groq, clé du propriétaire partagée par défaut, puis attente ou clé Groq personnelle |
| Correction arabe et traduction | Gemini 3.8 Flash, même modèle avec clé Google AI Studio partagée ou personnelle |
| Saturation du fournisseur | File d'attente persistante, reprise automatique ; clé personnelle facultative pour utiliser une autre capacité |
| OpenRouter | **Retiré du nouveau produit** |
| DeepSeek | **Retiré du nouveau produit** |
| Crédit d'un million de tokens | **Retiré ; aucun compteur, renouvellement ou mécanisme de crédit à construire** |
| Quota local Groq par utilisateur | Pas de quota de consommation applicatif ; l'ordonnancement équitable et les protections de ressources restent nécessaires |
| Prompts | Internes, fixes et versionnés côté serveur ; aucune personnalisation utilisateur et aucun copier-coller |
| Thème | Sombre uniquement |
| Lecteur | Lecture/pause, sauts arrière/avant de 5 ou 10 secondes ; pas de panneau avancé |
| Suivi des sous-titres | Synchronisé à l'audio avec défilement automatique par défaut |
| Correction arabe | Un champ arabe par segment, pas de traduction à cette étape |
| Relecture traduction | Arabe et français visibles après la correction arabe |
| Sauvegarde | Sur perte de focus si le texte a changé ; flush explicite avant étape suivante/export |
| Sauvegarde manuelle | Supprimée |
| Historique utilisateur/snapshots web | Supprimés, y compris restauration et comparaison de versions |
| Téléchargement vidéo | Bonne qualité automatiquement, sans choix de format/qualité utilisateur |
| Source du projet | Deux choix dès la création : coller un lien ou importer une vidéo depuis son appareil |
| Échec du téléchargement | Proposer l'import de fichier dans le même projet, sans imposer une nouvelle création |
| Sortie réseau vidéo | yt-dlp via Cloudflare WARP, réservé au composant de téléchargement ; reste du VPS sur sa connexion habituelle |
| Export vidéo | Deux qualités seulement : Low pour WhatsApp, High pour YouTube |
| Style sous-titres | Gros, blancs sur fond noir ; pas de sélecteurs de police/taille/style |
| Tutoriels de clés | Vidéos hébergées par l'application pour Google AI Studio et Groq |

Le backend Go, PostgreSQL, Compose, les détails d'OIDC et certains choix techniques ci-dessous sont la trajectoire recommandée, pas un inventaire de code déjà écrit. Adapter les détails au VPS sans remettre en cause les choix produit.

### Ne pas confondre attente et erreur permanente

L'utilisateur accepte d'attendre. Ne pas l'obliger à fournir une clé parce que la capacité partagée est momentanément épuisée. Une clé invalide, un modèle inaccessible ou une configuration serveur absente ne se résolvent pas par une attente infinie : les traiter explicitement.

### Ce qui reste volontairement ouvert

- Fournisseur SSO, domaine, reverse proxy et configuration réelle du VPS.
- Délai de saut exact du lecteur : 5 secondes proposé comme défaut simple, sans proposer un réglage de plus.
- Résolutions/encodages exacts derrière Low et High ; 480p/720p pour Low, jusqu'à 1080p pour High sont des hypothèses à tester, pas une décision finale.
- Types d'exports complémentaires : commencer par les vidéos sous-titrées arabe ou français existantes ; SRT/VTT/texte sont des propositions, pas un mandat de catalogue étendu.
- Invitation d'un correcteur à un projet : utile au besoin initial, proposée mais pas explicitement définie. Espace privé par utilisateur d'abord ; pas de partage public par défaut.
- Durées et tailles maximales, durée de conservation des vidéos et exports, capacité de stockage, périmètre des sources vidéo acceptées.
- Disponibilité des deux vidéos tutorielles : aucun fichier n'a été remis. Préparer leur emplacement et un guide texte de secours ; ne pas présenter un placeholder comme une vidéo livrée.

## 5. Cartographie du desktop à inspecter

Les symboles sont plus fiables que les numéros de ligne, qui bougeront pendant la migration.

| Fichier/symbole | Ce qu'il faut comprendre ou réutiliser |
| --- | --- |
| `ui/src/main.tsx` / `DesktopApp` | Parcours actuel, sélection des projets, édition, fusion visuelle arabe/traduction, confirmations de relecture, suivi de progression |
| `ui/src/main.tsx` / `Root` | Sélection entre `DesktopApp` et l'ancien `App` ; piège majeur pour le port web |
| `ui/src/main.tsx` / `App`, adaptateur `/api/videos` | **Ancienne application : ne pas en faire la nouvelle base** |
| `ui/src/desktop-ux.tsx` | Composants d'interaction réutilisables si compatibles avec la simplification |
| `ui/src/styles.css` | Base visuelle et arabe ; contient aussi de l'historique, ne pas reprendre tous les contrôles |
| `ui/src/desktop.d.ts` et `ui/electron/preload.cts` | Frontière IPC actuelle ; inventaire des capacités desktop à convertir en opérations serveur |
| `ui/electron/types.ts` | Projets, segments, traduction, progression, états de relecture, exports |
| `ui/electron/library.ts` | Bibliothèque, validations, téléchargements, import/nettoyage, rendu des prompts, confirmations, export ASS/FFmpeg |
| `ui/electron/editor-logic.ts` | Ordre des étapes, validation de segments, comparaison temporelle, suppression des marqueurs de citation techniques |
| `ui/electron/groq.ts` | Transcription arabe réelle, découpage audio, limites de taille, chevauchement et remise en timestamps absolus |
| `ui/electron/export-options.ts` | Dimensions sans agrandissement artificiel, tailles relatives, regroupement de sous-titres, audio AAC compatible |
| `ui/electron/security.ts` | Validation des identifiants, chemins et HTTP Range ; protections locales à renforcer pour Internet |
| `ui/electron/tool-download.ts` | Reprises limitées des téléchargements d'outils ; patterns utiles, pas une file de jobs |
| `ui/electron/main.ts` | Validation des expéditeurs IPC, protocole média local, migration des anciens noms de bibliothèque |
| `prompts/transcript_cleanup.md`, `prompts/translation.md` | Règles linguistiques actuelles ; distinguer règles métier et format Markdown ancien |
| `ui/tests/*.test.mjs` | Tests de non-régression desktop et exemples d'invariants à reporter côté Go |
| `test-fixtures/windows/` | Exemples d'import arabe/traduction ; ce ne sont pas les données privées courantes de l'utilisateur |
| `docs/SECURITY_AUDIT.md` | Audit desktop avec limites connues ; **pas un audit du futur serveur web** |
| `desktop-releases/README.md` | Workflow de distribution desktop historique, sans rapport avec le déploiement web |
| `codex-skills/correct-tarjama-project/` | Outil local de correction desktop sauvegardé dans cette livraison ; aucune utilisation sur la base web |

Ne pas convertir mécaniquement chaque méthode IPC en endpoint public. Certains appels desktop ouvrent des dossiers, une boîte de dialogue native, la corbeille ou le presse-papiers ; ils n'ont pas d'équivalent serveur exposable tel quel.

## 6. Acquis fonctionnels à préserver

### 6.1 Timestamps et identifiants

Les régressions historiques concernent des durées supérieures à une heure. `1:00:01.120` et `01:00:01.120` représentent la même valeur. `60:01.120` ne doit pas être accepté comme équivalent d'une heure, et `00:60:01.120` est invalide.

Le parseur actuel `parseMarkdownTimecode` compare des valeurs temporelles, pas les seules chaînes. Les formats existants ont un minimum de souplesse ; ne pas durcir arbitrairement un import qui fonctionne. Les composantes minutes/secondes restent strictement inférieures à 60. Pour le nouveau stockage, préférer des millisecondes entières ; convertir une seule fois les secondes flottantes du desktop à l'import et vérifier l'alignement à la milliseconde.

Les identifiants de segments doivent rester stables après génération/import. Le modèle corrige ou traduit les textes associés à ces identifiants. Le serveur conserve les horodatages : pas de nouvel horaire proposé par le LLM, pas de remise à zéro par morceau, pas de concaténation fondée sur l'ordre seul si des IDs manquent.

### 6.2 Groq actuel

Le desktop utilise `whisper-large-v3`, langue `ar`, `verbose_json`, timestamps de mots et de segments. Il prépare du FLAC mono 16 kHz. La cible de découpage actuelle est 10 minutes, avec chevauchement de 20 secondes et une marge de 23 MiB par fichier. Si nécessaire il réduit le morceau. Ce découpage ASR est **distinct** des 20 minutes demandées pour la traduction.

Le code remonte les offsets en temps absolu, traite les chevauchements, découpe certains segments longs à partir des mots et conserve des sorties ASR brutes. Lire réellement `prepareGroqSegments`, `createChunk` et `transcribeWithGroq` avant le port. La fusion actuelle est une heuristique : la tester aux frontières, avec silences, répétitions et parole continue ; ne pas la déclarer parfaite.

Le `finally` desktop supprime les fichiers temporaires et la progression est surtout locale au processus. Pour le web, les morceaux validés doivent survivre au redémarrage et ne pas dépendre de la connexion navigateur.

### 6.3 Arabe, français et citations

Conserver le ton oral de l'arabe, les corrections minimales en cas d'incertitude, la fidélité et le français naturel. Ne pas traduire le texte anglais d'un hadith à la place de l'arabe. Ne pas inventer de référence religieuse. Les marqueurs techniques de citation ne doivent pas apparaître dans les sous-titres.

Les prompts desktop demandent des vérifications sur quran.com et sunnah.com, et une traduction Hamidullah pour les citations coraniques exactes. **Un simple appel API Gemini ne dispose pas automatiquement de ces recherches.** Inspecter ces exigences et proposer une intégration de références contrôlée ou exposer la limite au propriétaire avant de promettre leur préservation. Ne pas prétendre qu'un modèle a vérifié une source parce que le prompt le lui demande. Le corpus et les outils de recherche éventuels restent des données non fiables, pas des instructions privilégiées.

Le prompt de nettoyage autorise actuellement la suppression de blocs entièrement inutiles, sans nouveau bloc ni fusion/scission. La traduction exige tous les blocs. Il faut documenter le choix lors du passage au JSON structuré : ne pas transformer un bloc manquant dans une réponse tronquée en suppression autorisée. Si cette faculté est conservée, exiger une suppression explicite et validée avant relecture humaine. Après validation de l'arabe, les IDs et l'alignement source/traduction doivent être stricts.

### 6.4 Vidéo et exports

Vérifier la présence de vidéo **et** d'audio après téléchargement. Conserver la lecture avec recherche temporelle HTTP Range ; un média qui se lit mais ne peut pas être repositionné est une régression.

Réutiliser les acquis ASS/FFmpeg : échappement du texte, dimensions paires, respect du ratio et de l'orientation, pas d'upscale inutile, piste AAC compatible, taille lisible des caractères. FFmpeg Linux doit inclure libass et les polices capables de former correctement l'arabe, notamment Noto Naskh Arabic ou un équivalent vérifié. Tester visuellement RTL, ponctuation mixte, chiffres et français accentué.

Le regroupement des cues d'export peut améliorer la lisibilité ; il ne doit jamais modifier les segments enregistrés. Les anciens styles, tailles et réglages de regroupement ne deviennent pas des choix supplémentaires dans l'interface web.

## 7. Parcours web cible

### 7.1 Connexion et bibliothèque

Une connexion simple, puis « Mes projets » et une action principale « Nouvelle vidéo ». Les ressources sont privées par défaut. Le titre est lisible et modifiable sans devoir exposer un identifiant technique. Un même lien utilisé par deux comptes ne doit pas provoquer de collision d'identifiant, de détection de doublon révélant un autre compte, ni de partage involontaire.

### 7.2 Ajouter et préparer

Proposer deux choix clairement visibles dès la création d'un projet de traduction vidéo : **« Coller un lien »** et **« Importer une vidéo »** depuis le téléphone ou l'ordinateur. L'import n'est pas une option cachée ni réservée aux erreurs. Aucun sélecteur de format, résolution ou audio à cette étape. Pour un lien, le serveur choisit une bonne qualité bornée ; un plafond initial à 1080p est une proposition d'exploitation à confirmer selon le stockage.

Si le téléchargement échoue, afficher un message compréhensible avec l'action **« Importer la vidéo depuis mon appareil »** dans le même projet. Conserver le titre et le contexte ; ne pas obliger à recréer un projet, installer yt-dlp ou configurer WARP. L'utilisateur peut choisir l'import sans attendre des réessais indéfinis. Les deux modes d'entrée convergent vers la même validation audio/vidéo et le même traitement.

Lors du passage d'un téléchargement échoué/en attente à un upload, invalider ou annuler le job précédent : une réponse tardive du téléchargement ne doit pas remplacer le fichier importé ni déclencher deux transcriptions. Un upload interrompu reste réessayable et n'est jamais annoncé comme prêt avant validation complète.

Après téléchargement ou upload validé, l'application enchaîne extraction audio, transcription Groq et nettoyage Gemini. Afficher des étapes compréhensibles et l'état d'attente ; ne pas demander de prompt ni d'import de réponse. Le traitement serveur survit à la fermeture du navigateur ; ne pas promettre qu'un upload depuis le téléphone continue après fermeture de sa page. Éviter une progression inventée à 99 % pendant une limite journalière.

### 7.3 Corriger l'arabe

Afficher uniquement l'arabe éditable par segment. Petit lecteur fixe ou facilement accessible : lecture/pause, saut arrière/avant, progression simple. Retirer boucles, bornes d'intervalle, modes avancés, palette de vitesses et contrôles structurels non demandés.

Le segment courant est suivi automatiquement. Suspendre le déplacement automatique pendant qu'un champ est édité ou que l'utilisateur défile manuellement ; prévoir un retour discret au passage en cours. Le clavier mobile ne doit pas masquer le champ ni provoquer un saut permanent de page.

Action principale : « Terminer la correction arabe » / « Traduire ». Elle enregistre les dernières modifications, confirme la version relue et lance une seule traduction persistante.

### 7.4 Traduire puis relire

La traduction traite les segments par morceaux d'environ 20 minutes au maximum, sauvegardés progressivement. Deux champs peuvent alors apparaître : arabe et français. Sur mobile, les empiler ; ne pas forcer deux colonnes trop étroites.

Une modification arabe après traduction doit invalider la confirmation concernée et marquer la traduction comme à revoir. Ne pas effacer sans avertissement une traduction retouchée par l'utilisateur. Pour le MVP, on peut geler la version source pendant un job et détecter le conflit au moment de publier son résultat.

### 7.5 Export

Les options apparaissent à la fin uniquement. Choisir la piste pertinente (arabe/français) et la qualité Low/High. Sous-titres gros, blancs, fond noir. Les paramètres techniques sont des constantes administrables côté serveur, pas des menus utilisateur.

Low signifie « fichier plus léger, adapté au partage WhatsApp », pas une promesse de compatibilité avec toutes les limites de taille de la plateforme. High signifie « qualité adaptée à YouTube », sans agrandir artificiellement une mauvaise source. Préserver le portrait pour les vidéos verticales.

L'export tourne en tâche de fond et produit un lien privé vérifié côté serveur. Un utilisateur ne doit pas pouvoir récupérer l'export d'un autre en changeant une URL.

## 8. Enregistrement : contrat précis

La suppression de l'historique est une demande explicite. **Ne pas recréer** de bouton « Sauvegarder », de timeline, de commit de projet, de snapshot consultable, de fenêtre « Reprendre / Dernière sauvegarde », ni de restauration dans le produit web.

En revanche, aucun motif ne justifie de perdre le texte à cause d'une course réseau.

1. À l'ouverture d'un champ, conserver sa valeur serveur connue et sa version technique.
2. L'édition modifie un brouillon local. À la perte de focus, envoyer une mise à jour si et seulement si la valeur diffère de la dernière valeur confirmée.
3. Sérialiser les sauvegardes d'un même segment/champ ou utiliser un contrôle de version atomique. Une réponse lente ne doit pas remettre en place une ancienne saisie.
4. Montrer discrètement « Enregistrement… », « Enregistré » ou « Échec — réessayer ». Ne jamais annoncer « enregistré » avant confirmation serveur.
5. **Étape suivante, navigation interne qui abandonne l'éditeur, et export appellent explicitement `flushPendingEdits` et attendent sa réussite.** Ne pas dépendre du seul événement blur, de l'ordre des événements React ou d'un `setState` fraîchement lancé.
6. Si blur et clic déclenchent la même sauvegarde, dédupliquer. En cas d'échec, rester à l'étape actuelle et conserver la saisie.
7. Capturer le texte réellement affiché, y compris après composition clavier arabe/IME. Tester le clic sur mobile sans perte des derniers caractères.
8. Un brouillon local de secours pour l'état courant peut être conservé pour une coupure réseau. Il doit être isolé par compte/projet et purgé correctement à la déconnexion ; ce n'est pas un historique de révisions.
9. Ne pas prétendre que `beforeunload` ou `sendBeacon` garantit un dernier enregistrement sur un smartphone tué brutalement. Le contrat principal reste blur/flush confirmé.
10. Deux onglets ou deux écritures concurrentes utilisent une version attendue (conflit explicite) plutôt qu'un écrasement silencieux. Une version numérique de concurrence n'est pas un historique utilisateur.

La confirmation d'étape doit vérifier côté serveur la version attendue puis enregistrer le statut et l'éventuel job dans la même transaction. L'export capture une version cohérente de ses entrées ; une correction ultérieure ne doit pas changer le rendu en plein calcul.

Les sauvegardes d'exploitation de PostgreSQL et des médias restent recommandées pour une panne serveur. Ne pas les confondre avec l'historique utilisateur supprimé. Ne pas supprimer les anciens snapshots desktop pendant la migration.

## 9. Fournisseurs, clés et attente

### 9.1 Politique finale

Pour Gemini comme pour Groq : une clé propriétaire est utilisée par défaut côté serveur. L'utilisateur peut fournir sa propre clé du même fournisseur. On utilise alors cette clé pour ses prochains morceaux/jobs, sans changer de modèle. Si elle est limitée, ses jobs attendent aussi.

Ne pas basculer silencieusement d'une clé personnelle invalide vers la clé partagée. Ne pas utiliser la clé d'un utilisateur pour servir les autres. La suppression de la clé personnelle rétablit la politique partagée pour les prochains appels. Définir explicitement le sort d'un appel déjà parti lors d'un changement de clé, sans lancer un doublon.

**Aucun OpenRouter, aucun DeepSeek, aucun crédit gratuit, aucun compteur du million de tokens, aucune facturation interne demandée.** Ne pas réintroduire un fallback de modèle. Le suivi technique des appels pour diagnostiquer l'usage ne doit pas devenir un quota produit.

### 9.2 Limites et messages

Une réponse de limitation temporaire met le job en attente durable. Honorer les délais de reprise fournis et utiliser un backoff borné avec jitter en leur absence. Distinguer limites courtes, journalières, surcharge fournisseur et erreurs permanentes. Afficher une heure de reprise seulement quand elle est connue ou clairement présentée comme estimation.

Exemple partagé :

> Le service est temporairement à sa limite. Votre traitement reprendra automatiquement. Vous pouvez quitter cette page ou ajouter votre clé personnelle pour utiliser votre propre capacité.

Exemple clé personnelle :

> Votre compte Google/Groq a atteint sa limite temporaire. Votre progression est conservée. Le traitement reprendra dès que possible.

Clé incorrecte : expliquer qu'elle doit être remplacée, pas demander d'attendre. Erreur de clé partagée : notifier l'exploitation, donner un message utilisateur honnête et éviter une boucle d'appels. Les vidéos tutorielles restent hébergées par l'application avec un guide texte accessible et une indication de la date de vérification.

La connexion SSO Google ne crée pas de clé AI Studio et ne donne pas accès automatiquement au quota d'API de l'utilisateur.

### 9.3 Vérification des fournisseurs avant implémentation

Le modèle souhaité est `gemini-3.8-flash`. Sa documentation officielle a été consultée lors de la passation ; l'agent VPS doit vérifier l'identifiant disponible, le palier et les capacités du compte réel, ainsi que le support des sorties structurées choisi. Ne pas remplacer silencieusement le modèle s'il n'est pas accessible. [Documentation du modèle](https://ai.google.dev/gemini-api/docs/latest-model)

Google applique ses limites par projet, pas simplement par clé. Deux clés d'un même projet ne multiplient pas la capacité. Groq les applique au niveau de l'organisation, avec notamment des plafonds audio horaires et journaliers. Les valeurs exactes du compte doivent être obtenues auprès du fournisseur plutôt que copiées définitivement dans le code. [Limites Gemini](https://ai.google.dev/gemini-api/docs/rate-limits), [limites Groq](https://console.groq.com/docs/rate-limits)

Ne pas promettre que « gratuit » signifie usage illimité ou absence de facturation si le compte propriétaire est configuré sur un palier payant. Vérifier ce point avec le propriétaire avant ouverture publique. Les paramètres de plafond d'exploitation globaux protègent son compte sans introduire le crédit utilisateur abandonné.

### 9.4 Secrets

- Clés partagées injectées au runtime, jamais dans les bundles React, les images publiques, les fixtures, les logs, les sorties de commande ou le dépôt.
- Clés personnelles chiffrées avec authentification côté serveur ; clé de chiffrement indépendante du stockage de la base et protégée dans les sauvegardes.
- API de gestion write-only : renvoyer uniquement fournisseur, état configuré et éventuel suffixe masqué. Suppression et remplacement possibles.
- Ne pas mettre la valeur d'une clé dans un job JSON, une URL, un argument de processus externe ou une métrique. Référencer un enregistrement de credential et le résoudre au moment de l'appel.
- Le desktop utilise `scripts/prepare_desktop_config.py` et `generated_defaults.ts` pour embarquer une clé Groq. **Ne jamais porter ce mécanisme vers le web.** Les anciennes releases ayant pu embarquer une clé, demander au propriétaire d'utiliser une clé serveur dédiée et de révoquer l'ancienne si nécessaire ; ne pas extraire une clé d'un binaire.

## 10. Architecture recommandée pour une petite installation

Garder un monolithe Go compréhensible et quelques processus spécialisés, plutôt qu'une architecture distribuée lourde. React/TypeScript reste une base réutilisable. PostgreSQL porte les comptes, projets, segments, états et jobs. Une file PostgreSQL suffit au départ ; Redis/Kafka ne sont pas des prérequis.

Organisation indicative, à créer sur `web-vps` et à ajuster sans copier le vieux serveur :

```text
web/
  backend/       # module Go, API, accès DB, migrations, clients Gemini/Groq, ordonnanceur
  frontend/      # UI React mobile simplifiée, issue des acquis de DesktopApp
  deploy/        # Compose, images, configuration exemple et intégration au proxy du VPS
  docs/          # exploitation, sécurité, import desktop, décisions et état d'avancement
```

Séparer physiquement le nouveau frontend permet d'éviter de charger par erreur l'ancien `App`. Réutiliser/extraitre les fonctions pures utiles avec des dépendances explicites, sans faire importer `electron` à un bundle navigateur. L'agent peut choisir une autre disposition aussi claire, mais ne doit pas utiliser `server/` comme point de départ silencieux.

Services recommandés :

- Reverse proxy HTTPS : réutiliser celui du VPS s'il existe. API et UI sous une même origine lorsque possible.
- API Go : sessions, autorisations, validation, sauvegardes, soumission des tâches et accès privé aux médias.
- Ordonnanceur/worker de confiance : jobs persistants, appels fournisseurs, publication des résultats. Peut partager le module Go et des composants avec l'API.
- Traitement média isolé : yt-dlp, FFmpeg/ffprobe, données du job courant. Pas de secrets Gemini/Groq ni d'accès libre à la base.
- PostgreSQL : réseau interne, rôle applicatif non superuser, migrations et backups documentés.
- Stockage médias : volume privé borné sur le VPS pour commencer si la capacité convient ; stockage objet possible ensuite, pas une obligation initiale.

Le worker média ne doit pas être simplement un conteneur ayant accès à tous les fichiers de tous les comptes. Prévoir un espace de travail borné au job et un canal de transfert contrôlé par le processus de confiance. Ne pas exposer le socket Docker à l'API pour créer des conteneurs arbitraires. Choisir et tester le mécanisme de sandbox sur le VPS réel avant de prétendre à une isolation par job.

## 11. Docker, sécurité et ressources du VPS

Docker Compose est recommandé pour cette taille. Kubernetes n'apporte pas automatiquement un confinement plus fort et ajoute ici de l'exploitation. Les conteneurs partagent le noyau ; si le VPS héberge des services sensibles, une VM/VPS séparée pour le traitement média apporte une frontière supplémentaire. [Isolation Kubernetes](https://kubernetes.io/docs/concepts/security/multi-tenancy/)

Relever sans révéler de secrets : OS, CPU, RAM, disque libre, versions Docker/Compose, mode rootless éventuel, reverse proxy, ports occupés, services en production, politique de sauvegarde et règles réseau. Ne pas redémarrer ou remplacer les services existants pour faciliter l'installation.

Durcissement concret :

- Utilisateurs non root, capabilities retirées, `no-new-privileges`, profils seccomp/AppArmor disponibles, racine en lecture seule lorsque compatible et répertoires temporaires explicitement montés.
- Rootless quand l'hôte le permet ; vérifier que les limites de ressources sont réellement appliquées avec son système de cgroups. [Docker rootless](https://docs.docker.com/engine/security/rootless/)
- Pas de `privileged`, de réseau host, de montage `/`, du home, des sockets système ou d'un volume contenant d'autres applications.
- PostgreSQL sans port public. Réseaux internes et sorties adaptées au rôle : un réseau Compose distinct ne filtre pas à lui seul toutes les sorties Internet ou les accès à l'hôte.
- CPU/mémoire/processus bornés, nombre d'exports simultanés faible, taille des fichiers et durée des commandes limitées. Réserver de la marge à l'OS et aux services voisins.
- Images/outils versionnés, mises à jour reproductibles ; pas de téléchargement/exécution arbitraire d'un binaire demandé par le navigateur.
- Déploiement sous un nom Compose et des volumes propres à Tarjama. Aucun `down -v`, prune global ou changement destructif des données pour « repartir propre ».
- Volumes, base et chiffrement : procédure de backup/restauration hors des volumes vivants. Le retrait de l'historique produit ne retire pas cette responsabilité d'exploitation.

Pour les comptes : OIDC avec issuer, audience, état, nonce et PKCE vérifiés selon le flux choisi ; identité fondée sur `(issuer, subject)`, pas uniquement une adresse mail. Sessions sécurisées HttpOnly/Secure, protection CSRF pour les actions avec cookies, pas de confiance dans un `user_id` envoyé par le navigateur.

Le SSO ne remplace pas l'autorisation métier. Toute lecture/écriture d'un projet, job, chunk, credential, média, miniature ou export doit être bornée au propriétaire ou à un membre autorisé. Tester les accès croisés avec deux vrais comptes de test. Ne jamais activer une identité de développement par défaut sur Internet.

## 12. Télécharger une vidéo sans transformer le VPS en proxy ouvert

YouTube ne garantit pas l'extraction depuis une IP de datacenter. Invidious n'est pas une copie indépendante des vidéos ; ses instances rencontrent elles aussi les blocages YouTube. Ne pas dépendre d'une instance publique pour promettre une fiabilité permanente. [Documentation Invidious](https://docs.invidious.io/instances/), [notes yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/Extractors)

Décision actualisée : le propriétaire a fait fonctionner **Cloudflare WARP + yt-dlp** sur le serveur dont l'IP directe est bloquée. Reprendre cette configuration vérifiée sur le VPS, en réservant WARP au téléchargement vidéo. Ce constat utilisateur n'est pas une garantie de disponibilité permanente ni une vérification effectuée par l'agent qui rédige ce document.

Garder yt-dlp maintenu dans le worker isolé, une concurrence faible et des reprises bornées. Utiliser la même sortie WARP pour l'extraction des informations et les pistes téléchargées. Préférer un proxy privé dédié lorsque la configuration WARP le permet, sans exposer ce proxy publiquement. Le site, SSH, la base et les appels Gemini/Groq conservent leur connexion habituelle ; ne pas modifier la route par défaut de tout le VPS pour cette fonctionnalité.

Si WARP tombe, conserver le job en attente sans basculer silencieusement vers l'IP directe déjà bloquée. Dès qu'un échec de téléchargement est présenté à l'utilisateur, proposer l'import dans le même projet ; ne pas l'obliger à patienter pour utiliser ce choix. Vérifier les téléchargements courts/longs, plusieurs passages successifs et la reprise après redémarrage WARP. WARP ne remplace aucun des contrôles d'isolation et SSRF ci-dessous. Les privilèges éventuellement nécessaires au tunnel ne doivent pas être accordés au processus qui analyse les vidéos.

Pas de cookies du compte YouTube du propriétaire partagés aux utilisateurs, ni de dépendance à une instance Invidious publique. Aucun réglage réseau n'apparaît dans le parcours utilisateur. L'import reste disponible dès la création et comme alternative immédiate à un lien impossible à télécharger.

Le validateur desktop `safeRemoteUrl` vérifie essentiellement protocole et absence d'identifiants intégrés : **il ne protège pas un serveur web contre les SSRF**. Pour le nouveau produit :

- Restreindre les sources reconnues au départ, normaliser les URL et limiter les redirections.
- Refuser loopback, réseaux privés, link-local/métadonnées cloud et équivalents IPv6. Vérifier la résolution réelle et les redirections ; éviter le rebinding DNS entre vérification et connexion.
- Les sous-requêtes yt-dlp, manifests et URL de médias doivent également être confinées par les règles de sortie ; valider seulement l'URL initiale est insuffisant.
- FFmpeg de traitement doit lire des fichiers locaux contrôlés, avec protocoles réseau désactivés quand inutiles.
- Lancer les outils sans shell, avec liste d'arguments fixe ; jamais de filtre FFmpeg, nom de chemin ou option yt-dlp arbitraire transmis par le client.
- Borner durée, taille téléchargée réelle, nombre de fichiers et taille des sorties de logs. Annuler le groupe de processus enfant correctement.
- Les imports par upload ont des contrôles de taille, type réel et quota de stockage ; un chemin déclaré par le client n'est jamais un chemin système de confiance.
- Ne pas révéler si un autre utilisateur a déjà importé la même vidéo ; pas de déduplication publique globale au MVP.

Ces mesures sont liées au rôle de service public téléchargeur, pas un exercice de durcissement abstrait : les URL et les décodeurs multimédias sont des frontières de confiance centrales.

## 13. Jobs persistants et reprise par morceaux

La file doit vivre dans PostgreSQL, pas uniquement dans des goroutines ou une mémoire du serveur. Un déploiement, crash, refresh ou téléphone mis en veille ne doit pas perdre les tâches ni recommencer les morceaux déjà enregistrés.

Champs indicatifs : utilisateur/projet, type, état, version source, priorité ordinaire, date de création, `next_attempt_at`, nombre d'essais, credential référencé, lease/heartbeat, progression, dernière erreur publique et détail technique expurgé.

États simples possibles : `queued`, `running`, `waiting_provider`, `succeeded`, `failed`, `cancelled`. Séparer l'état d'un job et l'étape de relecture du projet.

Invariants :

- Prise de job atomique, lease expirante, récupération après crash, jeton de lease ou version pour empêcher un worker devenu obsolète de publier un résultat.
- Pas de transaction DB ouverte pendant tout un appel IA ou un encodage.
- Persistance du résultat et de l'état terminé dans une transaction courte.
- Contrainte d'unicité logique empêchant un double clic de lancer deux fois la même étape sur la même version.
- Traitements indépendants par compte, ordonnancement équitable ; un long projet laisse les autres avancer entre morceaux.
- Les limiteurs/cooldowns partagés doivent être communs aux workers. Pour une clé personnelle, un cooldown n'arrête pas tous les autres utilisateurs ; tenir compte des projets/organisations fournisseurs quand cette information est connue.
- Une limite horaire/journalière devient une attente, pas une boucle de retry qui consomme les workers ou le compteur d'erreurs définitives.
- Annulation et suppression rendent les réponses tardives inapplicables. L'ajout d'une clé peut réveiller un job en attente sans dupliquer un appel en cours.
- Ne pas promettre l'exactly-once d'un appel externe si le fournisseur n'a pas d'idempotence : un crash après réponse mais avant commit peut imposer une reprise. Assurer l'absence de double application locale, journaliser l'incertitude et borner les réessais.

Pour le MVP, polling authentifié d'une progression persistante suffit ; SSE est une option. Les WebSockets ne sont pas nécessaires pour que le traitement continue sans navigateur.

## 14. Découpage Gemini et contrat de réponse

La demande est de traduire par morceaux de 20 minutes, pas une vidéo entière en un seul appel. Utiliser aussi une limite de tokens/segments pour respecter les sorties possibles et le quota minute. Couper aux frontières de segments ; un long silence ne doit pas produire un morceau vide.

Prendre un contexte limité autour du morceau et un glossaire/noms déjà établis si utile, mais distinguer les segments de contexte de ceux à produire. Ne pas retransmettre toute la vidéo à chaque morceau et ne pas enregistrer deux fois les segments de contexte.

Réponse structurée indicative :

```json
{
  "segments": [
    { "id": "segment-stable-001", "text": "Texte corrigé ou traduction" }
  ]
}
```

Le type d'opération décide quel champ serveur est mis à jour. Le modèle ne choisit ni propriétaire, ni ID de projet, ni URL, ni état du workflow, ni timestamps. Les IDs doivent appartenir au morceau demandé, être uniques et satisfaire la cardinalité attendue. Une réponse vide, tronquée, dupliquée, avec IDs inconnus ou mauvais ordre/ensemble est refusée. Les éventuelles suppressions de nettoyage suivent le contrat explicite évoqué en section 6, jamais une déduction à partir d'un oubli.

Enregistrer chaque morceau validé avec l'identifiant du modèle, la version du prompt et la version source. Une réponse calculée depuis une ancienne correction ne doit pas écraser le travail humain courant. Un export ne peut pas utiliser une traduction annoncée complète quand un morceau a échoué.

Adapter les prompts Markdown du desktop au JSON, mais conserver leurs règles linguistiques utiles. Ne pas laisser des variables `{{...}}` non résolues, des personnalisations de projet ou des instructions de copier-coller. Les prompts sont des fichiers serveur versionnés, pas des instructions éditables dans le compte utilisateur.

## 15. Modèle de données et API proposés

Rester au périmètre arabe → français, un média par projet au départ. Ne pas anticiper tout le backlog multilingue, catégories, extraits et montage de l'ancien `TODO.md`.

Schéma indicatif :

| Entité | Rôle |
| --- | --- |
| `users` / identités OIDC | Compte applicatif stable, issuer/subject uniques |
| `projects` | Propriétaire, titre, source, média, étape, versions et confirmations de relecture |
| `segments` | ID stable dans le projet, ordre, début/fin en ms, arabe, français nullable, version de concurrence |
| `credentials` | Propriétaire, fournisseur, secret chiffré et version de chiffrement ; jamais de secret dans une réponse |
| `jobs` / `job_chunks` | File durable, sources, leases, attentes et morceaux terminés |
| `media` / `exports` | Chemins/objets privés contrôlés, taille, type, statut et version source du rendu |

La traduction peut rester dans une entité séparée si cela simplifie sa version source ; ce n'est pas une obligation de reproduire les fichiers JSON desktop. L'important est l'alignement stable et la publication atomique.

Ne pas ajouter de table d'historique utilisateur. Une version pour contrôle de concurrence, un état courant, des résultats de job et des métadonnées d'exploitation ne sont pas des snapshots restaurables.

Endpoints indicatifs à adapter au code Go : session/OIDC, liste/création/détail de projets, mise à jour d'un champ segment avec version attendue, confirmation d'étape, état/annulation de job, credentials write-only, média privé avec Range, lancement/téléchargement d'export.

Pour la confirmation, le serveur ne croit pas un booléen `saved: true` envoyé par le client. Il valide la version en base, l'ensemble des préconditions et crée le job idempotent dans la transaction. Pour les conflits, renvoyer un code dédié (p. ex. 409) avec les informations nécessaires à conserver la saisie, jamais un écrasement en dernier écrivain par défaut.

## 16. Migration des projets desktop existants

Ne pas confondre migration d'architecture, migrations SQL et import des données locales. Les projets réels sont **hors du dépôt** ; le clone du VPS n'en contiendra pas automatiquement une copie.

Sur la machine de l'utilisateur, la bibliothèque active observée est :

```text
/Users/habib/Library/Application Support/Tarjama Studio/projects/<project_id>/
  project.json
  current.json
  transcript.json
  translation.json             # facultatif
  source.<extension>
  snapshots/
  translation_snapshots/
  model_outputs/               # selon le projet
```

La bibliothèque générique est sous `app.getPath("userData")/projects`. Il peut rester des dossiers `Electron` ou `Ashrafent` d'anciennes versions : ce sont des candidats legacy, pas une seconde source à fusionner aveuglément.

État courant : `current.json` prime s'il existe, sinon `transcript.json`. `translation.json` est chargé séparément et aligné par IDs et timestamps. Les champs `translation` du transcript sont généralement vides ; une migration ne doit pas en déduire l'absence de traduction. Certains états intermédiaires peuvent contenir des valeurs embarquées : les comparer à la traduction séparée et signaler tout conflit au lieu d'en perdre une silencieusement.

Procédure recommandée, après disponibilité d'un export/copied bundle fourni par le propriétaire :

1. Source desktop fermée ou copie cohérente en lecture seule. Ne pas télécharger toute une bibliothèque sans périmètre indiqué.
2. Import en dry-run avec rapport : projets, propriétaire destination explicite, médias disponibles, nombre de segments, timestamps, alignement et différences current/saved.
3. Remapper les identifiants de projets pour le multiutilisateur tout en conservant la correspondance et les IDs de segments. Ne pas utiliser un YouTube ID global comme clé de tous les comptes.
4. Copier les médias et importer l'état courant en transaction, avec contrôle d'intégrité et possibilité de rejouer sans doublons.
5. Ne pas déclencher Groq/Gemini sur des projets importés déjà transcrits/traduits. La migration ne doit pas consommer du quota ni modifier le texte.
6. Les empreintes de validation desktop doivent être vérifiées contre les contenus qu'elles qualifient, pas simplement transformées en `confirmed=true` parce qu'une date existe. Si la nouvelle sémantique ne permet pas une preuve fiable, conserver le texte et demander une revalidation.
7. Ne pas reconstruire une interface d'historique dans le web. Conserver les anciens snapshots dans l'archive desktop d'origine, sans les effacer ni les modifier.
8. Vérifier lecture/recherche temporelle, arabe/français, états et un export sur un projet copié avant tout import en masse.

Le skill `codex-skills/correct-tarjama-project` est un outil **desktop local** pour appliquer des retours de correcteurs. Il écrit plusieurs fichiers JSON, sauvegardes et snapshots, suppose l'application fermée et n'est ni une transaction PostgreSQL ni une API multiutilisateur. Ne pas l'installer comme moteur de correction web. Ses quatre tests synthétiques ne constituent pas une certification de sécurité ou de reprise après crash ; ne pas extrapoler sa vérification macOS à tous les OS.

## 17. Plan d'exécution pour l'agent VPS

### Phase 0 — orientation et inventaire non destructif

Lire `AGENTS.md`, ce document, les sources desktop du tableau, puis relever en lecture seule les caractéristiques réelles du VPS. Vérifier branche/base et statut Git. Documenter les hypothèses d'exploitation ; demander seulement les informations nécessaires au travail courant et impossibles à découvrir. Préparer des emplacements configurables pour domaine, fournisseur SSO et secrets ; les décisions propres à la mise en service seront données séparément par l'utilisateur.

Ne pas bloquer les tests et le code local faute de domaine ou de clé : utiliser des fournisseurs simulés explicitement limités aux tests/développement. Ne pas mettre une fausse authentification ou un faux fournisseur en production pour prétendre avoir fini.

### Phase 1 — premier incrément vertical concret

Créer le module Go, les migrations PostgreSQL, le frontend web séparé et un Compose de développement limité à loopback. Mettre en place une vraie frontière d'identité testable et l'autorisation par propriétaire. Construire « Mes projets » et l'éditeur arabe simple sur des fixtures.

**Livrable vérifiable :** deux utilisateurs ne voient pas les mêmes projets ; modifier un segment et quitter le champ persiste le changement ; recharger retrouve le texte ; le clic d'étape enregistre les derniers caractères ; un conflit ou une panne garde le brouillon. Aucun appel IA payant n'est nécessaire pour prouver ce lot.

Créer les cibles Make du nouveau workflow avant de les recommander. Noms proposés : `web-dev`, `web-test`, `web-build`, `web-up`, `web-down`, `web-migrate`. **Elles n'existent pas dans cette passation.** Les documenter précisément lors de leur création et éviter de recycler les cibles FastAPI.

### Phase 2 — médias et transcription

Deux entrées de création (lien ou upload), téléchargement borné via WARP dédié, proposition d'upload après échec dans le même projet, worker média confiné, stockage privé, HTTP Range, file PostgreSQL et clients Groq. Reporter les acquis de découpage et d'offsets ; simuler saturation/reprise/crash avant appels réels limités. Définir les bornes de disque/CPU et de rétention nécessaires au VPS.

### Phase 3 — Gemini et workflow complet

Nettoyage automatique, validation humaine arabe, traduction par morceaux, relecture, état en attente compréhensible et gestion des clés personnelles. Prompts fixes, réponses validées, aucune régression d'alignement. Résoudre explicitement le sujet des références religieuses vérifiées.

### Phase 4 — exports et usage téléphone

Low/High, style imposé, rendu arabe correct, téléchargement privé. Tester de bout en bout avec clavier mobile et lecture pendant l'édition. Intégrer les deux tutoriels fournis ou documenter honnêtement leur absence avec guides texte.

### Phase 5 — préparation de livraison et tests d'import, sans déploiement

Préparer et valider les configurations OIDC, HTTPS/proxy, secrets runtime, sauvegardes, health/readiness et logs expurgés, sans les activer sur les services en place. Tester redémarrage/reprise dans l'environnement isolé et l'import desktop en dry-run puis copie de test si les données sont disponibles. Documenter les valeurs attendues et les vérifications qui nécessiteront le futur environnement réel.

**Point d'arrêt obligatoire : aucun déploiement.** Après les tests et builds, remettre le commit testé, le bilan fonctionnel, les éventuelles limites, les fichiers de configuration et la procédure préparée. Ne pas ouvrir de port public, créer de route de proxy ou activer une stack de préproduction pour montrer le résultat. Attendre les instructions séparées de l'utilisateur pour la mise en service.

À chaque incrément : tests pertinents, commit cohérent sur `web-vps`, mise à jour d'un état d'avancement distinguant implémenté, simulé et restant. Ne pas annoncer « terminé » après le seul scaffold. Ne pas étendre à paiement, multilingue, montage ou collaboration temps réel sans besoin confirmé.

## 18. Tests et critères d'acceptation

### Invariants de sécurité et données

- Compte B ne peut pas lire/écrire/exporter/annuler les objets de A, y compris en devinant les IDs ; médias et jobs inclus.
- Clés jamais renvoyées en clair, jamais présentes dans le JS livré, jamais dans les logs ; chiffrement/remplacement/suppression testés.
- SSRF : hôte local, privé, IPv6, redirection vers privé, DNS changeant et sous-requête de média ; les limites de sortie réelles doivent compléter les tests de parseur.
- Pas d'injection d'options ou de shell via URL/titre/texte sous-titre ; sorties et ressources bornées.
- Deux sauvegardes hors ordre, deux onglets, double clic sur confirmer, réponse worker tardive, suppression pendant traitement : pas d'écrasement silencieux ni de résurrection.

### Enregistrement et interface

- Champ inchangé puis blur : aucune écriture inutile ; champ changé puis blur : sauvegarde confirmée.
- Cliquer directement « Suivant » depuis un champ actif, y compris avec composition arabe, sauve le texte exact avant de changer d'étape.
- Erreur réseau : brouillon conservé, message honnête, aucune confirmation prématurée.
- Pas de bouton sauvegarder/historique, de prompt à copier, de sélecteur de modèle ou de mode clair.
- Arabe seul à la correction ; français visible à la relecture ; RTL/LTR correct sur smartphone.
- Défilement audio par défaut, sans arracher le focus pendant la saisie.
- Création : lien et import de fichier disponibles sur ordinateur et téléphone, avec le même parcours après validation du média.
- Échec de téléchargement : import proposé dans le même projet ; aucun résultat tardif du lien ne remplace l'upload ou ne lance une seconde transcription.
- Upload interrompu ou média sans audio/vidéo : état honnête, reprise/réessai possible, pas de traitement d'un fichier incomplet.

### Fournisseurs et jobs

- Shared Gemini 429 : attente persistante ; reprise ; pas d'OpenRouter.
- Ajout d'une clé personnelle : même modèle, usage réservé à son propriétaire, reprise sans doubler le morceau courant.
- 401/403 ou modèle absent : erreur actionnable, pas d'attente infinie présentée comme quota.
- Groq limité : attente ou clé facultative, progression conservée.
- Redémarrage API/worker au milieu d'une vidéo : morceaux terminés réutilisés, leases expirées récupérées.
- Plusieurs utilisateurs : un long job n'occupe pas à lui seul la capacité partagée ; pas de retry storm.
- WARP indisponible puis rétabli : téléchargement conservé/repris, import toujours proposé si un échec est affiché ; site et connexion d'administration inchangés, aucune sortie directe involontaire.
- Réponse LLM tronquée/ID manquant/duplicata/texte mal formé : pas de succès ni d'application partielle incohérente.

### Temps, traduction et export

- `1:00:01.120` équivaut à `01:00:01.120` ; rejet de `60:01.120` et `00:60:01.120` comme équivalents valides.
- Vidéo dépassant une heure, frontières des morceaux Groq et Gemini, citations sur plusieurs segments : aucun décalage, duplication ou suppression silencieuse.
- Modifier l'arabe invalide la relecture/traduction concernée ; une traduction tardive ne remplace pas une saisie humaine.
- Lecture avec seek HTTP Range, audio réellement présent, export portrait/paysage Low/High, pas d'upscale inutile.
- Sous-titres gros blancs sur fond noir ; rendu arabe lié correctement et caractères français lisibles. Vérifier un fichier final réel, pas seulement les arguments FFmpeg.

Les intégrations fournisseurs doivent pouvoir être simulées de manière déterministe dans les tests, puis vérifiées sur un petit média autorisé avec les clés runtime. Les tests contre le réseau réel ne doivent pas consommer la capacité partagée à chaque build.

## 19. État livré et vérifications de la base

Au démarrage de cette passation, aucun fichier suivi n'était modifié. Les seuls travaux antérieurs non suivis liés à cette conversation étaient dans `codex-skills/correct-tarjama-project/` : skill, script de correction, quatre tests, référence de stockage et manifeste UI. Ils doivent être inclus dans le commit de livraison pour ne pas perdre ce travail.

Autres fichiers non suivis observés, **hors périmètre et à ne pas pousser sans demande distincte** : `NOTE.md`, `test.png`, `windows-test-package.zip`, `windows-whisper-benchmark.zip`. Ne pas interpréter leur présence comme des composants manquants de la future app.

Cette livraison ajoute :

- cette passation ;
- des indications de priorité dans `AGENTS.md` et des avertissements dans `PROJECT.md` / `TODO.md` ;
- le skill desktop précédemment réalisé, sans modifier sa logique pour le web ;
- `make correction-skill-test` pour rejouer ses tests avec Python standard.

Vérifications exécutées avec succès sur la machine de préparation le 21 septembre 2026 :

```sh
make desktop-security-test
make build-ui
make correction-skill-test
git diff --check
```

Résultats : 25 tests desktop réussis, build TypeScript/Vite réussi, 4 tests synthétiques du skill réussis, aucun problème d'espacement dans le diff. Un build desktop complet avec secrets ou téléchargement d'outils n'est pas nécessaire pour publier ces documents. Sur un nouveau clone, installer les dépendances `ui` depuis le lockfile avant les commandes Node ; certains scripts Electron historiques ont une préparation de defaults, sans jamais réutiliser une vraie clé dans les tests web.

Les contrôles de cette section prouvent uniquement la non-régression de la base et la cohérence de la livraison. Aucun test d'une application Go inexistante, de Docker sur le VPS, d'OIDC réel ou de production n'a été effectué ici.

## 20. Pièges qui feraient repartir le prochain agent dans la mauvaise direction

- « Il y a un backend FastAPI, il suffit de le mettre sur le VPS » : faux point de départ, refusé explicitement par l'utilisateur.
- « `ui/src/main.tsx` est forcément toute la bonne interface » : il contient deux applications ; lire `DesktopApp`, pas l'ancien `App`.
- « Reprendre tout le desktop, options comprises » : contraire au besoin principal de simplification.
- « Il faut demander une clé pour débloquer l'utilisateur » : il doit toujours pouvoir attendre une capacité partagée temporairement indisponible.
- « Il reste un crédit OpenRouter d'un million » : cette idée a été abandonnée, ainsi que le fallback DeepSeek.
- « Sans historique, pas besoin de contrôle de concurrence » : faux, il faut toujours protéger la saisie et les jobs contre les écrasements techniques.
- « Passer à l'étape suivante provoque naturellement blur, donc c'est suffisant » : attendre explicitement la persistance.
- « Supprimer l'historique autorise à nettoyer les snapshots existants » : non, aucune suppression des données desktop n'est demandée.
- « Les traitements peuvent vivre dans la requête HTTP » : non, ils doivent survivre à la fermeture de la page et au redémarrage.
- « Un Docker worker sur le même réseau avec tous les volumes assure le confinement » : non, vérifier droits, secrets, réseau et données réellement accessibles.
- « Google SSO donne une clé AI Studio » : non, la connexion au compte applicatif et les credentials de fournisseur sont distincts.
- « Une réponse JSON syntaxiquement valide peut être appliquée » : vérifier également IDs, cardinalité, version source, langue/champ et intégrité temporelle.
- « Le clone contient les projets de l'utilisateur » : non, ils vivent dans la bibliothèque locale hors Git.
- « Finir le projet implique de le déployer pour les tests utilisateur » : non, la mission s'arrête explicitement avant toute mise en service ; seul l'environnement de test isolé est dans le périmètre actuel.

## 21. Instruction de démarrage à donner au nouvel agent

> Travaille sur `web-vps` dans ce dépôt. Lis d'abord `AGENTS.md`, puis intégralement `docs/WEB_VPS_HANDOFF.md`. Vérifie que ta branche descend du desktop `9b3cc9fb1584ea195cfd2b8065a688a2bfca0cb7` et contient les dernières mises à jour de la passation. La référence métier est exclusivement le desktop actuel (`DesktopApp` dans `ui/src/main.tsx` et `ui/electron/`). Ignore comme base l'ancien FastAPI, l'ancien `App` web et le workflow CLI local. Inspecte le VPS sans perturber ses services, puis commence par le premier incrément vertical Go/PostgreSQL/React décrit en phase 1. Respecte les décisions finales : Gemini et Groq partagés, attente ou clé personnelle facultative, aucun OpenRouter/crédit, prompts fixes, mobile sombre simple, sauvegarde sur blur et flush avant étape suivante, aucun historique utilisateur. Préserve les données desktop. Réalise et teste les incréments sur `web-vps`, puis prépare la livraison. Arrête-toi avant tout déploiement ou modification des services du VPS : je te donnerai séparément les instructions de mise en service. Remets le commit testé et un bilan distinguant implémenté, testé, simulé et prérequis encore manquants.


### Décision utilisateur du 23 septembre — entrées vidéo exclusives

Cette décision remplace la possibilité historique d'importer pendant qu'un lien
est encore traité/en attente. Pendant un téléchargement ou une préparation
`queued`, `running` ou `waiting_provider`, masquer l'import et le refuser côté API.
Après échec ou annulation explicite, proposer l'import dans le même projet.
Un traitement en attente peut être annulé sans devoir patienter pour son réessai.
Le changement d'entrée conserve la barrière de génération contre les résultats
retardataires. Une deuxième requête d'upload doit être refusée avant de modifier
la génération de la première. Voir `web/review/upload-choice-20260923/README.md`
pour les tests et le diagnostic de l'incident média contemporain.

### Décision utilisateur du 24 septembre — vitesse de lecture

Le propriétaire demande désormais un réglage de ralentissement/accélération,
avec raccourcis clavier, sans déplacer le centre des commandes −5 s / lecture /
+5 s. Cette décision remplace le choix précédent sans contrôle de vitesse.
Le lecteur propose 0,5× à 2× (pas de 0,25×), par défaut 1× ; Maj + ↑ accélère
et Maj + ↓ ralentit hors saisie. Le réglage occupe une ligne distincte de la
barre de lecture. Le son conserve sa hauteur. Aucun changement de vitesse
n'est appliqué au fichier exporté.

### Protection de la relecture — 24 septembre

La transcription brute ne doit pas être présentée comme un texte à corriger :
masquer les champs et le suivi pendant la transcription et le nettoyage, jusqu'à
publication atomique de la correction. L'API refuse déjà les modifications à ces
étapes. Les réponses IA mal structurées peuvent être reprises de manière bornée,
avec découpage plus fin et conservation des morceaux validés ; aucun résultat
partiel n'est publié. Voir `web/review/cleanup-recovery-20260924/RESULTS.md`.
