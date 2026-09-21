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
