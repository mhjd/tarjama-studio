# Regroupement : protocole de généralisation avant ajustement

## Décision à prendre

Le propriétaire souhaite améliorer le regroupement progressif sans spécialiser
les règles à Sirat un nabi épisode 4. Le prototype `b1b170c` a été livré pour
examen, pas intégré à l'application. Le présent protocole est fixé **avant**
la prochaine modification de l'algorithme et avant sa mesure sur la réserve.
Il ne constitue pas un résultat de validation.

Références et limites des conventions :
[recherche précédente](SUBTITLE_CONFERENCE_RESEARCH_20260929.md).
Les conventions de longueur, durée et vitesse ne prouvent pas à elles seules
qu'un découpage est compréhensible ou bien synchronisé.

## Séparation des données

- **Développement** : tout Sirat épisode 4, ses captures, ses exemples déjà
  discutés et les cas synthétiques écrits pour reproduire un mécanisme. Aucun
  extrait de cette vidéo ne sera présenté comme un test indépendant, même un
  extrait qui n'a pas encore été regardé.
- **Réserve pour cette modification du regroupement** : deux jeux locaux
  recensés ci-dessous, sans examen du français ni calcul de leur partition à ce
  stade. Les exemples ont déjà servi à des évaluations de traduction : ils ne
  sont donc pas un corpus entièrement nouveau pour le projet. Leur valeur est
  celle d'un contrôle externe au développement sur Sirat, avec cette réserve
  explicitement signalée.
- Trois captures du même reportage, plusieurs traductions du même extrait ou
  plusieurs morceaux de la même conférence ne comptent pas comme plusieurs
  vidéos indépendantes.

Inventaire de réserve (métadonnées et empreintes seules examinées) :

| Jeu | Fichiers locaux | Empreintes SHA256 |
| --- | --- | --- |
| Corpus religieux historique, 384 segments, 15 min 40,7 s | `data/model_outputs/luna-comparison-20260924-01/corpus-deepseek-v4.1-flash/input.json` et `translation.json` | entrée `2b5bc9bc7c07277fece00c0b183e73c5e5e5bd7459a80e1a7612f8f737f024c4` ; français `f01efc2c240aa1d6c3315e2864111280d427c1ad4cfcb6ef509fb47a74afe7c4` |
| Vidéo courte `gbrDbQVYDuQ`, 28 segments, 138,867 s | `web/.cache/real-ui-10min/ui-review-tenmin_short3/transcription-macbook-air15-m4.json` | `4219cd60c3a72e6ea3275351dbb585490f38a0d54e1a8635738b2154c8dac85e` |

Sirat, copie administrateur :
`/home/codex/.tarjama-sirat-grouping-input/segments.json`, SHA256
`06b8344d739b7eb8564b6ee6bbd7e5d6b92400eca3b17de72323e7371231817c`.

Avant d'utiliser la réserve, vérifier la correspondance exacte des IDs, les
horaires et la provenance. Le corpus historique vient de
`test-fixtures/windows/transcription_amelioree_gpt.json` ; son identité vidéo
et son indépendance par rapport à Sirat restent à établir. Il ne faut pas
inventer cette indépendance à partir du seul nombre différent de segments.
Une réserve inutilisable est un défaut des données, pas un échec du candidat.

**Pour conclure à une généralisation aux conférences**, exiger en plus deux
conférences distinctes de Sirat, de locuteurs différents, avec des rythmes
différents et des traductions françaises horodatées. Les fichiers ci-dessus
ne démontrent pas encore que cette condition est satisfaite. Si nécessaire,
demander des copies autorisées supplémentaires, pas un accès au stockage de
production. Un reportage court ou des exemples synthétiques ne remplacent pas
cette qualification. Réserver ces conférences avant d'en lire les résultats.

## Ce qui peut changer

Une première candidate peut modifier seulement la préférence entre partitions :

1. limiter les affichages très courts ou isolés quand un regroupement admissible
   les évite ;
2. mieux respecter les frontières de phrase quand cela ne recrée pas ces
   fragments.

Écrire la priorité exacte et les résultats attendus **avant** chaque essai de
développement. Pas de noms propres, timecodes, formulations ou exceptions propres
à Sirat dans les règles. Ne pas enrichir la liste de mots avec chaque défaut
rencontré. Un nom terminé par un point n'est pas nécessairement une phrase :
la ponctuation est un indice, pas une analyse grammaticale certaine.

Conserver pour cette campagne les contraintes déjà déclarées : nouveaux groupes
de 7 s maximum, deux lignes de 42 caractères, largeur réelle à la taille Gros,
21 caractères/s maximum, préférence à 17. Ne pas ajuster ces seuils après
observation des résultats pour faire passer un cas particulier. La durée
minimale conventionnelle de 5/6 s peut servir à mesurer les affichages fugitifs ;
elle ne permet pas d'inventer de nouveaux horaires.

Les pauses internes ne sont pas un veto systématique. Rapporter aussi le temps
d'anticipation des segments réunis : rendre une phrase plus complète peut faire
apparaître ses derniers mots trop tôt. Sans écoute, on ne peut pas certifier la
synchronisation perceptive.

## Comparaison et critères fixés à l'avance

Comparer sur les mêmes entrées complètes : règle déployée par paires, prototype
livré et candidate. Même texte, même police, mêmes horaires, même environnement.

Exigences absolues :

- aucun ajout, retrait, changement d'ordre ou retraduction de mots ;
- chaque segment d'origine apparaît exactement une fois ; bornes externes
  reprises des segments, sans horaire au mot inventé ;
- toute nouvelle fusion respecte les contraintes ; les exceptions indivisibles
  de l'entrée sont conservées et comptées à part ;
- aucun fichier de projet, preuve existante ou application déployée modifié.

Rapporter **par vidéo**, pas seulement en moyenne : nombre de sous-titres,
affichages d'un mot, affichages de moins de 5/6 s, distribution de durée et de
vitesse de lecture, groupes dépassant 17 caractères/s, pauses traversées,
anticipation maximale et nombre de cas inchangés. Le nombre de mots n'est pas
un objectif autonome à maximiser. La ponctuation et la liste grammaticale qui
servent à l'algorithme ne doivent pas être son seul juge.

Revue qualitative : toutes les frontières modifiées, avec le contexte précédent
et suivant ; classer amélioration, équivalence, régression ou incertitude et
conserver les exemples négatifs. Comparer sous les mêmes critères : unité de
sens, fin de phrase respectée, fragments évitables et lisibilité. Une revue par
l'agent ayant conçu le candidat n'est pas une évaluation humaine indépendante.

Promotion seulement si les invariants passent, que la candidate n'augmente sur
aucune vidéo de réserve les affichages d'un mot ou fugitifs par rapport aux deux
comparateurs, et que la revue ne révèle aucune nouvelle coupure manifestement
mauvaise. Exiger un gain qualitatif sur au moins deux conférences indépendantes.
Une absence de fusion sur un contenu déjà bien découpé est acceptable ; elle ne
prouve pas un gain. Un compteur satisfaisant sans amélioration de lecture ne
suffit pas. Ces critères conservateurs sont des décisions de qualification,
pas des seuils statistiquement validés.

## Budget, gel et règle d'arrêt

- Hors ligne, aucun appel IA, téléchargement ou crédit fournisseur nécessaire.
- Au plus deux variantes de développement dans cette campagne, chacune avec
  hypothèse et code conservés avant son essai. Pas de recherche exhaustive de
  seuils. Au plus 30 minutes de calcul cumulé, sans nouveau rendu d'une heure.
- Sélectionner et figer une candidate (commit/empreintes) avant d'ouvrir les
  résultats de réserve ; une seule évaluation finale de cette candidate.
- Si la réserve révèle une régression, conserver ce résultat et **ne pas**
  corriger puis annoncer une réussite sur la même réserve comme si elle était
  toujours inconnue. Le cycle suivant demande une nouvelle réserve.
- Conserver les sorties dans un nouveau répertoire exclusif avec empreintes
  d'entrée, code et paramètres. Les calculs déterministes ne nécessitent pas de
  répétitions pour choisir le meilleur résultat.
- Si les contenus indépendants manquent, dire « généralisation non qualifiée ».
  Ne pas intégrer sur la seule réussite de Sirat. Aucun déploiement autorisé par
  ce protocole.

## État au gel

Protocole et inventaire préparés. Aucun nouvel algorithme évalué, aucune réserve
consommée, aucun nouveau MP4 généré. Le prototype livré et la production restent
inchangés. Prochaine étape : établir la provenance et la diversité de la réserve,
puis réaliser la correction et sa qualification selon ces critères.
