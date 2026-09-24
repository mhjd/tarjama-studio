# Routes projet et étapes — 24 septembre 2026

| Vue | URL |
| --- | --- |
| Bibliothèque | `/projets` |
| Création | `/projets/nouveau` |
| Clés personnelles | `/compte/cles` |
| Import, téléchargement, transcription, nettoyage | `/projets/<id>/preparer` |
| Correction humaine arabe | `/projets/<id>/corriger` |
| Traduction automatique et relecture française | `/projets/<id>/traduire` |
| Export après validation | `/projets/<id>/exporter` |

L'état du serveur décide de la route canonique. Une URL ne change pas l'état du
projet : une étape future, périmée ou inconnue revient à l'étape courante sans
appeler advance/export. Le même contrôle s'applique après rechargement et aux
entrées de l'historique. Les URLs n'ouvrent que le projet autorisé par l'API ;
aucune donnée projet ne figure dans la page HTML commune.

Le polling et les actions de l'éditeur actualisent l'adresse avec replaceState,
pour éviter d'empiler des étapes de traitement automatiques dans l'historique.
Les navigations entre projets, bibliothèque et paramètres utilisent pushState.
Les brouillons et le titre sont sauvegardés avant un changement de page ; si le
retour arrière échoue à sauvegarder, la route et l'éditeur sont rétablis. Les
réponses obsolètes d'une navigation lente sont ignorées. Le fichier d'import en
mémoire est associé à l'ID de son projet, pas au prochain éditeur ouvert.

La destination après connexion est conservée dans sessionStorage uniquement si
elle correspond à une route interne connue. Aucun retour externe n'est accepté.
Le SSO réel/MFA n'a pas été rejoué : l'utilisateur l'a déjà confirmé ; les tests
utilisent l'identité de développement dans l'environnement isolé.

Serveur : fallback HTML uniquement sur les routes applicatives nommées. Les
ressources absentes et les erreurs API conservent leur statut HTTP, et les
mutations restent soumises aux permissions et validations serveur existantes.

Validation :

- 30 tests Playwright réussis : liens directs, connexion locale, rechargement,
  back/forward, étape forcée par URL, mise à jour par polling, accès privé,
  brouillon conservé en cas de panne, titre sauvegardé sans blur. Les parcours
  complets avec exports synthétiques sont aussi rejoués sur les trois formats.
- Backend exact de livraison : `go test -race -count=1 ./...` et `go vet ./...`
  réussis, dont les routes HTML et le refus API de sauter correction/relecture.
- TypeScript/Vite et build de l'image réussis. Aucun appel fournisseur réel requis.

Image web : `preview.local/atelier/web@sha256:285b7a39d4f9a4450a77ab9c7de3a40bbc86ebd9c1ba32b136d4c443963ea3a8`.
Recette : `web/deploy/preview/active-routes-20260924.yml`.
Validate/plan réussis : `88464d52b1a949ee`. Seule l'image web change ; worker,
stockage, secrets et protections restent identiques. Aucun job ni migration lancé.
La version du backend de recherche reste exclue de cette livraison.

Déploiement confirmé ; quatre services prêts, API démarrée sans erreur.
