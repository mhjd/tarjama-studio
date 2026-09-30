# Stockage Tarjama sur le disque annexe

## Nouvelle décision : budget de surveillance de 40 Gio

Le propriétaire autorise désormais 40 Gio pour la bibliothèque (30 septembre,
après la migration). Changement administrateur en attente : la configuration
relue dans `/etc/vps-maintenance/storage.json` contient toujours
`budget_bytes: 15032385536` (14 Gio). La cible est **42949672960 octets**.
Le disque annexe dispose d'environ 80 Gio libres à ce contrôle.

Ce budget reste un seuil d'alerte, pas une réservation ou un quota physique.
Il peut être porté à 40 Gio sans déplacer la bibliothèque ni redéployer Tarjama.
Conserver les vérifications UUID/montage et l'alerte globale à 80 % du disque.
Ne pas modifier les réservations de travail temporaires du courtier média.

La recette actuellement déployée déclare toujours `library: 14Gi`, avec un
plafond d'emplacement `max_storage_gi: 19`. Le contrat du courtier documente
également un maximum de 16 Gi par volume et ne redimensionne pas les PVC
existants. Ces valeurs Kubernetes ne constituent pas le budget physique de la
bibliothèque. Ne pas écrire `40Gi` dans la recette puis redéployer pour modifier
la seule surveillance ; une harmonisation éventuelle des déclarations et
capacités demanderait une évolution administrée distincte du contrat.

Message à transmettre :

> Le propriétaire autorise le passage du budget de surveillance de Tarjama à
> 40 Gio. Mets à jour la source administrée de `storage-monitoring.yml` puis
> `/etc/vps-maintenance/storage.json` pour le seul chemin
> `/srv/vps-storage/applications/atelier/library` :
> `budget_bytes = 42949672960`. Préserve UUID/montage, alerte disque à 80 %,
> déduplication des notifications et budgets des autres services. Vérifie le
> collecteur et confirme le seuil effectif. C'est un seuil d'alerte, sans quota
> physique : aucun déplacement, redimensionnement destructif de PVC, modification
> de la recette active ni redéploiement applicatif nécessaire. Les déclarations
> Kubernetes restent distinctes, sauf évolution administrative explicitement
> préparée et qualifiée.

## État actuel : migration administrateur terminée et qualifiée

Passation reçue :
`/home/codex/.tarjama-annex-storage-admin-20260930/README.md`.
Reprise le 30 septembre à 14:17:58 UTC, qualification terminée à 14:28:04 UTC.
Révision `4105dbd09a487ec3` inchangée, six services prêts. **Aucune modification
de recette ni nouveau déploiement applicatif nécessaire.** Les sections de
préparation plus bas sont historiques et ne doivent pas être rejouées.

Le volume `library` est maintenant sur
`/srv/vps-storage/applications/atelier/library`, disque `/dev/sdb`.
Le PV/PVC reste identique et web/worker conservent `/storage` ; l'administrateur
a vérifié le périphérique 8:16 dans leurs montages. Copie intégrale vérifiée
par empreintes et métadonnées, droits et protections conservés. Bases
PostgreSQL/Keycloak non déplacées. Les entrées/résultats du courtier
`/var/lib/vps-jobs` restent sur le disque système ; ses temporaires de traitement
sont en mémoire selon le profil. Ne pas annoncer que tout le traitement média
utilise le disque annexe.

Budget `library` conservé à **14 Gio**, surveillé par alerte : ce n'est pas un
quota physique. Occupation constatée par l'administrateur : environ 3,12 Gio,
disque annexe environ 80 Gio disponibles, partagés avec d'autres usages.
Surveillance du montage/UUID, de ce budget et du seuil de 80 % du disque installée.

Qualification administrateur sur fixture dédiée, sans IA : lecture Range et
octets, retouche française persistée, export Low H264/AAC et rétention réelle
réussis ; textes conservés après expiration des médias. Projet et session de test
nettoyés. Les premiers essais de rétention ont échoué à cause d'une attente trop
courte et d'une date synthétique mal formatée ; ces preuves sont conservées,
la fixture a été corrigée et le cycle suivant a réussi, sans patch produit.
L'agent applicatif a relu la passation et recontrôlé les six services prêts ;
il n'a pas rejoué les essais métier ni consulté les reçus root privés.

Original conservé par l'administrateur dans
`/var/lib/vps-admin-evidence/annex-library-20260930/library-original` : pas de gain
immédiat sur le disque principal tant que cette copie existe. Ne pas la supprimer
ni la restaurer automatiquement : depuis la reprise, les nouvelles écritures
sont sur l'annexe. Un retour demande l'arrêt coordonné des écritures et une
copie actualisée annexe → principal, contrôlée avant bascule.

L'absence de cible a été qualifiée sur un volume synthétique : accès refusé sans
création de remplacement sur le principal. Aucun redémarrage ou débranchement
du disque réel n'a été effectué ; contrôle au prochain reboot autorisé restant.
Ce déplacement ne constitue pas une sauvegarde hors VPS.

## Préparation historique

Le propriétaire souhaite que le stockage vidéo utilise le disque annexe.
Inventaire en lecture seule du 30 septembre 2026 :

- `/dev/sdb`, ext4, monté sur `/srv/vps-storage` : environ 98 Gio utiles,
  14 Gio utilisés, 83 Gio disponibles.
- Disque système `/dev/sda1` : environ 96 Gio utiles, 76 Gio utilisés,
  21 Gio disponibles.
- La racine du disque annexe est administrée (`root`, mode 0700).

Ces chiffres décrivent les systèmes de fichiers, pas une réservation pour Tarjama.
L'agent applicatif n'a pas établi le disque physique actuellement utilisé par
le volume `library` ni par les temporaires du courtier média. Ne pas supposer
qu'ils sont encore sur le disque système ou déjà sur le disque annexe.

## Contrat applicatif à conserver

Recette courante : `web/deploy/preview/active-quran-only-20260930.yml`, révision
`4105dbd09a487ec3`. Six services prêts après le dernier déploiement.
Le volume `library` est monté sur `/storage` dans web et worker ;
`STORAGE_DIR=/storage`. Il contient les médias et également les sauvegardes
applicatives. Les bases application/Keycloak et sauvegardes d'identité sont sur
des volumes distincts. Préserver l'ensemble du volume, pas seulement les MP4.

La recette déclare `library: {size: 14Gi}` et un total de 19 Gio pour l'emplacement.
Ces déclarations ne prouvent ni le disque sous-jacent ni un quota physique.
Le format vps-preview ne permet pas de sélectionner un chemin hôte ou une classe
pour ce volume. Le déplacement physique relève donc de l'administration du
stockage, sans élargir les droits du service applicatif.

## Message à transmettre à l'administrateur

> Le propriétaire souhaite placer les médias Tarjama sur le disque annexe
> `/srv/vps-storage` (`/dev/sdb`). Vérifie d'abord le chemin physique réel du
> volume `library` d'atelier, ainsi que les espaces temporaires des traitements
> `vps-jobs`. S'ils utilisent déjà ce disque, fournis simplement les preuves ;
> sinon prépare puis réalise une migration contrôlée dans une fenêtre de
> maintenance coordonnée avec le propriétaire, sans interrompre un traitement
> utilisateur en cours.
>
> Conserve le même volume logique et le chemin `/storage` pour web/worker,
> l'UID/GID 10001, les données, les permissions et les protections actuelles.
> Le volume contient aussi des sauvegardes : ne migre pas seulement les vidéos.
> Ne change pas les bases PostgreSQL/Keycloak pour ce déplacement de médias.
>
> Procédure attendue : inventaire des volumes/montages et jobs actifs,
> vérification de la capacité et sauvegarde, suspension coordonnée des écritures
> et de la rétention, copie complète préservant les droits, vérification des
> tailles et empreintes avant bascule, puis reprise et qualification. Conserve
> la source initiale pour un retour arrière ; ne la supprime pas automatiquement.
> Si le périmètre demandé exige de modifier une configuration globale vps-jobs,
> prépare une proposition distincte sans déplacer les données d'autres services.
>
> Le montage doit être durable et son absence doit empêcher les services
> concernés d'écrire sur le disque système à la place. Vérifie la surveillance
> de capacité et le budget réel de Tarjama. Un second disque sur le même VPS
> ne remplace pas une sauvegarde hors VPS.
>
> Qualifie lecture/Range, sauvegarde d'une retouche et export sur un projet
> synthétique dédié sans appel IA, reprise de service et nettoyage/rétention.
> Préserve les projets existants. Ne réapplique aucune ancienne recette :
> version active `4105dbd09a487ec3`, fichiers dans le dépôt Tarjama.
> Fournis une passation indiquant les volumes et temporaires effectivement
> déplacés, les contrôles, la source conservée et le retour arrière.

Aucune migration, écriture sur le disque annexe, modification de permissions ou
activation de recette réalisée par l'agent applicatif pour cette préparation.
