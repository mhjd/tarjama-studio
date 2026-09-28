# Déploiement de la relecture compacte — 28 septembre 2026

Autorisation explicite du propriétaire après consultation de la galerie :
« ça me va, tu peux déployer ». Application publique : https://tarjama.runagen.com.

## Artefacts et périmètre

- Sources de l'interface testée : `362901427b63d994a2de90c565a41076368a4b11`.
- Recette et contrôle interne : commit `b30f032`.
- Recette active : `web/deploy/preview/active-subtitle-density-20260928.yml`.
- Révision : `176b335c5056984a` ; précédente `00305da3b4b44e06`.
- Image web : `preview.local/atelier/web@sha256:0f8286b455cd2f973fc90eb3b1ac62cfd58bb67f14d397f530a32736f13548c1`.
- Copie Docker : `tarjama-web:subtitle-density-3629014`, ID
  `sha256:3124249bc7a072e9128ccbe2307356f45d9845de4106a15a93382decd3663b6e`.
- Image du contrôle explicite :
  `preview.local/atelier/web@sha256:a520b8f908c764df255295b8d691830566d1fd66a5287dc72a6195fce1ba388f`.

La comparaison sémantique avec la recette active administrée ne change que
`services.web.image` et le job explicite `preview-check`. Celui-ci lit la
readiness, le refus anonyme des projets, la page d'accueil et les assets via la
connexion interne `web` déjà autorisée. Il n'a ni secret ni accès externe.
Les anciens contrôles Authelia de ce job sont remplacés par `TestFrontendRelease`.

Le binaire serveur de la nouvelle image est identique octet pour octet à celui
de l'image précédente : SHA256
`8901c62ba39d649355e862cdbc8e745e45a7df95a67763f15aa36d07076b70e2`.
Les images du worker, egress, Keycloak et PostgreSQL restent inchangées. Les
images locales de la recette précédente ont été réimportées et leurs références
comparées exactement, y compris les copies nécessaires au retour arrière.

Aucune migration, modification des textes ou réglage d'identité. La rétention
déjà active reste applicable lors du redémarrage du worker. Le thème Keycloak et
le profil d'inscription restent candidats : cette livraison ne les active pas.
Leur recette candidate a seulement été réalignée sur la nouvelle base UI pour
éviter une régression lors de leur future activation administrée.

## Exécution et qualification

- Sauvegarde `pv-job-backup-71aa9d7d` réussie avant déploiement : bases Tarjama et
  Keycloak, vérification des catalogues `pg_restore --list`. Ce contrôle n'est
  pas une nouvelle restauration ni une sauvegarde hors VPS.
- `validate` et `plan` réussis, puis déploiement appliqué. Le moteur réconcilie
  les six services même lorsque seule l'image web change ; la découverte OIDC
  a échoué une première fois pendant le démarrage de Keycloak, puis l'API a
  démarré normalement à 19:00:21 UTC.
- Les assets CSS/JS de l'image sont identiques aux fichiers du banc UI approuvé :
  `index-uFQAKx4D.css` et `index-DKyItcJX.js`.
- Tests UI précédents : 36 scénarios, puis 16 rejoués après le dernier ajustement
  visuel, avec compilation et six suites Go ciblées réussies.
- État final : six services prêts, `partial=false` ; contrôle
  `pv-job-preview-check-34a33135` Succeeded. Readiness 204, accueil 200, projets
  anonymes 401, SHA256 des deux assets réellement servis conformes. Marge disque
  mesurée après import : 15,29 Gio disponibles (15,95 %).

Le contrôle post-déploiement et l'état final sont conservés dans
`web/review/deployment-subtitle-density-20260928/`. Il s'agit d'une vérification
HTTP interne des fichiers réellement servis, pas d'une nouvelle session
navigateur authentifiée sur le domaine public. Aucun appel fournisseur, aucun
parcours IA relancé et aucun contournement du garde UID des agents.

## Retour arrière applicatif

En cas de régression liée à cette livraison, la version précédente reste
compatible avec les bases actuelles. Après vérification des images et de l'état :

```sh
vps-preview rollback atelier --revision 00305da3b4b44e06
vps-preview status atelier
```

Ce retour rétablit l'ancienne interface, pas le contenu des bases. Il ne faut
rejouer aucune phase de transition Keycloak ni toucher au routage public,
à l'administration privée 9443 ou à la fermeture de l'ancien aperçu.
