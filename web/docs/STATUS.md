# État du port web

Base : `183cf9b`, descend du desktop `9b3cc9f`. Aucun fichier local modifié au départ. Ancien FastAPI et ancien App non utilisés. Aucun déploiement autorisé dans cette mission.

Inventaire en lecture seule, 21 septembre 2026 : Ubuntu 24.04, 6 vCPU, 12 Go RAM, 29 Go libres sur 96 Go, pas de swap. Docker 29.8 / Compose 5.5, AppArmor/seccomp/cgroups présents. Caddy/Authelia et Kubernetes déjà installés ; ports 80/443/22 et plusieurs ports loopback occupés. Trois conteneurs PostgreSQL préexistants laissés intacts. Accès systemd refusé à codex ; politique de backup et état WARP non vérifiables par cet accès. Aucun secret existant lu.

Architecture : monolithe Go avec API et worker, PostgreSQL (documents courants JSONB verrouillés, jobs/chunks/sessions relationnels), frontend React séparé, service média sans secrets IA/DB, sortie téléchargement via proxy filtrant puis WARP. Tests et fixtures isolés.

Références religieuses : les prompts ne prétendent pas effectuer des recherches. Pas de référence ajoutée ou de traduction Hamidullah certifiée sans corpus vérifié. Limite affichée à la relecture ; contrôle humain requis. Aucun segment supprimé automatiquement par Gemini : cardinalité stricte, même pour le nettoyage.

Fournisseurs : identifiant gemini-3.8-flash confirmé dans la documentation officielle le 21 septembre 2026 (https://ai.google.dev/gemini-api/docs/latest-model). Accès/quota du compte réel à vérifier ultérieurement. Groq : whisper-large-v3, verbose_json, FLAC mono 16 kHz ; découpage repris du desktop. Sources : https://console.groq.com/docs/speech-to-text et https://ai.google.dev/gemini-api/docs/structured-output.

La matrice de livraison sera complétée après les tests de chaque incrément.

## Premier incrément fonctionnel vérifié

- API Go, PostgreSQL, identité OIDC, autorisation propriétaire, credentials chiffrés, file et leases persistants.
- Interface mobile sombre séparée : lien/upload, bibliothèque, édition arabe puis bilingue, blur/flush, conflits explicites, lecteur et exports privés.
- Clients Groq/Gemini réels implémentés, exercés avec doubles déterministes. Les modèles distants n'ont pas été appelés avec des clés réelles.
- FFmpeg réel : audio requis, FLAC, ASS, Low/High, portrait/paysage/rotation, caractères arabes et français. Rendu arabe inspecté visuellement sur une fixture.
- Import desktop : parser current/priorité/alignement/conflits ; commande dry-run/copie transactionnelle. Aucun projet privé importé.
- Compose, images et runbook préparés ; aucun service vivant activé. Sandbox Bubblewrap refusée sur ce VPS avec les profils actuels : prérequis bloquant avant exploitation des médias non fiables.

Vérifications de cet incrément : tests Go avec `-race`, `go vet`, build TypeScript/Vite, 4 scénarios navigateur Chromium à 390 px, audit npm sans vulnérabilité et govulncheck sans vulnérabilité après mises à jour. Les tests couvrent OIDC signé local, accès intercomptes, Range, versions concurrentes, saturation/reprise avec clé personnelle, leases périmées, génération média, horaires après une heure, import et vrais exports. Une vérification sur téléphone physique et les fournisseurs réels restent à faire.

## Consolidation finale

Migrations SQL numérotées, readiness vérifiant le schéma, imports desktop sans transfert aveugle des confirmations, réutilisation de la traduction importée après nouvelle validation humaine de l'arabe. Test de RPC média authentifié et d'import dry-run/copie/réimport idempotent sur vidéo synthétique, sans appel IA ni modification de snapshots. Tests des deux orientations et de rotation caméra. Le test IME supplémentaire clique l'étape *pendant* une composition et attend son texte final.

Le confinement système et la sortie WARP réels restent à valider ; les refus de namespaces ont été constatés, pas contournés. Le runner local FFmpeg non sandboxé est explicitement réservé aux fixtures synthétiques dans le conteneur de test. Les documents de livraison détaillent ce qui doit être configuré avant une instruction séparée de mise en service.

Les images d'outils et de livraison occupent du disque local ; l'espace libre a baissé pendant les builds (environ 17 Gio lors de la consolidation). Aucun prune global n'a été exécuté. Revalider l'espace réellement disponible, la réservation du stockage et une destination externe pour les backups avant déploiement.

## Résultat final de la mission (21 septembre 2026)

| Phase | Livré et vérifié localement | Validation externe restante |
| --- | --- | --- |
| 0 | Arbre initial propre, fetch, branche `web-vps` sur `183cf9b`, inventaire non destructif | Politique d'exploitation/backup réelle, détails WARP |
| 1 | API Go, migrations PostgreSQL numérotées, React séparé, OIDC signé de test, propriétaires, blur/flush, conflits | Issuer et domaine HTTPS réels |
| 2 | Upload, remplacement de téléchargement par génération, média privé/Range, FLAC, découpage ASR, file et reprise | Sandbox système autorisée ; téléchargement réel via WARP ; compte Groq |
| 3 | Clients HTTP Gemini/Groq, prompts fixes, validation stricte, morceaux 20 min + borne de texte, cooldowns, clés personnelles | Accès Gemini 3.8 Flash/quota du compte ; validation linguistique réelle ; références religieuses humaines |
| 4 | MP4 arabe/français Low/High, portrait/paysage/rotation, rendu visuellement inspecté, interface 390 px, écoute pendant édition | Téléphone physique/clavier mobile natif ; vidéos tutorielles absentes |
| 5 | Images, Compose, OIDC/proxy/secrets configurables, backup/restauration de fixtures, import dry-run/copie/réimport de test | Sauvegarde hors VPS, données privées autorisées, instruction séparée de déploiement |

Commandes exécutées avec succès sur l'arbre livré :

- `make web-test` : **21 tests Go**, sous-cas inclus, avec `-race`, `go vet`, build TypeScript/Vite ; **6 scénarios Playwright Chromium** ; dump/restore PostgreSQL dans une seconde DB isolée. Pas de clé payante ni accès fournisseur réel.
- `make web-build` et `make web-images` : exécutable et deux images construits.
- `make web-audit` : govulncheck sans vulnérabilité trouvée ; npm audit sans vulnérabilité trouvée. Ce résultat n'est pas une certification du système d'exploitation ou du futur réseau.
- `make web-config WEB_ENV=web/deploy/.env.example` ; configurations dev/test/import également validées.
- `git diff --check` ; aucune modification de `ui/`, `server/`, `data/`, `AGENTS.md` ou du handoff ; `main` conservé à `a247734`.

Préflight de l'image média finale, sans réseau, sans port ni données, terminé avec le refus attendu : **sandbox indisponible**. L'application refuse donc de traiter des médias en production dans la configuration actuelle. Aucun contournement de restriction hôte n'a été appliqué.

Images locales préparées (non publiées) :

- `tarjama-web:review` : `sha256:27bb29e8f9af8a15bb29e142addf3c023ffaa145a25fe007ffd49f0769f4a9f0`
- `tarjama-media:review` : `sha256:5d75def21dccf9e664cbf9a0efae33048348eaf0608cd6d200f3534ef7b675be`

État d'exploitation en fin de mission : stacks de test arrêtées ; seuls les trois conteneurs PostgreSQL préexistants figurent dans `docker ps`. Environ **16 Gio libres** après les builds. Aucune stack Tarjama de développement, préproduction ou production active ; aucun changement de proxy/DNS/certificat/pare-feu/SSO/routage. Aucun push Git ni déploiement. Le commit final et son parent constituent la livraison locale sur `web-vps`.

## Préparation du moteur générique vps-preview — 22 septembre 2026

Recette et dossier administrateur : [PREVIEW.md](PREVIEW.md), modèle racine
`deploy.preview.yml`. Les cinq services sont arrêtés par défaut. Trois jobs
explicites : création du rôle DB, migration SQL, diagnostic média. Générateur des
phases arrêté/DB seule/actif sans appel de déploiement, CI manuelle limitée aux
packages GHCR privés déjà vérifiés. Aucune publication ni activation effectuée.

La migration n'exige plus les secrets applicatifs : attente PostgreSQL bornée à
90s, durée globale240s ; l'API/worker ne migrent pas automatiquement. Le worker
n'exige plus le secret OIDC. Préflight Bubblewrap renforcé avec ffprobe/yt-dlp.

Vérifications : 24 tests Go avec race detector, go vet, build frontend et 6 tests
Playwright réussis ; backup/restore synthétique réussi ; 3 tests du rendu de recette
réussis. Deux images reconstruites. Test DB isolé de l'image réelle réussi sous
UID70, rootfs read-only et capabilities retirées : rôle non superuser, bootstrap
répété, migration lancée avant disponibilité de la DB, schéma appliqué. Une
configuration cliente PostgreSQL explicite corrige le chemin du socket initial
vers `/tmp`. Fixtures et conteneurs temporaires supprimés après tests.

Le diagnostic média sous Docker échoue encore sur la création des namespaces
non privilégiés. Aucun profil Kubernetes n'a été qualifié. `validate` et `plan`
refusent le modèle (« Montage non déclaré ou non autorisé ») : le catalogue est
vide, les digests privés et les paramètres réels restent à fournir. Ni validation
complète de la recette ni pull privé GHCR ni intégrations réelles annoncés.

Blocages : images privées et accès de lecture administré ; secrets dédiés ; client
OIDC et capacité réseau correspondante ; sortie WARP HTTP CONNECT ciblée ; sandbox
qualifiée ; capacité physique et sauvegarde/restauration des PVC. L'emplacement
`atelier` est resté à 0 replica, 0 ready, sans révision Tarjama activée.

## Images locales importées — 22 septembre 2026

Le propriétaire a abandonné GitHub Actions. Le workflow de publication a été
archivé hors du répertoire actif et sa désactivation poussée sur `web-vps`
(`e08bba3`). Vérification GitHub : un seul run, déjà terminé en échec de contrôle
de visibilité ; aucun run actif à annuler. Aucun nouveau workflow déclenché.

Images reconstruites localement pour Linux amd64 depuis `e6a0cf3` avec contexte
restreint, puis importées par `vps-preview image-import` sous les noms `web` et
`media`. Les deux appels ont réussi, sans démarrage, avec politique Never.
Les références exactes sont épinglées dans `deploy.preview.yml` ; preuve de
correspondance commit/image/catalogue dans `web/deploy/preview/images.lock.json`.
Le générateur accepte les images locales et remplace les anciennes références.
Quatre tests de rendu et le test DB isolé sur la nouvelle image ont réussi.

`validate` et `plan` relancés sur la recette mise à jour : refus « Capacité réseau
non enregistrée ». Les prérequis OIDC/WARP/sandbox ne sont pas inventés pour
contourner ce refus. Le catalogue confirme les secrets internes, Gemini et Groq,
mais ne valide pas les API fournisseurs. Stockage et sauvegardes restent à qualifier.
`atelier` reste arrêté, cinq services désactivés dans la recette, aucun job lancé.

## Proxy WARP renseigné — 22 septembre 2026

La recette désactivée et ses paramètres publics utilisent maintenant
`WARP_HTTP_PROXY=172.31.250.2:40001` et la seule capacité de sortie `warp-downloads`
pour egress. IPv4/port confirmés dans le catalogue administrateur. Le média reste
limité au proxy egress ; aucune sortie publique ajoutée. Le générateur remplace
également les paramètres WARP déjà renseignés pour éviter de conserver une ancienne
adresse à la prochaine génération.

Code média/egress inchangé : protections SSRF, IP publique épinglée, CONNECT443,
TLS/SNI et absence de repli direct conservés. Quatre tests de rendu et le test
existant `TestSSRFAndWARPFailClosed` réussis ; aucune requête réelle au proxy ou
à YouTube. Les images importées restent valables, aucun code embarqué modifié.

`validate` et `plan` réexécutés : refus « Profil de sandbox non enregistré ».
Ne pas en déduire que les autres prérequis sont validés. OIDC, sandbox média,
téléchargements YouTube réels, fournisseurs et stockage/sauvegardes restent à
qualifier. Les cinq services restent désactivés ; `atelier` est à0 replica/0 ready.


## Moteur d'opérations isolées — 23 septembre 2026

Intégration applicative du service administré `vps-jobs` : client HTTPS avec CA
privée, aucun credential Kubernetes/Docker, worker orchestrateur, outils dans des
opérations distinctes. Migration002 pour clés/IDs distants, définitions avec
empreintes, caches durables, reprises Range et clôture après annulation. Un résultat
périmé ou expiré n'est pas relancé implicitement. Les contrôles génération/version/
lease encadrent cache et publication métier. Les intentions de nettoyage survivent
à la suppression du projet. Le moteur Bubblewrap conserve ses contrôles existants.

Les profils supplémentaires et l'exécuteur fixe sont livrés pour revue, **pas
installés**. FLAC16kHz/16bits et offsets milliseconde ; normalisation et exports
arabe/français Low/High ; pistes YouTube récupérées séparément avant assemblage
sans relais. Le filtre SSRF/TLS/WARP est conservé ; son raccordement au relais
administré et les vrais téléchargements restent à qualifier.

Vérifications sur les sources de cet incrément : **34 tests Go** avec `-race`,
`go vet`, build frontend, **6 scénarios Playwright**, dump/restore PostgreSQL
synthétique, **4 tests de recette**. Dix nouveaux tests Go couvrent notamment
pertes de réponses et transferts, reprise/Range, intégrité, génération et lease,
annulation après suppression, expiration, réessai explicite, TLS/redirections,
paramètres et vraie chaîne FFmpeg avec un double HTTPS du broker. Aucun appel au
service réel, à YouTube ou aux API fournisseurs avec des credentials réels.

La recette passe à quatre services désactivés (web, worker, egress, DB) et deux
jobs explicites (bootstrap-db, migrate). Le secret administré `isolated-jobs`
est monté uniquement sur le worker. L'ancien service média et son job Bubblewrap
sont retirés de cette recette parce que les outils ne s'y exécutent plus.

Dossier : [ISOLATED_JOBS.md](ISOLATED_JOBS.md) et
[propositions de profils](../deploy/preview/isolated-profiles.proposal.json).
Le schéma JSON réel des réponses doit encore être confirmé par des exemples
anonymisés administrateur. Les autres prérequis restent : enregistrement des
profils, relais filtré, qualification depuis K3s, tailles/ressources/rétention
(plafond1000 IDs), OIDC, fournisseurs, persistance et sauvegardes.
`atelier` a été vérifié à0 replica/0 ready. Aucun déploiement ni profil modifié.


Images construites depuis **f897ac635f1e92d4a46bbbac59c79def9bf1b1ed**, importées
le23septembre ; références exactes et Docker IDs dans `images.lock.json`, source
vérifiée contre les labels de révision. Le dossier des profils indique la même
image média immuable, sans l'installer. Tests de l'image finale réussis en Docker
network-none, UID10002, rootfs read-only, capabilities retirées et NNP : probe,
FLAC fractionnaire et normalisation MP4 sur fixture. Test DB de l'image finale
réussi : bootstrap répété, rôle non superuser et migrations001/002 attendues.

`validate` et `plan` relancés après imports : tous deux refusent **« Montage non
déclaré ou non autorisé »**. Le catalogue ne contient toujours pas `tarjama-oidc`,
que la recette référence ; les paramètres publics OIDC restent des placeholders.
Aucune validation complète de recette ou qualification réelle du broker annoncée.
Les quatre services restent désactivés, aucune tâche d'exploitation lancée.


## Recette désactivée validée après retour administrateur — 23 septembre 2026

Paramètres publics confirmés : issuer `https://auth.runagen.com`, client
`preview-atelier-tarjama`, capacité `oidc`, secret référencé `tarjama-oidc` monté
uniquement sur l’API. Le catalogue confirme OIDC, WARP et isolated-jobs. Les huit
profils, le relais vers `pv-egress:8092` et les contrôles TLS/SSRF/WARP sont rapportés
installés/testés par l’administrateur ; aucun réglage d’infrastructure changé ici.
Les réponses JSON confirment le contrat utilisé par le client applicatif.

Le générateur lit désormais un modèle séparé `web/deploy/preview/deploy.template.yml`,
avec les paramètres publics versionnés `inputs.json`. `deploy.preview.yml` contient
le vrai script de bootstrap, les images importées attendues, zéro placeholder et
quatre services désactivés. Un ancien rendu actif n’influence plus le rendu arrêté.

**Cinq tests de rendu réussis**, intégrité du script intégré et correspondance des
images avec le catalogue vérifiées. **validate et plan réussis**, même révision
calculée `d53694da65c63fca`, `applied: false`. Statut0 replica/0 ready. Aucun build
supplémentaire nécessaire : backend/frontend et Dockerfile inchangés depuis les
images testées de `f897ac6`. Aucun déploiement, bootstrap, migration ou appel réel
aux fournisseurs/YouTube pendant cette préparation.

La validation de recette ne qualifie ni les parcours applicatifs ni les tailles
maximales. Petites fixtures uniquement pour les futurs premiers essais : environ
17,3Gio libres mesurés par l’administrateur, réserve broker8Gio, PVC14+2Gi qui ne
réservent pas physiquement le disque. Sauvegarde OVH retenue par le propriétaire,
fraîcheur non recontrôlée ; copie indépendante reportée, restauration applicative
encore à qualifier. Le compte de test reste désactivé à sa demande : aucune action
humaine supplémentaire sollicitée maintenant. L’activation attend une instruction distincte.
