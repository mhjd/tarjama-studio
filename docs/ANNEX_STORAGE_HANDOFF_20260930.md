# Stockage Tarjama sur le disque annexe

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
