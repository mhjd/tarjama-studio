# Reprises automatiques : affichage utilisateur

Décision du 26 septembre 2026 : une réponse IA invalide récupérable ne doit
pas afficher un diagnostic technique dans le parcours. Le traitement est repris
automatiquement, avec les bornes et validations existantes.

- Les motifs précis (JSON, alignement, réponse incomplète…) restent dans les
  journaux serveur avec le job et le numéro de tentative.
- Pendant la courte attente, l'interface affiche « En attente — reprise
  automatique », puis « Traitement en cours… » lorsque le worker reprend.
- La prise d'un job efface le message de la tentative précédente ; elle conserve
  progression et compteur de tentatives. Les étapes de téléchargement continuent
  à publier leurs messages habituels.
- Après épuisement des tentatives, un message explique que le traitement n'a pas
  pu se terminer, confirme la conservation de la progression et permet de réessayer.
- Les erreurs actionnables (clé refusée, configuration) et les attentes de quota
  restent visibles. Aucun succès ni pourcentage artificiel n'est ajouté.

Validation locale : tests de reprise jusqu'au succès ou à l'épuisement, conservation
des morceaux, nettoyage du message à la reprise et scénario Playwright
activité → attente → activité → échec définitif, sans rendre le texte brut éditable.
Fournisseurs simulés ; aucun appel payant nécessaire.

`make web-test` réussi : tests Go avec détection des courses, `go vet`, build
TypeScript/Vite, 46 tests Playwright (dont les parcours MacBook, Pixel et iPhone),
sauvegarde/restauration de la base de test. Journal local :
`web/.cache/automatic-recovery-tests.log`.

Déployé le 26 septembre à 08:12 UTC après le signal explicite du propriétaire.
Code applicatif testé : `b93a8e43f1d1cd9f9b631a11ed46abb2666d1a8a`.
Recette : `web/deploy/preview/active-automatic-recovery-20260926.yml`.
Révision : `bc8dfb4c73dabc15`. Images locales API/worker construites depuis ce
commit, importées par digest ; corpus et image de qualification inchangés.

Sauvegarde réussie avant remplacement : `pv-job-backup-79e78970`, fichier
`/storage/backups/pre-archive-session-20260926T081118Z.dump`, empreinte SHA-256
`e58d452e2f7268c3736d2611e197af2fe96ab4f583cad1822022d633e6985594`.
Pas de changement de schéma, pas de migration exécutée.

Quatre services prêts ; worker avec trois outils locaux et Luna configuré.
Qualification `pv-job-preview-check-70bd5867` réussie : HTTP/readiness,
contrôle d'accès anonyme, démarrage OIDC/PKCE, taille des en-têtes et TLS
de la passerelle. Le parcours MFA complet et les appels IA réels ne sont pas
relancés pour cette correction. Les 46 tests UI sont ceux du commit préparé.
Preuves : `web/deploy/preview/evidence/automatic-recovery-20260926/`.
Retour arrière possible vers la recette `504c3b05c5075793`, sans restauration
des données ; aucun changement de modèle, de droits ou de réseau dans cette livraison.
