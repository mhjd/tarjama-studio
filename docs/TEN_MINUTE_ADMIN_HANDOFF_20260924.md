# Demande administrateur — diagnostic audio et remise des preuves UI

## Actualisation après intervention administrateur

Le profil demandé est mis à jour, sans changement des protections. L’essai audio
administrateur a réussi (24 septembre, 20:25 UTC). Les 48 artefacts des trois runs
PASS ont été copiés puis vérifiés à nouveau par SHA-256 par l’agent. Livraison
préparée avec `vps-share` sous `tarjama-parcours-10min` (52 fichiers, avec rapports,
notice et empreintes). Le propriétaire doit exécuter `vps pull` sur son Mac.
Cela ne prouve pas la cause de l’incident précédent. La reprise complète du parcours
long, ses corrections et sa demande de copie distincte sont documentées dans
[HOUR_UI_RESUME_20260924.md](HOUR_UI_RESUME_20260924.md).

Les demandes ci-dessous sont conservées pour audit ; leur exécution a été confirmée
par `references/isolated-download-20260924.md` dans le skill `vps-preview` et les
[rapports administrateur](../web/review/hour-resume-20260924/).

## Diagnostic du téléchargement audio (demande initiale)

Le parcours réel court (138 867 ms) a réussi. Le parcours d'une heure est bloqué
avant toute IA : `tarjama-download-v1`, `track=audio`, code de sortie 1 ; la vidéo
seule a été récupérée. Source : `https://www.youtube.com/watch?v=7TLnx8DIu4c`.
Opération `ada7f707ecc6cb292ef161b3a1363d73`, 24 septembre à 19:44:31 UTC.
Le worker a lu les diagnostics avant ACK : `tool_detail_hidden`. L'ancien outil
capture stderr mais ne restitue que « Outil isolé en échec ». La cause sous-jacente
reste inconnue ; ce n'est pas encore un diagnostic de refus YouTube ou de WARP.

Image candidate construite depuis `web-vps@a4e92c9` :

- Tag Docker local : `tarjama-media:diagnostic-20260924`.
- **Docker ID** : `sha256:76c8571d850066a9ddc74310ec5fee7b6fc27d53ca68a19d09c23a0c5b54007c`.
- Import K3s : `preview.local/atelier/media@sha256:f139bf21f322dc765efafc0cab04cba071b965a118c1b9eb27ba864f4e106d9c`.
- Aucun profil existant n'a été modifié ou activé par cet import.

Le changement retourne une catégorie fixe et, **pour le téléchargement seulement**,
une fin de stderr privée limitée à 4 Kio, avec URLs et lignes de credentials
masquées. Les autres outils n'exposent pas le contenu des fichiers utilisateur.
La catégorie seule passe dans les logs applicatifs. Aucun secret applicatif n'est
fourni à yt-dlp. Ses flags, version épinglée, proxy, protections TLS/SSRF et absence
de repli direct restent inchangés.

Validation de l'image : probe, FLAC fractionnaire, normalisation MP4 synthétiques
sous réseau absent, rootfs en lecture seule, capabilities retirées, NNP et limites
existantes. Un téléchargement synthétique **sans relais et sans réseau** échoue
avec `error_category=connection_refused`, sans URL non masquée. Tests de redaction
et de classification avec Go race réussis. Ce n'est pas une qualification de la
résolution de l'incident réel.

**Action demandée :** revoir puis pointer uniquement `tarjama-download-v1` vers
le nouveau Docker ID, en conservant ses commandes, paramètres et protections.
Exécuter un essai audio borné sur l'URL ci-dessus (`url`, `track: audio`), lire les
diagnostics avant acquittement et communiquer la catégorie ainsi que le détail
expurgé. Ne changer ni WARP, ni réseau, ni sandbox pour faire passer l'essai.
Les autres profils gardent leurs images qualifiées. L'enregistrement des profils
est réservé à l'administrateur ; le déployeur applicatif ne dispose pas de cette
opération dans `vps-preview`.

## Copie des artefacts terminés

Le CLI `vps-preview` ne fournit pas d'export de fichiers depuis le PVC ; le compte
agent n'a ni accès aux répertoires K3s ni résolution du service privé depuis l'hôte.
Ne pas ouvrir publiquement le serveur de qualification et ne pas donner de
credentials Kubernetes au compte agent.

Copier les seuls artefacts des runs **dont le manifeste indique PASS**, depuis
le volume `library` d'`atelier` (namespace `preview-atelier`) :

- `/storage/ui-review-tenmin_short3/artifacts/` — MacBook Air 15.
- `/storage/ui-review-tenmin_pixel1/artifacts/` — Pixel 6.
- `/storage/ui-review-tenmin_iphone1/artifacts/` — iPhone 15, PASS (313 s).

Destination proposée, sans écraser les originaux :
`/home/codex/projects/tarjama-studio/web/.cache/real-ui-10min/RUN/`.
Fichiers ordinaires seulement : MP4 High, WebM du parcours, PNG, transcription JSON
et manifeste. Copies privées appartenant à `codex`, sans changer les permissions
parents K3s ni celles du volume. Aucune base, sauvegarde, clé, cookie ou donnée de
projet réel. Après comparaison des SHA-256, l'agent pourra les préparer via
`vps-share` pour le `vps pull` du propriétaire.
