# Intégration des opérations isolées — profils enregistrés et qualification

Cette livraison remplace l'exécution locale des outils par un moteur distant
explicite `isolated-jobs`. Le moteur Bubblewrap reste intact, sans exception ni
contournement. `atelier` reste arrêté. L'interface et les acquis métier viennent
du desktop ; aucun ancien backend FastAPI ou composant App repris.

## Frontière de confiance

Le worker appelle l'API HTTPS privée avec le secret administré `isolated-jobs`
(`token`, `ca.crt`). Seul le worker reçoit ce secret. Le client valide TLS avec
cette CA, refuse les redirections et n'utilise pas les proxys d'environnement.
Le protocole ne transporte que profil fixe, paramètres bornés et fichiers nommés.
Ni shell, commande, image, montage, credential runtime ni manifeste libre.

Le programme `tarjama isolated-tool` est un **exécuteur de profil administrateur**,
jamais un repli du moteur média. Il suppose la frontière fournie par le broker :
non-root, network-none, capabilities retirées, seccomp/AppArmor par défaut, NNP,
racine read-only, seuls fichiers nécessaires, tmpfs/CPU/mémoire/pids bornés.
Il n'appelle pas les chargeurs de secrets/configuration/DB. Les chemins CLI sont
fixes : `/inputs` en lecture seule, `/outputs` en écriture ; HOME temporaire,
environnement enfant minimal, groupes de processus annulables et prlimit.
Le broker doit faire correspondre ces chemins à ses montages internes administrés.

L'image utilisée par le profil est immuable. Le runtime Docker des opérations
n'utilise pas automatiquement le cache K3s : le dossier donne **Docker image ID**
et référence de manifeste d'import séparément. L'enregistrement appartient à
l'administrateur et n'est pas réalisé par la recette Tarjama.

## Contrats de profils examinés et enregistrés

La liste structurée est [isolated-profiles.proposal.json](../deploy/preview/isolated-profiles.proposal.json).
Ce dossier de revue a été enregistré par l’administrateur le23septembre dans
`vars/isolated-media.yml`, d’après sa passation `isolated-media-20260923.md`.
Il reste **distinct du format Ansible administrateur**, sans installation par Tarjama.
Les accolades désignent des paramètres à substituer par le mécanisme administré,
jamais un shell. L'API applicative ne reçoit que leur valeur sous forme de chaîne.

| Profil | Entrées → sortie | Paramètres | Délai |
| --- | --- | --- | --- |
| `media-probe` existant | media ≤512Mio → stdout JSON ≤1Mio | aucun |30s|
| `tarjama-probe-v1` enregistré | media ≤1Gio → stdout JSON ≤1Mio | aucun |30s|
| `tarjama-audio-v1` enregistré | media ≤1Gio → audio.flac ≤23Mio | start_ms entier0–10800000 ; duration_ms1–600000 |4h|
| `tarjama-normalize-v1` enregistré | media ≤1Gio → result.mp4 ≤1Gio | width/height pairs2–8192 ; quality=high |4h|
| `tarjama-export-v1` enregistré | media ≤1Gio + subtitles.ass ≤16Mio → result.mp4 ≤1Gio | mêmes dimensions ; quality=low/high |4h|
| `tarjama-download-v1` enregistré | aucune → media ≤1Gio | URL YouTube canonique ≤2048 caractères ; track=video/audio |30min|
| `tarjama-mux-v1` enregistré | media + audio ≤1Gio chacun → result.mkv ≤1Gio | aucun |4h|

Le profil audio existant WAV/secondes entières n'est pas utilisé. Le nouveau
contrat conserve les millisecondes, mono16kHz et impose16bits avant FLAC : un
morceau de600s reste dans la marge23Mio. Le client refuse quand même une sortie
hors limite. Le chevauchement20s et la reprise des morceaux Groq sont conservés.
Les profils absents échouent explicitement ; aucune invocation locale de FFmpeg.

Le worker calcule dimensions sans upscale, orientation et ASS échappé. L'exécuteur
valide à nouveau les paramètres et construit un argv fixe, sans shell. FFmpeg
et ffprobe n'acceptent que `file,pipe`. Le résultat vidéo est reprobé dans une
opération séparée avant publication. Une empreinte correcte ne prouve pas
l'innocuité ou la conformité métier du contenu ; ces contrôles restent nécessaires.

Ressources enregistrées, **tailles maximum restant à qualifier**, concurrence globale1 :
petit profil existant256Mi inchangé ; nouveau probe1536Mi ; audio1536Mi ; normalize/export
3072Mi ; mux4096Mi ; download1536Mi. Le budget doit inclure toutes les entrées,
sorties, fichiers temporaires et décodeurs ; le grand profil peut nécessiter une
limite applicative moindre si la mémoire physique disponible ne permet pas1Gio.
CPU2, pids128, fichiers/descripteurs bornés ; aucune nouvelle capability demandée.
Les nouveaux profils montent `/inputs` read-only et `/outputs` en tmpfs64Mi ou
1152Mi. Réservation totale du broker4Gio, réserve disque minimale8Gio. Ces plafonds
ne prouvent pas que les fichiers1Gio et traitements4h ont été qualifiés.

## YouTube, relais et WARP

Le téléchargement des pistes vidéo et audio s'effectue dans deux opérations
idempotentes du même profil. Chaque yt-dlp télécharge un flux HTTPS, sans fusion,
fixup ni FFmpeg accessible par son argv. Le choix reste automatique jusqu'à1080p.
L'assemblage des pistes est une opération **sans relais**, suivie de probe puis
normalisation sans relais. Cela évite d'analyser la vidéo avec FFmpeg dans le
conteneur disposant du relais. Les options fixes s'appuient sur la
[documentation yt-dlp](https://github.com/yt-dlp/yt-dlp#usage-and-options).
Les formats HTTPS choisis peuvent être indisponibles sur certaines vidéos :
refus explicite et import disponible, pas de sortie directe de secours.

Le profil utilise le relais administré loopback `127.0.0.1:18080` vers le **filtre de
domaines** Tarjama, qui passe ensuite exclusivement par WARP172.31.250.2:40001.
Le WARP brut ne remplace pas ce filtre. Le filtre existant, commande `tarjama egress`,
garde DNS/IP publics, refus privé/metadata, CONNECT443, IP épinglée et TLS/SNI au
nom d'origine. La recette conserve le service egress arrêté, port8092, sans accès
public. L’administrateur a raccordé le relais au Service `pv-egress:8092` ; son
ClusterIP est résolu par Ansible et ne doit pas être codé dans l’application.
Sans endpoint tant que les services restent arrêtés, le relais échoue sans repli.

Tester URL initiale et sous-requêtes, TLS négatif, rebinding, redirection vers
privé, panne/recréation filtre/relais/WARP et refus immédiat de connexion directe.
Les tests synthétiques d'infrastructure rapportés dans le skill ne prouvent pas
le fonctionnement de cette chaîne avec le vrai yt-dlp/YouTube de Tarjama.

## Durabilité, concurrence et nettoyage

Migration002 : `media_operations` et compteur `jobs.media_attempt`. Le registre
ne cascade pas à la suppression du projet : son intention d'annulation doit
survivre. La clé dépend du job, du réessai explicite, du morceau et de l'étape.
La définition persistée inclut profil, paramètres exacts et empreinte/taille des
entrées. Un autre contenu sous la même clé est refusé.

1. Enregistrer la définition sous contrôle génération/version/lease, puis créer
   l'opération. Si la réponse se perd, répéter la **même clé**, sans nouvelle exécution.
2. Persister l'ID distant. Transfert PUT entier avec taille/hash ; une interruption
   recommence le même fichier. Start est idempotent. Polling borné ; chaque requête
   HTTP possède un budget5min, réponse initiale30s et connexion10s.
3. Récupérer dans le cache privé sur volume durable, avec Range après interruption,
   contrôle du total et SHA256. Vérifier de nouveau la propriété de l'opération,
   fsync fichier/répertoires, rename puis checkpoint PostgreSQL.
4. ACK seulement après ce checkpoint durable. Ce cache privé n'est pas une
   publication métier : Finish/Chunk vérifient encore version/génération/lease
   avant que le résultat soit visible ou la transcription validée.
5. En cas de redémarrage, réutiliser cache vérifié ou ID existant. Un résultat
   expiré ou un cache perdu après ACK échoue explicitement. Seul le bouton de
   réessai après échec/annulation change media_attempt et crée une nouvelle clé.
   Une simple attente fournisseur/admission conserve les opérations existantes.
6. Le réconciliateur tourne indépendamment des longs encodages. Il retrouve les
   opérations supprimées, périmées, terminées ou d'un morceau déjà validé ; demande
   cancel puis attend un état terminal avant ACK/nettoyage. Un202 n'est jamais
   interprété comme une annulation achevée. L'arrêt du worker ou la perte de lease
   seuls n'annulent pas l'opération qu'un autre worker doit reprendre.

Un verrou filesystem par clé empêche deux workers de corrompre un transfert
partiel pendant une passation de lease ; le noyau le libère après crash. Les petits
fichiers de verrou et tombstones sont conservés pour éviter les courses de suppression.
La source durable reste l'application, pas les tmpfs du runner.

Limites administrées à traiter avant usage réel : résultats24h, préparation/file1h,
transfert5min, attente du runner10min si le broker est absent, et **1000 identifiants
conservés par tenant**. Le nombre d'opérations peut atteindre plusieurs dizaines
par vidéo. Demander une politique de capacité/rétention des tombstones compatible
avec cette charge ; ne pas effacer aveuglément des clés encore rejouables.
Une sauvegarde DB seule ne suffit pas après ACK : inclure bibliothèque/cache et
vérifier une restauration cohérente. Pas de promesse d'exactly-once fournisseur.

## Preuves et qualification restante

Démontré localement : protocole HTTPS simulé avec vraie CA de test, refus mauvaise
CA/redirection ; pertes de réponses/transferts, Range après reprise du worker,
aucune double exécution ; empreinte incorrecte et entrée changée refusées ; rejet
d'une génération périmée ; suppression avec attente d'annulation terminale ; perte
du cache après ACK sans réexécution implicite ; réessai utilisateur avec nouvelle
clé. Vrais FFmpeg : préparation, FLAC fractionnaire, ASS arabe/français Low/High.
Ces tests utilisent des fixtures synthétiques et **aucun secret VPS ou fournisseur**.

La passation administrateur du23septembre rapporte l’enregistrement des huit
profils sur l’image attendue, les essais du filtre réel et de WARP avec une fixture
administrateur : CONNECT autorisé, TLS au nom d’origine, mauvais nom TLS refusé,
domaines hors liste, IP privées/metadata/loopback IPv6/port incorrect refusés,
DNS vers127.0.0.1 refusé, panne WARP simulée sans repli et recréation du filtre.
La frontière est network-none ; aucune correction du CNI ou exception noyau.
Ces preuves sont rapportées par l’administrateur, pas produites par la suite projet.

Le schéma de réponse est confirmé : `/v1/profiles` est un objet indexé par nom,
sans enveloppe ; `/v1/jobs/{id}` expose `id` et `state` au premier niveau, ainsi
que des maps `inputs`/`outputs` contenant `size` entier et `sha256`. Le client actuel
est compatible avec ces champs ; aucun changement du binaire n’est nécessaire.
Cela ne remplace pas les essais de bout en bout avec les composants Tarjama.

Restent : YouTube et ses sous-requêtes réelles, médias longs/tailles maximales,
reprise métier sur le vrai broker, navigateur OIDC, fournisseurs, persistance et
restauration cohérente. Les essais à deux comptes sont reportés avec l’activation
du compte de test à la demande du propriétaire. Aucun test direct de stress vers
l’IP privée depuis l’hôte, aucun pare-feu modifié, aucun service Tarjama activé.
