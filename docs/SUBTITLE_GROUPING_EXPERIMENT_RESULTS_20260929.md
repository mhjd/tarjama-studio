# Regroupement : résultats de la campagne du 29 septembre

## Décision

**Ni A ni B n'est intégrée.** Les deux variantes améliorent certains défauts,
mais les compteurs plus favorables cachent des compromis de sens. La campagne
s'arrête au plafond préétabli de deux variantes de développement. Aucune
candidate n'est promue vers l'évaluation réservée ; la généralisation n'est
donc pas démontrée. Production, projets, prototype et vidéo livrée inchangés.

Protocole préalable : [généralisation](SUBTITLE_GROUPING_GENERALIZATION_20260929.md)
et [hypothèses A/B](../web/review/grouping-generalization-20260929/PROTOCOL.md).

## Données et indépendance

- Développement : 966 segments de Sirat épisode 4, copie administrateur version
  6, source et empreinte inchangées.
- Réserve identifiée : vidéo `hM_hCQ6RUcc`, conférence de Muhammad al-Hasan
  al-Dedew. Le README Windows en donne la provenance ; 384 IDs correspondent
  exactement entre arabe et traduction DeepSeek archivée, horaires valides sans
  chevauchement. Le français n'a pas été inspecté pour ajuster ces variantes et
  aucune partition de réserve n'a été calculée.
- Autre contrôle : reportage France 24 `gbrDbQVYDuQ`, 28 segments. Des extraits
  français sont apparus dans les journaux UI lors de la recherche de provenance :
  ce contrôle est **partiellement exposé**, pas aveugle. Il ne compte pas comme
  seconde conférence. Il faudrait encore réserver une autre conférence/locuteur
  pour satisfaire l'objectif de diversité initial, si une candidate franchit
  le développement.

Les traductions alternatives d'une même vidéo ne sont pas comptées comme de
nouvelles vidéos indépendantes. Aucun appel fournisseur ou téléchargement.

## Mesures sur tout Sirat

| Méthode | Sous-titres | D'un mot | Moins de 5/6 s | Au-dessus de 17 caractères/s | Au-dessus de 21 caractères/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| Paires actuellement déployées | 827 | 5 | 12 | 281 | 130 |
| Prototype livré | 826 | 11 | 11 | 269 | 114 |
| A, priorités réordonnées | 830 | 3 | 9 | 282 | 114 |
| B, préférence pour une phrase terminée | 834 | 3 | 9 | 287 | 120 |

Les dépassements de 21 caractères/s de A/B sont des segments d'entrée conservés,
pas de nouvelles fusions violant la limite. B conserve 236 écrans avec au moins
une exception d'entrée, contre 230 pour le prototype/A. Les contraintes ne sont
ni relâchées ni présentées comme respectées par les entrées qui les dépassaient.

Anticipation maximale du début du dernier segment réuni : 6,5 s pour prototype,
A et B, contre 4,84 s pour les paires. Une pause interne de 720 ms est traversée
par les trois variantes progressives. Ces temps décrivent les bornes disponibles,
pas un alignement français au mot ni une qualification audiovisuelle complète.

Conservation des mots, ordre, couverture exacte et bornes d'origine : vérifiées
pour les trois méthodes de chaque essai. Mesure libass à taille Gros identique.
Le compteur `exceptions` des paires n'est pas comparable : leur structure ne
contient pas ces annotations. Dans le premier journal A il valait abusivement
zéro par défaut ; l'évaluateur B le rend explicitement `null`. Cela corrige une
mesure manquante, sans changer les partitions ou les autres compteurs.

## Observations utiles et contre-exemples

A réduit les mots isolés mais peut mettre « Aux Arabes. » avec « Enfin, dernier
point… » au lieu de la question précédente. Elle n'est pas retenue.

B conserve les regroupements utiles signalés autour de 10:24, 46:17 et 46:29.
Elle réunit « Harb. Hanzala. Sakhr. », associe « Oui. Très bien. » et sépare
correctement la question sur le cinéma de « Quand vous regardez un vieux film, ».
Ces améliorations n'ont nécessité aucun nom, horaire ou nouvelle liste spécifique.

**Contre-exemple qui bloque B, autour de 6:03–6:11 :**

- Prototype : « En résumé, » puis « la morale n’a pas de sens si elle n’a pas de
  fondement religieux. » puis « D’accord ? ».
- B : « En résumé, la morale n’a pas de sens » puis « si elle n’a pas de
  fondement religieux. D’accord ? ».

La phrase et sa condition tenaient déjà ensemble pendant 6,46 s. Éviter le petit
écran « D'accord ? » ne justifie pas de rendre temporairement l'affirmation
inconditionnelle. Le texte n'a pas changé, mais son dévoilement successif est
moins bon. Le compteur « d'un mot » récompense ici un résultat que la revue
qualitative rejette.

Ce mécanisme se reproduit hors vocabulaire religieux avec « ce procédé ne
fonctionne pas si le récipient reste ouvert. », suivi de « Compris ? ». Le test
de qualification conserve cet échec ; aucune exception au mot « si » n'a été
ajoutée. C'est un test synthétique de mécanisme, **pas** une preuve sur une autre
conférence.

La revue des différences est interrompue après ce contre-exemple suffisant pour
refuser la promotion. Les listes complètes sont sauvegardées (B : 151 frontières
différentes des paires, 40 du prototype), mais ne sont pas présentées comme une
revue qualitative exhaustive. Pas d'écoute complète ni de nouveau rendu MP4.

## Validation technique, coût et poursuite

Neuf tests de mécanisme passent. Un test de qualification séparé échoue pour B,
explicitement et de façon reproductible. Le prototype passe ce contre-exemple.
Les premiers tests de développement mal formulés et leur correction sont
consignés dans le protocole ; ils ne sont pas présentés comme des succès initiaux.

Les résultats complets, entrées identifiées par empreinte, versions du code,
image outils immuable et durée réelle sont conservés sous
`web/.cache/grouping-generalization-20260929/`. Budget fournisseur : **0 $**.
Chaque comparaison prend quelques secondes ; aucun encodage d'une heure lancé.

La leçon n'est pas d'ajouter un seuil ou le vocabulaire de Sirat. Une prochaine
campagne devrait protéger les unités de sens déjà cohérentes avant de chercher
à réduire les petits écrans, et prévoir les cas d'abstention. Cette piste reste
une hypothèse à figer et tester, pas une nouvelle version validée. Ne pas changer
les priorités une troisième fois dans cette campagne, ni consommer la réserve
pour chercher une variante chanceuse.
