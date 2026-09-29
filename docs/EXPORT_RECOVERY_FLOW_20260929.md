# Export et récupération exclusifs — 29 septembre 2026

## Problème et décision

Le serveur autorisait l’ajout d’un export à la file pendant un `restore_download`
ou un `restore_prepare`. Le worker sérialisait les traitements par propriétaire,
mais cela ne rendait pas ce parcours cohérent : deux cartes proposaient des
actions alors que la récupération devait précéder la création.

Un export ne doit plus être créé, réactivé après expiration ou repris après
échec/annulation tant qu’une récupération du projet est `queued`, `running` ou
`waiting_provider`, indépendamment de la qualité choisie. L’utilisateur attend
sa fin ; l’action devient disponible au prochain rafraîchissement. Les fichiers
SRT et les exports déjà prêts restent téléchargeables.

La récupération implicite avant export reste permise lorsqu’aucune récupération
séparée n’est active : la tâche d’export obtient alors elle-même sa source expirée.
Il n’y a pas de deuxième tâche de récupération créée par cette opération.

## Implémentation

- Interface : blocage du bouton principal et des boutons de reprise des exports,
  avec explication visible. Low et High appliquent le même contrôle.
- Sélection de l’état : une récupération active prime sur un export ajouté plus
  récemment, pour ne pas masquer son avancement. Les anciens exports d’une
  génération antérieure ne proposent plus de reprise devenue invalide. Les files préexistantes restent
  intactes ; un export déjà en attente est présenté comme attendant la récupération.
- API : contrôle au sein de la transaction `Store.Mutate`, avec verrou du projet.
  Rejet HTTP 409 avant toute insertion/réactivation ; protège aussi les onglets
  obsolètes et appels directs. Le contrôle de reprise empêche réciproquement de
  relancer une récupération lorsqu’un export est actif. Identité/projet/génération
  restent contrôlés ; aucune migration ou modification de données existantes.
- Tests : le runner isolé s’arrête désormais dès un échec Go, avant le build/UI.

## Qualification et livraison

Reproduction sans clés ni appels IA :

```sh
make web-preopening-check ARGS="export-recovery-guard.spec.ts media-recovery.spec.ts editor.spec.ts"
```

La matrice API couvre les deux récupérations et les trois états actifs, l’export
expiré, sa reprise, les SRT, l’absence de perte de textes et le cas inverse.
Un test simultané lance récupération et export depuis deux requêtes : une seule
est acceptée et un seul job est créé. Le test existant de récupération implicite
avant export reste inclus.

Les tests UI contrôlent attente/traitement/service indisponible, changement de
qualité, reprise d’un ancien échec, disponibilité SRT, priorité de la récupération
sur une ancienne file d’export et réactivation à la fin. Viewports Chromium
1440 × 915, 393 × 915 et 412 × 915 ; pas des appareils physiques.
Résultats : **24 tests UI réussis**, puis **8 tests ciblés réussis** après le
filtrage des anciens exports et l’ajustement du libellé. **9 tests Go réussis
avec détecteur de courses**, build TypeScript/Vite réussi. Trois captures
conservées, vue mobile inspectée. Aucun appel fournisseur ni tâche réelle modifiée.
Preuves : `web/review/export-recovery-20260929/`.
Le premier lancement s’est arrêté sur une URL SRT incorrecte dans le nouveau
test (suffixe `.srt` et version manquants), corrigée avant la qualification finale.

Candidate locale uniquement. Aucun déploiement ni intervention dans les tâches
utilisateur. Le prochain déploiement doit inclure le binaire API corrigé et le
frontend, en plus de `ed78fc7`, et préserver la recette Keycloak/public/egress
actuelle. Aucune migration de schéma nécessaire.
