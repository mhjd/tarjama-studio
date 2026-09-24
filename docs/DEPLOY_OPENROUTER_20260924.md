# Bascule atelier vers OpenRouter / Parallel — 24 septembre 2026

Source applicative testée : `eb4f510`, branche `web-vps`. Déploiement demandé
explicitement par le propriétaire après la qualification du client OpenRouter.

## État final — reprise réussie à 11:38 UTC

**Application en service** sur https://atelier.preview.runagen.com.
Révision `08e1b05c7bd437da`, code applicatif `eb4f510`.
Les quatre services (web, worker, PostgreSQL, egress) sont Running/Ready.
Le blocage décrit plus bas est un historique résolu, pas l’état courant.

Après retour administrateur (DiskPressure=False, aucune taint, DB/egress prêts,
images réimportées), les étapes ont été exécutées dans l’ordre :

- Nouvelle sauvegarde `pv-job-backup-f372eb7f` : Succeeded.
  Fichier `/storage/backups/pre-openrouter-eb4f510-20260924T113720Z.dump`,
  SHA-256 `e1c3010f3f255eb6426213268af56a2a9a54bdcd969d579841d0efe81382514b`.
  Table des matières vérifiée ; aucune restauration complète annoncée.
- Migration `pv-job-migrate-d8385b7d` : Succeeded, avant activation web/worker.
- Recette active validée, planifiée puis appliquée : aucun volume supprimé.
- Qualification `pv-job-preview-check-2e3aa200` : Succeeded, tous les sous-tests PASS
  en 5,22 secondes : readiness/HTTP, refus anonyme d’accès aux projets, démarrage
  OIDC/PKCE/cookie sécurisé, TLS passerelle, vrais appels DeepSeek cleanup et
  translate (OpenRouter HTTP 200 et validation stricte des segments).
- Logs : API prête, aucun message d’erreur du worker courant ; statut final prêt.

Le worker utilise OpenRouter et les outils serveur Parallel, sans secret Gemini.
Le parcours complet MFA, un nouveau téléchargement YouTube et un export média
n’ont pas été rejoués dans ce contrôle de bascule. Le test réel Search/Fetch
précédent reste documenté dans le rapport de qualification du client. Les trois
corpus locaux et le panneau de remarques restent à implémenter ; cette mise en
service n’en annonce pas la disponibilité.

Preuves de reprise : `web/deploy/preview/evidence/openrouter-resume-20260924/`.

## Images locales

- Application complète (API/UI, worker et filtre egress) :
  `preview.local/atelier/web@sha256:b93f5b42a91637c67a63de67be034ea1652e5ac60e3e7c82fed3d762096314d3`.
- Qualification dédiée :
  `preview.local/atelier/web@sha256:6e212704818bc9f08258e88d21c55793ce7e311c75c5a442510a2610497a620b`.

Images construites sur le VPS, importées via `vps-preview`. Aucun GHCR ni Actions.
Les anciennes images de retour arrière et les volumes restent conservés.

## Ordre de bascule

Les anciennes clés Gemini ne sont pas réinterprétées. Le worker reçoit désormais
`openrouter/api_key` à la place de `tarjama-gemini/api_key`; Groq et les opérations
média isolées restent inchangés. OIDC reste limité à l’API et les secrets IA au
worker de confiance. Aucun changement de protection du VPS.

1. Appliquer `web/deploy/preview/paused-openrouter-20260924.yml` : DB et egress
   demandés actifs, API et worker arrêtés. Ne pas démarrer un ancien worker Gemini
   pendant la migration ni une nouvelle UI avec l’ancien backend.
2. Attendre la DB prête. Lancer explicitement `backup` et vérifier son succès.
   La tâche crée un `pg_dump -Fc` exclusif dans `/storage/backups/`, vérifie sa
   table des matières et imprime son SHA-256. C’est une copie DB locale avant
   migration, pas une sauvegarde hors VPS ni un test de restauration complet.
   Les médias ne changent pas pendant cette migration.
3. Lancer explicitement `migrate`, vérifier le succès. `003_openrouter.sql` ajoute
   le fournisseur à la contrainte de credentials dans la transaction de migration.
   Les données/chiffrements antérieurs sont conservés.
4. Appliquer `web/deploy/preview/active-openrouter-20260924.yml` et attendre les
   quatre services prêts. La recette complète a été validée et planifiée.
5. Lancer `preview-check` : readiness, routes HTTP, refus anonyme des projets,
   démarrage OIDC/PKCE/cookie sécurisé, TLS passerelle, nettoyage et traduction
   réels DeepSeek via OpenRouter. Cela ne teste pas la connexion MFA du propriétaire
   ni un nouveau parcours média complet.

Commandes de reprise (attendre le succès de chaque étape) :

```sh
make web-preview-status
make web-preview-run PREVIEW_JOB=backup
make web-preview-run PREVIEW_JOB=migrate
make web-preview-deploy PREVIEW_FILE=web/deploy/preview/active-openrouter-20260924.yml
make web-preview-status
make web-preview-run PREVIEW_JOB=preview-check
```

Ne pas relancer un job encore actif. La migration et les jobs ne partent jamais
implicitement. Une recette acceptée ne signifie pas que les services sont prêts.
En cas de rollback, la migration additive reste en place ; le rollback ne restaure
pas les données. Ne pas revenir au modèle Gemini sans nouvelle décision produit.

## Historique — incident de démarrage préexistant (résolu)

Au premier `status`, avant build/déploiement, la révision `c30b28bb3e20861b`
présentait déjà DB, egress, worker et web à zéro service prêt, avec leurs nouveaux
pods en `Pending` et d’anciens pods terminés. Aucun motif exploitable dans le
champ `reasons`; les logs de la DB ne sont pas récupérables. Le redéploiement
intermédiaire `87a875e28312ffa2` est accepté, mais DB/egress restent initialement
`Pending`. Aucune migration n’est lancée dans cet état.

Le disque était occupé à 88 %. Un nettoyage ciblé des enregistrements de cache
de compilation Tarjama récupérables, identifiés individuellement, a rendu environ
3 Go et ramené l’occupation à 85 % (~16 Go libres). Aucun prune global, image,
volume ou donnée utilisateur supprimé. Le lien causal avec l’attente Kubernetes
n’est pas établi par ces seules observations.

Preuves : `web/deploy/preview/evidence/openrouter-20260924/`.
Contrôle final à 10:17 UTC : après 330 secondes de surveillance supplémentaire,
DB et egress restent à zéro replica prêt. Aucun démarrage de la nouvelle
application n’est annoncé.

La sauvegarde a été soumise (`pv-job-backup-ae8b4130`) mais son pod est resté
`Pending` sans logs pendant la fenêtre observée. Ne pas la considérer comme
réussie. La migration 003 n’a pas été lancée et la recette finale n’a pas été
appliquée. API et worker restent volontairement désactivés dans la recette
intermédiaire ; DB et egress demandés actifs sont en attente.

## Historique — diagnostic transmis pour l’attente de démarrage

> Atelier était déjà indisponible avant cette mise à jour. Après réapplication
> de la recette, `pv-db-7d97746b76-x4xdg` et `pv-egress-6f4c89d9d8-wjbqg` restent
> Pending sans motif exposé par `vps-preview status`. Un job de sauvegarde a
> également été bloqué avant exécution. Merci de relever les événements de
> scheduling et les conditions/taints du nœud, notamment une éventuelle pression
> disque. Environ 16 Go libres après nettoyage ciblé des caches de build Tarjama.
> Aucune protection à abaisser, aucun volume à supprimer. La recette intermédiaire
> est `87a875e28312ffa2`; garder web/worker arrêtés jusqu’au succès de backup puis
> de migrate. Le projet pourra ensuite activer la recette finale `08e1b05c7bd437da`.

Un accès HTTPS depuis l’environnement agent a également reçu un refus de
connexion ; le parcours authentifié n’a donc pas pu être qualifié. Ce test
local ne suffit pas à isoler la cause de l’indisponibilité de la passerelle.

La cause précise n’est pas accessible avec les sorties du courtier disponibles.
Ne pas annoncer un défaut de stockage, de CNI ou de PostgreSQL comme démontré.
