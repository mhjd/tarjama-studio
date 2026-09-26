# Remplacement ciblé des profils média — prêt pour revue administrateur

## Résultat attendu

Éviter l'encodage de vidéo H.264 déjà compatible pendant la préparation ; ne
réencoder l'audio que si nécessaire. Les exports gardent l'incrustation ASS et
la qualité actuelle, en conservant directement l'AAC compatible. Comparer
ensuite le rendu à quatre vCPU, sans augmenter la concurrence.

**Aucune modification de profil actif n'a été faite par l'agent applicatif.**
Aucun besoin de changer les secrets, le réseau, les services web/worker, la base
ou la recette active. Aucun appel IA n'est nécessaire à cette qualification.
Le changement du courtier est indispensable : une image réimportée dans K3s
ou un redéploiement web n'affecte pas ses profils Docker.

## Image et périmètre

- Tag local : `tarjama-media:optimization-20260926`.
- **Docker image ID immuable** :
  `sha256:61e1817537c3f5ab0f332384377365f36e5b7f74988971f5b75264bca59b74b2`.
- Build : `docker build --platform linux/amd64 -f web/deploy/Dockerfile --target media -t tarjama-media:optimization-20260926 web`.
- Point d'entrée : `/usr/local/bin/tarjama isolated-tool`.
- Fichiers modifiés de l'entrée :
  `web/backend/internal/studio/isolated_tool.go` et `media_remux.go`.
- Commit source testé : `8b80b7dc05f5ae9142c932d81241dbe16592c2ce` ; base avant optimisation : `d6599aa`.
  Proposition structurée : `web/deploy/preview/media-optimization.proposal.json`.
  Diff de code : `git diff d6599aa 8b80b7dc05f5ae9142c932d81241dbe16592c2ce -- web/backend/internal/studio/isolated_tool.go web/backend/internal/studio/media_remux.go`.
- Profils à examiner exclusivement : **`tarjama-normalize-v1` et `tarjama-export-v1`**.
  Ne pas remplacer `tarjama-download-v1`, ses réglages, son image ou son relais.
  Les autres profils conservent également leur image et leurs paramètres.

Étape compatible avec les ressources actuelles : nouvelle image, même commande,
2 vCPU. Les anciens quatre arguments restent valides et utilisent deux threads.

Essai recommandé après vérification de capacité du VPS : même image, quota **4 vCPU**
uniquement pour ces deux profils, et suffixe fixe `4` ajouté à leur commande :

```text
isolated-tool normalize {width} {height} {quality} 4
isolated-tool export {width} {height} {quality} 4
```

Ce suffixe n'est **pas** un nouveau paramètre envoyé par Tarjama ou par le navigateur.
L'entrée refuse toute autre valeur supplémentaire. Le décodage reste à deux
threads ; seul l'encodage utilise quatre threads. `veryfast` et CRF23/28 restent
inchangés. Le gain local de 40–46 % à quatre vCPU ne prouve pas le comportement
sous charge simultanée des autres applications.

## Limites à conserver

- Concurrence globale **1** ; aucun cumul de quatre vCPU par plusieurs médias.
- Network none, sans relais pour normalize/export, aucun secret ou socket runtime.
- UID/GID10002, rootfs RO, capabilities vides, NNP, seccomp/AppArmor par défaut.
- Entrées fixes RO `media` (+ `subtitles.ass` pour export), sorties tmpfs inchangées.
- Mémoire3072Mi, pids128, résultat `result.mp4` <=1Gio, plafonds agrégés existants.
- Durée14400s ; prlimit taille1Gio, CPU14400s, nofile128 toujours dans le programme.
- Plafonds de réservation du courtier et réserve disque existants ; ne pas les
  diminuer pour faire accepter un essai. Refuser/attendre si la marge est insuffisante.
- Aucun privilège supplémentaire ni modification TLS/WARP/SSRF/firewall/SSO.

## Qualification proposée

1. Attendre une frontière sans opération active pour ces profils ; conserver les
   anciennes références pour rollback, sans interrompre un traitement utilisateur.
2. Sur données synthétiques, préparer H.264/AAC compatible : vérifier l'identité
   des paquets vidéo/audio, seek MP4 et présence audio/vidéo ; vérifier aussi H.264
   avec audio incompatible (seul l'audio change), puis VP9 ou redimensionnement
   (conversion complète). Pas d'entrée arbitraire provenant du navigateur.
3. Export ASS High/Low, vérifier intégrité et lecture/seek, rendu des sous-titres,
   annulation, refus de fichier invalide et nettoyage après ACK.
4. Pour l'essai4CPU, confirmer le quota effectif et l'argument fixe, mesurer un
   petit média autorisé ; contrôler readiness/latence des services existants.
5. Documenter le digest effectivement enregistré, les limites, les mesures et les
   éventuelles réserves. En cas de régression, restaurer **image ET commande ET
   quota CPU**, pas seulement l'une des trois valeurs.

Ancienne image normalize/export attestée par la passation du23septembre :
`sha256:da630b6315542d51fbaa689432ecbae41ac364bd824200b0a60d00a10555c6d3`,
commande sans suffixe et quota2CPU. Vérifier l'état réellement enregistré avant
intervention ; l'agent n'a pas accédé directement au runtime administré.

## Preuves applicatives

[Rapport et mesures](MEDIA_OPTIMIZATION_20260926.md), résultats bruts et logs sous
`web/review/media-performance-20260926/`. Les tests de la nouvelle image utilisent
Docker local sans réseau, protections par défaut, quotas2/4CPU ; ils ne sont pas
une qualification du courtier en production. Commande reproductible :

```sh
MEDIA_TEST_IMAGE=tarjama-media:optimization-20260926 MEDIA_TEST_CPUS=2 make web-isolated-image-test
MEDIA_TEST_IMAGE=tarjama-media:optimization-20260926 MEDIA_TEST_CPUS=4 make web-isolated-image-test
```

Le skill `vps-preview`, référence `isolated-download-20260924.md`, demande pour
ce remplacement l'ID Docker immuable, la source/diff, les tests, les profils précis
et les limites à conserver. Ce document rassemble ces éléments ; il n'enregistre
aucun profil et ne fournit aucun accès administrateur à l'application.
