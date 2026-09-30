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
