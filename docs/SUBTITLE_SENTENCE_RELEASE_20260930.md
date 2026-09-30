# Intégration du regroupement S1 — 30 septembre 2026

Le propriétaire a validé visuellement le MP4 S1 et demandé son intégration puis
son déploiement. Les résultats de recherche restent dans
[le bilan figé](SUBTITLE_SENTENCE_GROUPING_RESULTS_20260929.md).

## Contrat applicatif

Les nouveaux exports français SRT et vidéo utilisent la même partition S1 :
phrases entières, articulations ponctuées puis équilibre, avec les limites
qualifiées. Les segments éditables et traductions enregistrées ne changent pas.
Les exports vidéo déjà générés sont conservés jusqu'à leur rétention habituelle :
pas de régénération massive ni de traitement IA implicite.

Le helper Python sous `web/backend/internal/subtitlelayout/` reprend le code de
l'expérience, ICU 72 et la mesure libass/Noto à la taille Gros. Le backend reste
en Go. Préférer cette reprise exacte à un portage approximatif d'ICU ou de la
largeur des glyphes. L'image API/worker inclut les bibliothèques, polices et script
versionnés, avec un contrôle de démarrage au build ; pas de téléchargement au
runtime ni de nouvelle sortie réseau. Le rendu FFmpeg reste dans les opérations
média administrées existantes, dont les protections ne changent pas.

L'export SRT conserve la géométrie de référence 1920×1080, indépendante d'une
vidéo éventuellement expirée. Pour la vidéo, les ratios plus étroits réduisent
la largeur disponible à taille de texte constante : un portrait peut donc
regrouper moins qu'un SRT de référence. Low/High de même ratio utilisent le même
calcul canonique ; l'arrondi des pixels au rendu reste celui du style existant.
Les exceptions originales trop longues/rapides restent intactes. L'arabe garde
son regroupement précédent : S1 a été qualifié sur le français uniquement.

Une exécution du helper au maximum par service, délai total 60 s (attente du
créneau comprise), CPU 20 s, mémoire virtuelle 256 Mio, entrée 16 Mio et sortie
32 Mio maximum. Aucun shell, environnement applicatif secret ou chemin fourni
par le navigateur transmis au helper. Cela ne constitue pas une nouvelle
sandbox : c'est une bibliothèque de mise en page du backend de confiance.
Le backend revérifie couverture, ordre, texte et bornes temporelles en sortie.
Annulation ou erreur : échec explicite de l'export, aucun repli silencieux vers
l'ancien regroupement ni fichier partiel annoncé comme réussi.

## Qualification de parité

Parité exacte avec les JSON S1 figés avant intégration, y compris groupes,
frontières, texte, lignes et exceptions : Sirat 793 cues, Dedew 288, France 24
28. Aucun réglage après consultation de la réserve ; cette comparaison vérifie
un portage, elle ne constitue pas une nouvelle mesure indépendante de qualité.

Tests supplémentaires Go : phrase complète, virgule, équilibre, formats
SRT/ASS, ratios paysage/portrait et Low, conservation des segments, annulation,
échappement ASS et absence du helper. Tests existants par paires conservés pour
le comportement arabe/historique ; les points d'entrée applicatifs français
appellent explicitement `groupedSRT` / `groupedASS`.

Preuves de cette livraison : `web/.cache/sentence-release-20260930/`.
Le déploiement doit partir de la recette publique active, préserver Keycloak et
son thème, admin privée 9443, egress réparé, volumes et politiques réseau.
Aucune migration de schéma requise. Sauvegarde explicite avant remplacement des
images API/worker ; contrôle runtime du helper dans la qualification.

L'étude des références religieuses est un travail suivant distinct : cette
livraison ne change ni prompt ni texte traduit, et n'ajoute pas de parenthèses.

## Correction découverte pendant la qualification UI

Un rafraîchissement lancé avant une sauvegarde pouvait arriver après son accusé
et réinstaller un ancien numéro de version : le parcours Mac synthétique a
soumis version 5 alors que son PATCH venait de recevoir version 6, provoquant
un HTTP 409 légitime du backend. `Editor.refresh` ignore désormais une réponse
si l'objet projet a changé pendant la lecture. La prochaine interrogation
récupère l'état récent ; les protections serveur contre les conflits restent.
Un test Playwright retarde explicitement ce GET, acquitte une modification,
puis vérifie la conservation du texte et de la version transmise à la validation.

Les tests de parcours suivent aussi la séparation déjà livrée de l'export :
retour explicite par « Modifier la traduction » avant d'éditer, lecteurs testés
à l'étape Corriger et absence de lecteur attendue sur Export. L'attente SRT du
parcours prend en compte le groupe de deux phrases courtes au lieu des anciennes
bornes individuelles. Les premiers résultats en échec sont conservés dans les
preuves ; ils ne sont pas comptés comme une qualification réussie.

## Images finales et procédure préparée

Source des images API/worker : `fb666ee9cd5a0293b1615af40d5798a38c0c8984`.
Images importées localement, sans publication GHCR ni GitHub Actions :

- API : `preview.local/atelier/web@sha256:9cc3a80a29a197a3a5f9ca06e68c4147a78726b9fcb945c92975ed8418880016`
- Worker : `preview.local/atelier/web@sha256:fcef626b414e4c44a65881ce450366d41f190ea281772922ad662813e20533e9`
- Qualification : `preview.local/atelier/web@sha256:a450bee49a1e4a42dfe012f0e973cb9d3889d33828758213522a926306493457`

Recette `web/deploy/preview/active-sentence-grouping-20260930.yml`.
Comparaison structurée avec la recette publique précédente : seuls ces trois
images, la sélection des tests de qualification et le hash/chemin JS attendu
changent. La configuration restante est identique. L'ancien job explicite
`requested-export` est conservé mais n'est pas lancé par cette livraison.

Sauvegarde réussie `pv-job-backup-94ea8553` :

- application : `/storage/backups/pre-reliability-20260930T103056Z.dump`,
  SHA256 `972a5b750148772bd7e2bb7224e7ea72d59aab296957dbe7b2aa8f8b38fec585` ;
- identité : `/identity-backups/dumps/keycloak-20260930T103058Z.dump`,
  SHA256 `03813af773fbb33b976d2c6734590c56dd098fbae839abc1915fecf166f2d060`.

Aucune migration. Après tests : validation, plan, déploiement de cette seule
recette puis `vps-preview run atelier preview-check`. Le contrôle vérifie les
hashs des ressources réellement servies, le refus anonyme des projets et les
quatre tests S1 dans le conteneur Kubernetes de qualification.

Retour arrière applicatif si nécessaire :
`vps-preview rollback atelier --revision 32eba7cc205e8816` après vérification de
la disponibilité des anciennes images. Ne pas restaurer les bases pour ce
changement sans migration ; le rollback du moteur ne restaure pas les données.
Ne pas utiliser les anciennes recettes de transition Keycloak.

## Résultat du déploiement

Déployé le 30 septembre 2026 vers 10:49 UTC, révision **`53f5b3e75a7d75e1`**,
sur **https://tarjama.runagen.com**. Six services Running/Ready, review désactivé.
L'URL atelier retournée génériquement par le moteur n'est pas l'URL publique.

- `web/scripts/test.sh` : succès complet, tests Go avec détecteur de courses,
  `go vet`, build frontend, **82 tests Playwright réussis (7,2 minutes)**,
  sauvegarde/restauration PostgreSQL sur la base synthétique.
- Parcours enregistrés MacBook, Pixel et iPhone en émulation Chromium : import,
  correction/traduction simulées, édition persistée, export FFmpeg réel,
  téléchargement du MP4 et modification après export. Pas de nouvel appel IA.
- Parité exacte du portage sur les trois corpus figés ; les 793 groupes Sirat
  sont aussi reproduits dans l'image API sous UID 10001, réseau désactivé,
  racine en lecture seule et limites de ressources (3,68 s).
- `pv-job-preview-check-f30c9b56` Succeeded : frontend réellement servi conforme
  aux SHA256 attendus, projets refusés sans connexion, quatre tests S1 PASS
  dans Kubernetes (formats, ponctuation, annulation, échec explicite, échappement).
- Corpus local chargé dans le nouveau worker : `tools=3`.

Pendant la réconciliation, le premier démarrage API a échoué sur la découverte
OIDC. Le redémarrage automatique a réussi une fois Keycloak prêt ; les six
services sont ensuite Ready et le contrôle interne passe. Aucune modification
OIDC/réseau ni contournement nécessaire. Un échec initial transitoire est conservé
comme preuve, pas dissimulé derrière le statut final réussi.

Limites : pas de nouveau parcours public authentifié depuis un vrai Mac/téléphone,
pas de régénération de la vidéo Sirat dans le compte utilisateur, pas de nouvelle
qualification fournisseur. Les preuves de rendu S1 déjà validées restent celles
de l'expérience ; les anciens MP4 ne sont pas remplacés. Les projets, textes et
protections restent inchangés. Le correctif de rafraîchissement est la seule
modification de comportement du frontend incluse dans cette release.

La proposition de références entre parenthèses est consignée dans
[REFERENCE_DISPLAY_AUDIT_20260930.md](REFERENCE_DISPLAY_AUDIT_20260930.md) ; elle
n'est pas présentée comme une fonctionnalité déjà activée.
