# Blocs de dix minutes et parcours réels — 24 septembre 2026

La correction arabe et la traduction ciblent désormais **10 minutes au maximum**,
aux frontières des segments (commit `b993a33`). Gardes inchangées : 600 segments,
64 000 octets arabes, réponse de 32 768 tokens. Un sous-titre n'est jamais coupé.
Les réponses déjà enregistrées gardent leurs anciennes frontières ; la suite
adopte la nouvelle limite. Les reprises réduisent les blocs non terminés et
conservent les résultats validés. L'ASR garde sa politique distincte de dix minutes
avec chevauchement. Aucun changement de modèle : DeepSeek V4.1 Flash/OpenRouter
pour le texte, Groq pour la transcription ; outils Parallel disponibles.

## Vérifications

- Go avec détection de courses, `go vet`, build TypeScript/Vite : réussis.
- 39 tests Playwright locaux : réussis, dont étapes verrouillées, routes,
  sauvegardes, suivi, raccourcis, import exclusif et responsive. Les fournisseurs
  de cette suite sont des fixtures ; ce n'est pas une qualification fournisseur.
- Tests PostgreSQL de reprise : un ancien bloc réussi de 20 minutes est conservé ;
  les blocs restants suivent les dix minutes, sans perte ni répétition d'IDs.
- Sauvegarde/restauration de la base de fixtures : réussie.
- Nouveau diagnostic : catégorie fixe avant ACK/GC, lecture limitée à 32 Kio et
  cinq secondes ; aucune sortie brute d'outil dans les logs applicatifs.

Les [journaux](../web/review/ten-minute-20260924/) conservent les résultats.
Le scénario réutilisable est `web/review/record.mjs`, préparé par
`make web-review-prepare` (URL, format, run indépendant). L'API/worker de
qualification emploie un schéma et un répertoire distincts, sans compte ni cookie
SSO réel. OIDC/MFA public reste inchangé et a été confirmé par le propriétaire.

## Clip court réel

Source : [reportage arabe sur les biais de l'IA](https://www.youtube.com/watch?v=gbrDbQVYDuQ),
**138 867 ms**, 28 segments. Téléchargement via WARP et opérations média administrées,
transcription, correction, édition arabe, sauvegarde/rechargement, traduction,
édition française, sauvegarde avant validation, export High français, téléchargement
par clic, ouverture et lecture du MP4 exporté. Aucun résultat fournisseur simulé.

| Format CSS émulé | Run | Résultat | Temps du parcours |
|---|---|---|---|
| MacBook Air 15 M4, 1440 × 932 | `tenmin_short3` | PASS | 319 s |
| Pixel 6, 412 × 915 | `tenmin_pixel1` | PASS | 360 s |
| iPhone 15, 393 × 852 | `tenmin_iphone1` | PASS | 313 s |

Chromium Linux : ce ne sont pas des appareils physiques ni une qualification de
Safari. Les sous-titres restent masqués pendant les phases automatiques. Le test
contrôle que l'export est inaccessible avant la traduction et que la navigation
revient en haut. Les retouches survivent au rechargement. Les captures et vidéos
incluent les attentes réelles. Les champs de texte français des échantillons
consultés correspondent à l'arabe ; cela ne certifie pas l'absence de toute erreur
d'ASR, de traduction ou de synchronisation sur des contenus quelconques.

Les fichiers, leurs tailles et SHA-256 sont consignés dans les manifests sous
`/storage/ui-review-RUN/artifacts/`. Les téléchargements High portent le nom
`tarjama-gbrDbQVYDuQ-FORMAT-fr-high.mp4`, les enregistrements
`parcours-FORMAT.webm`. Le JSON complet des sous-titres et les captures sont conservés.
Les fichiers binaires ne sont pas disponibles dans le workspace agent : le CLI
administré ne propose pas de copie depuis le PVC. Ne pas confondre cette preuve
avec les anciennes vidéos synthétiques locales de quatre secondes.

## Échecs conservés et blocage du test long

1. `tenmin_short1`, ancien clip France 24 de 1 min 55 : téléchargement vidéo réussi,
   audio échoué, code 1. La réconciliation avait déjà acquitté l'opération :
   diagnostics HTTP 404. La cause exacte de cet échec n'est pas établie.
2. `tenmin_short2` : téléchargement, ASR, correction et traduction réussis. Le
   recorder échouait sur `textarea` = zéro pendant la traduction : il comptait le
   champ du titre. Assertion corrigée pour les seuls champs arabe/français ;
   aucun masquage supplémentaire du titre dans l'application.
3. `tenmin_short3` : reprise complète sur le nouveau clip de 2 min 19, PASS.
4. `tenmin_hour1`, lancé seulement après ce PASS, sur
   [une conférence arabe annoncée à 1 h 00 min 10](https://www.youtube.com/watch?v=7TLnx8DIu4c) :
   vidéo téléchargée, **audio échoué**. La nouvelle lecture avant nettoyage
   confirme `tool_detail_hidden` : l'exécutable isolé masque stderr derrière
   « Outil isolé en échec ». Opération `ada7f707ecc6cb292ef161b3a1363d73`,
   job applicatif `54c557ae29f1edbf29c077f5857db7b4`, 19:44:31 UTC.

Le test long n'a atteint ni la transcription ni les blocs IA. Il n'est **pas
qualifié**. Rien ne prouve un problème de quota fournisseur, de playlist, de disque
ou une cause YouTube précise. Le téléchargement court ayant réussi ensuite,
l'incident n'est pas systématique. Aucune protection ni sortie directe de secours
n'a été ajoutée. La [passation administrateur](TEN_MINUTE_ADMIN_HANDOFF_20260924.md)
prépare le diagnostic manquant et la récupération des véritables artefacts.

## Images

API/worker déployé : source `1b443ec`,
`preview.local/atelier/web@sha256:49d556701715dae8dc6f89b40ca86a075e6704936860fae959e627c8738c640f`.
L'image privée de qualification partage ce backend et le frontend :
`preview.local/atelier/web@sha256:43cade2f6d82a75536f0ae8b124e18042a46aa6df012d0a20b8a57a0bf952a1d`.
La future image média de diagnostic est distincte : son import ne modifie aucun
profil administré. Aucun changement SQL n'est requis pour cette livraison.

## Mise à jour de l’aperçu

Recette `web/deploy/preview/active-ten-minute-20260924.yml`, révision
`e11607797eb8ae08`, appliquée le 24 septembre 2026 après sauvegarde réussie
`pv-job-backup-54a06235` :
`/storage/backups/pre-ten-minute-1b443ec-20260924T200253Z.dump`,
SHA-256 `b13f6163c3b48de5c8f9c68584a95386c607908b10aec92e0c07df19e17d24ad`.
API, worker, base et egress prêts. Le service privé de qualification a été arrêté ;
les artefacts persistants sont conservés. Aucune migration SQL n'était nécessaire.
Les traitements en cours gardent les blocs déjà validés.

URL : https://atelier.preview.runagen.com. Révision précédente préparée :
`d77adae214d787e5`, mêmes données et anciens pins API/worker. Un retour arrière
ne restaure ni données ni schéma.

Qualification après déploiement : `pv-job-preview-check-3bc7c858` réussi,
HTTP/démarrage OIDC et passerelle TLS (1,05 s). Ce contrôle n'effectue ni MFA
ni nouvelle génération IA ; les parcours réels sont ceux décrits ci-dessus.
