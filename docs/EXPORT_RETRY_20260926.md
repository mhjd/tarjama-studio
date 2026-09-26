# Export Low : clic sans effet après annulation

Le diagnostic en lecture seule du 26 septembre confirme, pour « Sirat un nabi
episode 4 », un export `export_fr_low` annulé sur la version courante 6, à 33 %.
L'export réussi antérieur concerne la version 5 : il ne représente pas le texte
actuel. Aucun défaut d'infrastructure n'est établi par cet incident.

Le bouton « Créer la vidéo » soumettait toujours POST /exports. L'insertion
idempotente retrouve la même combinaison projet/type/version/génération et ne
crée pas une autre tâche. C'est la bonne protection contre les doublons, mais
l'interface n'expliquait pas ce résultat ni ne relançait la tâche annulée.
L'action « Reprendre » séparée utilisait déjà le bon endpoint.

Le bouton principal tient désormais compte de l'export de la qualité sélectionnée
et de la version actuelle :

- absent : créer ;
- annulé : « Reprendre la création », via le endpoint de retry existant ;
- échec : « Réessayer la création », même endpoint ;
- en file, en cours ou en attente : création désactivée, état explicite ;
- réussi : état prêt, lien de téléchargement existant conservé.

Le flush des modifications reste préalable. Un changement de version pendant
le flush ne doit pas reprendre une ancienne tâche : l'API contrôle les conditions
d'une nouvelle création. Aucun changement de données utilisateur, de backend,
de schéma, de profil média ou de privilèges. Aucun export réel du propriétaire
n'est relancé par l'agent ; la reprise reste son action explicite.

## Vérification

Les régressions Playwright couvrent annulation et échec, le POST retry réel du
frontend (réponse serveur simulée), l'absence de POST /exports concurrent,
l'état désactivé pendant la requête, l'attente, le succès et le changement Low/High.
Les parcours existants utilisent PostgreSQL isolé, IA de fixture et FFmpeg réel.
Ces tests ne prouvent pas la réussite du prochain encodage en production.

Le diagnostic temporaire utilise un job PostgreSQL en lecture seule avec délai
borné, sans exposer de secrets. La recette finale le retire. Preuves dans
`web/deploy/preview/evidence/export-retry-20260926/`.

Résultat : build TypeScript/Vite réussi, **19 tests Playwright réussis**, dont
les parcours complets aux formats MacBook Air 15, Pixel 6 et iPhone 15.
La source vidéo et les réponses IA sont synthétiques, l'export local est réel.
