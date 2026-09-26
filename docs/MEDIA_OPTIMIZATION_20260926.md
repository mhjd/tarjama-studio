# Optimisation média — 26 septembre 2026

## Diagnostic et périmètre

Le VPS annonce six vCPU KVM. Les profils média enregistrés disposent de deux
vCPU et l'encodeur x264 de deux threads. Le desktop utilise `superfast` sans
plafond explicite de threads ; le profil VPS utilisait `veryfast`. Les deux
emploient **libx264 logiciel**, aucune accélération matérielle n'est invoquée
par ces commandes. Le modèle de CPU annoncé par l'hyperviseur ne permet pas de
conclure à la génération du processeur physique.

La préparation encodait systématiquement la vidéo ET l'audio, avant un nouvel
encodage à l'export. Une vidéo visuellement fixe restait traitée image par image.
Le propriétaire demande d'optimiser la commande elle-même, puis de comparer
2 et 4 vCPU, sans compromettre les services voisins.

## Implémentation

L'optimisation reste **dans le profil isolé** : inspection locale par ffprobe,
30 secondes maximum, sortie bornée, puis une seule commande FFmpeg. Aucun
nouveau job orchestration, endpoint, secret, accès volume ou sortie réseau.
Le worker conserve ses opérations, cache/idempotence, vérification de sortie,
contrôles de lease/génération et publication atomique.

- Préparation H.264 compatible : copie des paquets vidéo dans un nouveau MP4.
  AAC-LC mono/stéréo à 44,1/48 kHz : copie aussi de l'audio. Autre audio : conversion
  de l'audio uniquement. Ce n'est jamais une copie aveugle du fichier original.
- Sous-ensemble vidéo prudent : yuv420p, profils Baseline/Constrained Baseline/Main/
  High, niveau <=4.2, progressif, pixels carrés, <=60 fps, dimensions déjà conformes
  à la cible, MP4/MOV ou Matroska. Rotation, side data, HDR déclaré, caractéristiques
  manquantes/incompatibles : conversion existante. Le premier flux vidéo/audio est
  sélectionné comme auparavant ; pistes supplémentaires, chapitres et métadonnées
  utilisateur de conteneur/pistes sont retirés. Le MP4 conserve `+faststart`.
- Export : vidéo toujours réencodée pour incruster ASS, audio AAC compatible copié.
  CRF23 High / CRF28 Low et `veryfast` conservés. Aucun changement de fréquence
  d'images, de résolution cible ou de synchronisation des sous-titres.
- Argument final **fixe administrateur** `4` disponible pour normalize/export.
  En son absence : deux threads, compatibilité des profils actuels. Aucune valeur
  de thread libre ni option FFmpeg provenant du navigateur.
- Annulation, limites de temps/taille/processus, prlimit, diagnostics expurgés et
  confinement conservés. Une erreur de remux n'entraîne pas une seconde tentative
  cachée de transcodage. Les inspections ffprobe ne constituent pas une preuve de
  décodage exhaustif d'un média arbitraire ; les fixtures produites sont, elles,
  décodées intégralement dans les tests.

Le téléchargement yt-dlp conserve sa sélection actuelle : une source VP9/AV1
nécessitera toujours une conversion. Le gain du chemin H.264 ne doit pas être
promis pour toutes les vidéos YouTube ni extrapolé à la source d'une heure sans
inspection de ses pistes.

## Mesures reproductibles

`make web-media-performance` génère deux sources de 20 secondes, 1920×1080/25fps :
une mire détaillée fixe et une mire en mouvement. L'option
`MEDIA_BENCH_SOURCE=/chemin/autorisé.mp4` ajoute vingt secondes d'un fichier réel.
La campagne du 26 septembre utilise le MP4 de qualification arabe `gbrDbQVYDuQ`
déjà présent dans le workspace, avec ses anciens sous-titres français incrustés.
Les nouveaux sous-titres ASS du benchmark sont identiques pour toutes les variantes.

Chaque variante est répétée deux fois, ordre inversé à la seconde passe. Les
encodages se succèdent ; les tests/builds du projet attendent leur fin. Conteneurs
locaux sans réseau, sans secret, racine en lecture seule, capabilities supprimées,
NNP, CPU/mémoire/pids bornés. Un timeout interne de 15 minutes par phase survit à
la disparition du lanceur ; chaque FFmpeg a un délai de 3 minutes. Aucune API payante.
Le script conserve commande, temps mural/CPU, taille, cgroup throttling et SSIM.
SSIM compare l'export à la source décodée **avec les mêmes sous-titres** ; ce score
ne remplace ni l'inspection visuelle ni une qualification Safari/appareils réels.

Moyennes de deux passages, en secondes (temps de **commande**, hors broker,
transfert, sondes supplémentaires et publication applicative) :

| Source de 20 s | Préparation avant | Copie des pistes | Export initial 2 CPU | Export audio copié 2 CPU | Export audio copié 4 CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mire fixe | 5.81 | 0.13 | 6.59 | 6.44 | 3.49 |
| Mire en mouvement | 10.45 | 0.15 | 11.03 | 10.81 | 5.99 |
| Extrait réel | 8.87 | 0.14 | 9.59 | 9.16 | 5.46 |

La copie évite l'encodage vidéo ; le gain de commande est d'environ 46–69× sur
ces petits fichiers déjà compatibles. Cela ne prédit pas le temps total d'un
import d'une heure : les transferts et les codecs source restent déterminants.
L'audio copié à l'export économise seulement 2–4,5 % ici. C'est néanmoins une
réduction de travail sans nouvelle perte de qualité audio.

**`superfast` n'est pas retenu par défaut** : à CRF23 et 2 CPU, il gagne
12–22 % avec audio réencodé, mais augmente la taille de 12 % (fixe), 102 %
(mire mobile), 81 % (extrait réel). La copie de l'audio combinée au preset
atteint 24–26 % de gain sur les deux sources en mouvement, toujours avec cette
augmentation de taille. Le SSIM ne baisse pas sur ces exemples ; ce n'est pas
une preuve universelle de qualité équivalente. La limite de sortie de 1 Gio et
le stockage rendent ce compromis peu souhaitable en changement global.

Avec `veryfast` conservé et audio copié, 4 CPU réduisent le temps de 40–46 %
par rapport à la même commande sur 2 CPU, sans variation matérielle de taille
ou de SSIM dans ce lot. Les mesures donnent environ **1,95–1,98 CPU utilisés
sur les 2 autorisés** : le calcul utilise bien son allocation. Sur 4 CPU, on
mesure 3,35–3,60 CPU moyens ; aucune promesse de multiplication linéaire.

Les données brutes, commandes et résultats sont sous
`web/review/media-performance-20260926/`. Les gros médias restent dans
`web/.cache/media-performance/20260926T151043Z/`. Pas de séquence complète
nouvelle d'une heure, de test fournisseur ni de changement de profil actif
pendant cette campagne.

## Sources techniques

[FFmpeg : streamcopy](https://ffmpeg.org/ffmpeg.html#Streamcopy) décrit la copie des
paquets sans décodage, filtre ou encodage ; elle ne permet donc pas l'incrustation
ASS. [FFmpeg : libx264](https://ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb)
documente preset/CRF/threads. Les décisions ci-dessus reposent sur les commandes
réelles du dépôt et les mesures locales, pas sur une promesse de vitesse générique.

## Qualification et activation

- Tests de sélection conservatrice : 26 cas incompatibles ; contrat des arguments
  administrateur borné à2/4, export jamais remplacé par une copie vidéo.
- FFmpeg réel : copie MP4 et Matroska avec paquets vidéo identiques ; H.264+MP3
  conserve les paquets vidéo et produit de l'AAC ; suppression des pistes extra et
  des métadonnées ; faststart ; redimensionnement effectif ; fichier corrompu et
  annulation refusés ; export avec paquets AAC inchangés. Décodage complet des
  fixtures remuxées/exportées.
- Image candidate réelle sous protections par défaut, sans réseau, à2 puis4CPU :
  sonde, FLAC fractionnaire, conversion, remux, export ASS, identité des paquets et
  décodage complet PASS. Le téléchargement sans relais échoue comme attendu et
  ses diagnostics restent expurgés.
- Captures d'export du benchmark initial/4CPU inspectées : même image et même
  sous-titre. Le passage réel comporte déjà des sous-titres incrustés : la ligne
  de test supplémentaire les recouvre volontairement dans **toutes** les variantes.
  Ces images mesurent un rendu ; ce ne sont pas des vidéos de livraison utilisateur.

Les nouvelles fonctionnalités sont dans l'image média candidate, **pas dans les
profils actifs**. La [demande précise à l'administrateur](MEDIA_OPTIMIZATION_ADMIN_20260926.md)
contient les deux profils, l'image immuable, les protections inchangées et la
procédure de qualification/retour arrière. Aucun déploiement, migration ou
remplacement de profil n'a été exécuté pendant cette optimisation.

Vérifications globales : `make web-test` PASS (Go avec détecteur de courses,
`go vet`, build TypeScript/Vite, **47 tests Playwright**, sauvegarde/restauration
PostgreSQL de fixtures). L'image candidate a été construite et testée. Statut
atelier relevé ensuite : révision `5dcf2e33fbe5a269` inchangée, web/worker/db/egress
prêts, service de revue arrêté. Les anciennes tâches terminées restent visibles
au statut ; aucune tâche de qualification nouvelle n'a été lancée sur atelier.
