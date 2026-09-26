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

**Non déployé : attendre le signal explicite du propriétaire avant toute mise en service.**
