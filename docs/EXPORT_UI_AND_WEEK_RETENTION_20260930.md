# Export français et conservation des vidéos une semaine

Décision du propriétaire du 30 septembre 2026, suivie d'une autorisation de
mise en service après tests.

## Parcours

Le téléchargement SRT est proposé uniquement à l'étape Exporter, dans la carte
explicite « Exporter les sous-titres », et uniquement en français. Les étapes
Corriger et Traduire n'affichent plus de téléchargement SRT ni de rubrique
« À propos de la traduction ». Les consignes du modèle et les références
coraniques ne changent pas. L'API historique des SRT arabes reste compatible,
mais n'est plus proposée dans l'interface.

La validation avant export conserve le flush des derniers changements. Le
regroupement S1 français reste commun aux SRT et à la vidéo. Les textes de
relecture ne sont pas regroupés ni réécrits.

## Conservation

Sources YouTube, sources importées et rendus exportés : sept jours. Les sources
suivent leur échéance persistée, renouvelée aux points existants de publication
et d'utilisation média ; les exports expirent sept jours après leur succès.
La règle précédente de 24 heures est remplacée. Aucun changement de la rétention
des textes, des sauvegardes ou du corpus. Les traitements actifs restent protégés.
Les imports expirés nécessitent toujours une réimportation ; les vidéos YouTube
restent récupérables pour la lecture ou l'export.

Le champ interne `media_retention_days=7` distingue les nouvelles échéances.
Au premier passage du nettoyage, sous verrou du projet, une échéance historique
de source YouTube est prolongée de six jours puis marquée, une seule fois.
Les imports déjà conservés une semaine ne sont pas prolongés. Une source sans
échéance reçoit la période de grâce habituelle, désormais sept jours pour tous.
Les fichiers déjà supprimés ne sont pas recréés ; aucune IA n'est relancée.
Un fichier encore présent mais âgé de plus d'une semaine reste éligible au
nettoyage. Pas de migration SQL ni d'arrêt particulier pour conversion des dates.

## Vérifications et déploiement

Les tests couvrent la conservation des deux origines et des exports après
25 heures, l'expiration à une semaine, la protection des travaux actifs et des
textes/sauvegardes, la conversion unique des anciennes échéances et la reprise
sans IA. Les tests UI vérifient l'absence des anciennes rubriques dans les deux
étapes de relecture, l'export français seul sur trois largeurs et l'enregistrement
avant téléchargement.

Les résultats réellement exécutés, images et révision seront consignés à la fin
de la livraison. Les preuves sont dans `web/.cache/week-retention-release-20260930/`.
