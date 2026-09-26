# Nom des vidéos téléchargées — 26 septembre 2026

Les exports prennent le titre **actuel** du projet au téléchargement, y compris
pour une vidéo déjà générée avant un renommage. Exemple :
`sirat un nabi épisode 4` → `sirat_un_nabi_épisode_4.mp4`.

Le serveur émet Content-Disposition avec l'encodage MIME standard pour conserver
les accents et l'arabe. La règle reprend celle du desktop : caractères de mots
conservés, séparateurs remplacés par un underscore, noms réservés évités, longueur
bornée à180octets UTF-8 pour le titre. Le chemin privé sur disque reste l'ID opaque
de l'export ; aucun déplacement ni réencodage du fichier.

Tests réussis : aller-retour de l'en-tête Unicode, caractères de contrôle/chemins,
noms réservés et longs ; requête HTTP réelle avec PostgreSQL de fixture, titre
renommé après création du job, HTTP Range206, refus d'un autre propriétaire et
d'un export non terminé. `go test -race` ; preuves dans
`web/review/export-filename-20260926/tests.log`.

Modification préparée dans le backend API, non déployée pendant cette tâche.
Aucune dépendance nouvelle, migration ou modification du profil média administré.
