# Frontières et limites vérifiables

La recette VPS actuelle utilise le moteur `isolated-jobs`, décrit dans
[ISOLATED_JOBS.md](ISOLATED_JOBS.md). Son worker ne lance aucun outil média local.
Les paragraphes Bubblewrap/RPC/Compose ci-dessous décrivent le moteur historique
conservé, dont les contrôles ne sont pas désactivés. Ils ne constituent pas une
qualification du nouveau chemin administré. Les invariants métier/fournisseurs
restent communs aux deux moteurs.

Le service API et le worker sont de confiance. PostgreSQL stocke l'état courant, les leases et les morceaux validés. Le média reçoit par RPC uniquement les fichiers et paramètres de son opération. Il possède son token RPC mais aucune clé IA, aucun credential DB ni volume de bibliothèque. Les sous-processus Bubblewrap voient `/usr`, les bibliothèques, certificats/polices et leur seul `/job`. Leur environnement est nettoyé ; les secrets du service n'y sont pas copiés. FFmpeg est sans réseau ; protocoles limités à `file,pipe`. Le code n'exécute aucun shell avec du texte utilisateur.

Le downloader conserve le réseau interne, nécessaire à son proxy, mais ne dispose d'aucune route Internet directe dans le Compose. Il utilise le proxy filtrant pour toute extraction et chaque sous-requête. Le proxy accepte seulement CONNECT 443 vers YouTube/Googlevideo/Ytimg/YouTubei ; il résout chaque destination, refuse toute réponse DNS non publique et passe une IP épinglée au proxy WARP. SNI/TLS conserve le nom d'origine dans le tunnel. Redirections vers une autre destination doivent ouvrir un nouveau tunnel contrôlé. L'arrêt WARP ne déclenche jamais une connexion directe. L'efficacité des réseaux internes et le profil de sandbox doivent encore être validés avec la configuration réelle du VPS : les tests de parseur et de proxy ne prouvent pas cette frontière système.

Le RPC média est sérialisé, temporaires bornés par tmpfs, pids/mémoire/CPU/temps/fichiers limités. Une réponse tardive est vérifiée par génération du média, version source et jeton de lease dans une transaction verrouillée. Une suppression en cascade ne peut pas être annulée par un worker. Les exports utilisent leur entrée figée et restent privés même si la correction change ensuite.

L'ordonnanceur prend un morceau puis remet le job dans la file. Il choisit le propriétaire le moins récemment servi ; un compte ne monopolise pas les workers avec plusieurs jobs actifs. Le cooldown est PostgreSQL, partagé par clé commune ou séparé par empreinte de clé personnelle. La relation entre deux clés distinctes du même projet fournisseur n'est pas déductible : l'exploitant doit tenir compte du quota commun à ce projet. Les 429/indisponibilités attendent ; les 401/403/modèles absents demandent une intervention. Le délai Retry-After est conservé ; sinon backoff borné et jitter. Un appel déjà parti garde sa clé ; un changement ne duplique pas le morceau courant.

Il n'existe pas de garantie exactly-once pour les appels fournisseurs : un crash après réponse distante et avant commit peut entraîner un second appel. Les morceaux déjà committés sont réutilisés. L'application locale du résultat reste protégée par version et lease. Le merge ASR avec chevauchement est une heuristique reprise du desktop, testée aux frontières temporelles, pas une garantie linguistique parfaite sur toute répétition.

Les tests OIDC utilisent un issuer local avec JWT RSA signé et JWKS ; ils vérifient un vrai flux code/PKCE/session. Le fournisseur réel, son audience, sa politique de compte et ses cookies sur le domaine final ne sont pas encore validés. Le mode de développement n'est pas chargé par défaut et le frontend de test ne fait pas partie des images finales.

Le navigateur garde un brouillon courant en localStorage par compte/projet, purgé à déconnexion. Sur un appareil partagé, fermer un onglet n'est pas se déconnecter. Aucun historique, snapshot ou comparaison restaurable n'est livré. Une coupure brutale de navigateur ne prouve pas une persistance serveur ; seuls les acquittements de blur/flush le font.

Les prompts internes préservent les règles linguistiques utiles du desktop mais n'affirment pas de recherche sur quran.com/sunnah.com. Aucun bloc n'est supprimé implicitement ; toutes les réponses Gemini sont vérifiées par ID, ordre, cardinalité, taille et version. La vérification religieuse et l'emploi exact de Hamidullah nécessitent une relecture humaine ou un futur corpus de références contrôlé.

Téléchargement : yt-dlp 2026.08.19 avec son groupe de dépendances EJS, Node 22.23.2 présent dans l'image et activé explicitement. Les scripts ne sont pas téléchargés dynamiquement à l'exécution. Sélection automatique vidéo jusqu'à 1080p + audio, fusion locale puis normalisation MP4. Configuration fondée sur le [guide EJS officiel](https://github.com/yt-dlp/yt-dlp/wiki/EJS) ; un téléchargement réel via WARP reste à vérifier. Les profils réseau doivent donc couvrir yt-dlp, son runtime et ses sous-processus, pas seulement l'URL d'entrée.
