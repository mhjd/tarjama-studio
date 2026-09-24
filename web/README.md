# Tarjama web

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

### Découpage texte et modèle (23 septembre 2026)

Correction et traduction utilisent Gemini 3.5 Flash-Lite. Les chunks visent
20 minutes, aux frontières des segments, avec des garde-fous de 600 segments et
64 000 octets arabes. Le budget de réponse est de 32 768 tokens ; une réponse
tronquée ou mal alignée est toujours refusée. La limite temporelle est une cible,
les entrées denses peuvent être coupées plus tôt. Les appels restent bornés à
5 minutes et annulables. Le découpage Groq demeure indépendant (10 minutes).
Les anciens morceaux validés conservent leurs frontières ; seule la suite encore
à traiter adopte les nouveaux plafonds. Les quotas du compte ne sont pas codés en
dur : les 429 conservent la file d’attente et la reprise automatique.
