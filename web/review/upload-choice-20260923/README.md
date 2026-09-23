# Entrées vidéo exclusives et incident média — 23 septembre 2026

La création conserve deux choix : lien ou fichier. Dans un projet alimenté par
un lien, aucun import n'est proposé pendant le téléchargement, sa préparation
ou l'attente d'un réessai. L'utilisateur peut annuler puis importer dans le même
projet, ou importer après échec. L'attente dispose maintenant du bouton Annuler.

Le serveur applique aussi cette exclusion sous verrou de projet. Le verrou global
d'import est acquis avant toute mutation : un deuxième upload ne peut plus
invalider la génération du premier avant d'être refusé. Le déverrouillage utilise
un contexte indépendant de la connexion HTTP interrompue. Les vérifications de
génération/version/lease empêchent toujours une publication tardive du lien.

Captures Playwright synthétiques à 390 × 844, inspectées visuellement :
[download actif](link-active.png), [import après échec](file-fallback.png).
Elles ne constituent pas un nouveau parcours fournisseur réel.

## Incident observé sur atelier

Deux téléchargements réels, avec puis sans paramètres playlist, attendaient à
33 % (deux étapes sur six). Audio et vidéo étaient déjà récupérés durablement
et acquittés. Les enregistrements `tarjama-mux-v1` n'avaient aucun identifiant
distant : le refus précédait l'exécution de FFmpeg. Le client URL conserve
l'identifiant vidéo et retire les paramètres playlist ; cette hypothèse est écartée.

Une journalisation bornée a confirmé HTTP 429 sur POST, sans texte distant,
URL, clé, transcription ou token dans les logs. Le courtier ne précisait pas
une catégorie reconnue dans la réponse ; ne pas présenter un message disque
exact comme s'il avait été fourni par le serveur.

Le disque disposait de 10 453 630 976 octets libres, alors que le courtier conserve
une réserve de 8 Gio en plus des besoins admis de chaque profil. Suppression
ciblée par identifiants des caches de compilation Tarjama obsolètes uniquement :
12 334 264 320 octets libres ensuite ; nettoyage du cache Go local de test
puis 13 503 844 352 octets libres (mesures ponctuelles). Aucun projet, fichier
utilisateur, image finale, sauvegarde ou paramètre de protection supprimé/modifié.
Pas de nettoyage global Docker ni de suppression des images de retour arrière.

Sans nouveau téléchargement ni réessai manuel, l'assemblage du second essai a
ensuite démarré, terminé avec code 0, été récupéré/acquitté, puis la vérification
source a réussi et la normalisation a démarré (66 %). Cette reprise après libération
de disque identifie la pression de stockage comme cause opérationnelle du blocage.
Dernière observation : le second essai est en normalisation à 66 %, le premier
reste en attente derrière le worker unique. Le téléchargement complet des deux
essais et leur transcription ne sont pas annoncés comme terminés. Voir
[la lecture réelle des états](media-recovery.log).

## Qualification et livraison

- `make web-test` : Go race/vet, TypeScript/Vite, 14 tests Playwright, sauvegarde
  et restauration de fixtures PostgreSQL : tous réussis (14/14 Playwright).
- Backend exact de livraison testé séparément : base `b69c700`, modifications
  explicites `api.go`, `studio_test.go`, `isolated_client.go`, `isolated_test.go`
  et commande de diagnostic en lecture seule. Go race et vet réussis.
- Le test de refus 429 vérifie la reprise et l'absence de détails privés dans
  les logs. Les tests d'import vérifient les états actifs, échec/annulation,
  génération inchangée après refus, concurrence et publication tardive rejetée.
- Aucun changement du modèle/prompt/recherche en production. Le backend candidat
  présent ailleurs dans HEAD n'a pas été activé par cette livraison.

Construction : `make web-upload-release-build`. Le script prépare un contexte
explicite sans secrets ni données utilisateurs. Les futures livraisons UI seules
conservent ce correctif API via la base de `make web-ui-release-build`.

Recette active : `web/deploy/preview/active-upload-20260923.yml`.
Révision : `da745224a015087f` ; validate/plan puis déploiement autorisé réussis.
API/worker et diagnostic :
`preview.local/atelier/web@sha256:99ed8d1d4bd03b59f6d5d592c07aa20d7de0410f31ae186a860f3a97b2c291e5`.
Docker image ID (index OCI) : `sha256:579f6c361955a85fd2f977972a676b795c814cc606325d4b60a03071141243c6`.
Le digest `87e1b479…` visible dans le log de build est celui de la configuration,
pas le Docker image ID.
Les profils média administrés, egress et schéma SQL sont inchangés.

Le job explicite `media-diagnostic` utilise une session SQL en lecture seule et
uniquement des GET au courtier : états récents, empreintes/présence de cache et
statuts distants, sans déclencher/réessayer/annuler/acquitter les opérations.
Exécution bornée à 90 s ; aucune route de diagnostic exposée au navigateur.

## Exploitation à conserver

La marge physique du VPS est partagée avec les builds et dépasse les besoins
stricts des seuls fichiers utilisateur. La taille PVC n'est pas une réservation.
Avant une nouvelle série de builds, contrôler l'espace libre et conserver une
marge au-delà des 8 Gio du courtier **plus** les réservations maximales des profils,
les imports d'images et les compilations. Ne pas réduire cette protection pour
faire passer un travail. Si les caches précisément identifiés ne suffisent pas,
faire revoir capacité/rétention par l'administrateur ; ne pas supprimer les
projets, sauvegardes ou images utiles au retour arrière.

Limite du diagnostic administré observée : `vps-preview logs --component` retourne
les trois derniers éléments de la liste de pods, sans tri chronologique. Avec des
suffixes UUID, un diagnostic récent peut manquer alors que son pod a réussi.
La sélection doit être corrigée par l'administrateur (tri par date de création
avant limitation), sans ouvrir d'accès Kubernetes à l'application. Aucun code
infrastructure n'a été modifié pendant l'enquête.
