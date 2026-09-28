# Récupération du lecteur — 28 septembre 2026

## Diagnostic réel

Le signalement combine un problème d’interface et une attente réelle du service
média. Les logs du worker `pv-worker-857cf8c7d7-hx7v8` indiquent depuis 21:34:15 UTC
un refus `POST`, HTTP 429, `reason=unspecified`, pour le job `restore_download`
`53f5d0cae654765db4630ccdb4ebea7d`, repris environ chaque minute.
Le contrat du courtier associe 429 aux quotas ou à la réserve disque. Ce journal
ne permet pas de distinguer la cause : aucune conclusion spécifique au disque,
au nombre de tâches ou au lien YouTube n’est démontrée.

Le volume hôte a environ 11 Gio libres (89 % utilisés), sous la marge de 15 %
retenue pour les constructions/imports. Cela ne prouve pas la cause du 429.
Six services applicatifs sont prêts, révision `29bd0ed9ca04cd7b` ; leur readiness
ne garantit pas l’admission des opérations isolées. Preuves non secrètes dans
`web/review/media-recovery-20260928/`. Aucun travail utilisateur annulé ou relancé,
aucune protection changée et aucun déploiement effectué pour cette correction.

## Interface corrigée

Un seul composant remplace les trois panneaux concurrents : à la place du
lecteur, compact et persistant pendant la relecture. Les informations secondaires
et les étapes détaillées sont dépliables ; sur téléphone, elles s’ouvrent au-dessus
de la barre plutôt que de la faire grandir sur tout l’écran.

- Attente initiale : « Récupération en file d’attente ».
- Refus temporaire : « En attente du service vidéo », heure de prochaine tentative
  si disponible, pas de spinner laissant croire à un téléchargement.
- Traitement : étape courante, animation et nombre d’étapes, détails terminés/en cours.
- Échec/annulation : reprise explicite du même job, pas de nouvelle tâche parallèle.
- Perte de connexion : état non actualisé explicite ; aucune activité prétendument confirmée.
- Vidéo prête : retour du lecteur, même pendant une saisie non enregistrée ;
  rafraîchissement des seules propriétés média sans écraser le brouillon.

Le message d’erreur brut d’une tentative antérieure ne détermine plus le titre :
l’interface suit `state` et le compteur durable `progress`. La reprise serveur
vidait déjà le message lors du claim ; ce changement ne prétend pas corriger un
message serveur qui aurait persisté en état running.

Le téléchargement dispose de six étapes durables, la préparation d’un fichier
réimporté de trois. Le courtier actuel ne publie ni octets téléchargés ni débit :
aucun pourcentage d’octets, durée restante ou progression temporelle fictive.
Pour un export restaurant sa source, le compteur d’export ne sert pas à déduire
les étapes de téléchargement : intitulé global « Récupération avant export ».
Une progression fine nécessiterait une extension administrée de l’API du courtier.

## Diagnostic à transmettre à l’administrateur

Sur atelier, examiner le refus d’admission vps-jobs du job applicatif
`53f5d0cae654765db4630ccdb4ebea7d` (restore_download), POST HTTP 429 dès le
28 septembre 21:34:15 UTC, répété chaque minute. Le worker ne reçoit/extrait
qu’un motif non classé. Déterminer le motif exact dans les journaux du courtier :
réserve disque, quota d’opérations simultanées, quota du tenant ou plafond des
métadonnées d’idempotence. Indiquer les compteurs/seuils pertinents sans secrets.

Vérifier d’abord en lecture seule ; ne pas supprimer de données, d’opérations ou
preuves utiles, ne pas desserrer les protections et ne pas annuler les tâches
utilisateur. Si une action de capacité/nettoyage est nécessaire, proposer le
périmètre précis. Après résolution, confirmer la reprise automatique du job et
la récupération du média, sans relancer correction/traduction ni dépenser des
crédits IA. Le domaine public et le thème Keycloak actif sont à préserver.

## Qualification

Résultats : 30 scénarios Playwright réussis, puis 12 scénarios ciblés rejoués
après réduction de la marge du panneau. Six suites Go avec détecteur de courses
et build TypeScript/Vite réussis. Neuf captures conservées et vues ordinateur,
iPhone et Pixel inspectées ; Chromium avec dimensions simulées, pas des appareils réels.
Aucun crédit IA utilisé. Galerie : `web/review/media-recovery-20260928/index.html`.

Voir les résultats et captures conservés dans `web/review/media-recovery-20260928/`.
Les tests navigateur utilisent une base synthétique et des états d’API contrôlés :
ils valident le rendu et les transitions, pas une récupération YouTube réelle.
Le téléchargement réel demeure non qualifié tant que le refus 429 subsiste.

Reproduction isolée (pas de secrets, pas d’appels fournisseurs) :

```sh
make web-preopening-check ARGS="media-recovery.spec.ts subtitle-density.spec.ts editor.spec.ts"
```

Ne pas lancer de construction/import d’images tant que la marge disque administrateur
n’est pas rétablie. La prochaine mise à jour devra partir de la recette active
`active-keycloak-theme-image-20260928.yml`, en conservant l’image du thème
sélectionné, l’egress réparé, l’administration privée et le routage public.
