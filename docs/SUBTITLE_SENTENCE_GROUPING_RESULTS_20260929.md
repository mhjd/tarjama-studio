# Regroupement par phrases : résultats S1

## Conclusion et périmètre

S1 améliore le regroupement sur Sirat et sur une autre conférence réservée à
l'évaluation. La recommandation est de retenir cette candidate pour la suite,
sans prétendre qu'elle réalise une analyse grammaticale complète ou qu'elle est
optimale sur toutes les conférences. Aucun code applicatif, donnée utilisateur
ou déploiement n'a été modifié. Coût fournisseur : **0 $**.

Le propriétaire demande des unités de lecture cohérentes, pas une règle littérale
sur les mots isolés : une phrase entière si possible, sinon une articulation
naturelle, sinon des morceaux équilibrés. Le
[protocole](../web/review/sentence-grouping-20260929/PROTOCOL.md) a été révisé dans
ce sens **avant** les mesures. Les expériences A/B précédentes restent rejetées
et conservées ; leur critère absolu contre toute nouvelle coupure ne correspond
plus à ce besoin précisé.

## Méthode et fondement

S1 repère les phrases sur tout le français avec ICU 72, locale
`fr@ss=standard`, puis choisit globalement parmi les regroupements de segments
contigus admissibles. Après les exceptions d'entrée, elle minimise les coupures
dans les phrases, préfère les frontières ponctuées, évite les mots grammaticaux
suspendus et départage les possibilités par l'équilibre des morceaux. Plusieurs
phrases brèves peuvent partager un sous-titre. Le protocole détaille l'ordre
exact des critères ; aucun vocabulaire propre à Sirat n'a été ajouté.

Cette démarche s'appuie sur la distinction entre segmentation et traduction
étudiée dans [Point Break](https://aclanthology.org/2020.clicit-1.27/) et dans les
[travaux d'évaluation de segmentation](https://aclanthology.org/2022.lrec-1.328/).
Ces publications ne valident pas directement notre algorithme : nos frontières
temporelles sont indivisibles et nous n'avons pas de segmentation humaine de
référence permettant de revendiquer leur score Sigma.

[ICU](https://unicode-org.github.io/icu/userguide/boundaryanalysis/) apporte les
frontières et le filtrage des abréviations françaises. Une virgule n'est pas
toujours une bonne coupure syntaxique ; les limites du texte seul et les
ambiguïtés de ponctuation sont explicites dans
[Unicode UAX29](https://www.unicode.org/reports/tr29/#Sentence_Boundaries).
Il s'agit d'une adaptation argumentée et testée, pas d'une norme imposant un
nombre de mots ni d'une preuve scientifique d'optimalité.

Les nouveaux groupes respectent les plafonds du
[dossier de recherche](SUBTITLE_CONFERENCE_RESEARCH_20260929.md) : 7 secondes,
deux lignes de 42 caractères, largeur réelle en taille Gros, 21 caractères/s.
17 caractères/s est une préférence, pas une obligation. Les segments d'entrée
déjà hors limites sont conservés tels quels : aucun mot n'est supprimé,
réécrit ou déplacé vers un horodatage inventé.

## Séparation développement / évaluation

- **Sirat, épisode 4** : 966 segments, environ une heure, développement déjà
  examiné. La candidate et ses empreintes ont été figées au commit `96656a9`.
- **Conférence Dedew** (`hM_hCQ6RUcc`) : 384 segments, 15 min 41 s, une seule
  évaluation après gel. Sa traduction archivée avait servi à des comparaisons de
  modèles, mais pas à ajuster ce regroupement. Elle n'est donc pas une donnée
  entièrement inconnue de l'historique du projet.
- **Reportage France 24** (`gbrDbQVYDuQ`) : 28 segments, 2 min 19 s, contrôle
  additionnel partiellement exposé auparavant. Ce n'est pas une seconde
  conférence indépendante.

Aucun ajustement de S1 après consultation de la réserve. Les empreintes des
entrées et du code sont dans `SELECTION.json` et les résumés versionnés du labo.

## Mesures

« Paires » = regroupement actuellement applicatif. « Prototype » = premier
prototype progressif livré sur le Mac. « S1 » = cette nouvelle candidate.
Les catégories de mots servent à comparer les distributions, pas à définir une
taille idéale universelle. Les coupures internes sont détectées par ICU.

| Sirat | Paires | Prototype | S1 |
|---|---:|---:|---:|
| Sous-titres | 827 | 826 | 793 |
| Mots moyens | 10,26 | 10,28 | 10,70 |
| Mots médians | 10 | 10 | 10 |
| Sous-titres de 1–3 mots | 33 | 48 | 23 |
| De 4–9 mots | 336 | 312 | 292 |
| De 10–16 mots | 391 | 399 | 411 |
| De 17 mots et plus | 67 | 67 | 67 |
| Coupures internes aux phrases | 387 | 350 | 344 |
| Dont frontières non ponctuées | 168 | 145 | 145 |
| Au-dessus de 17 caractères/s | 281 | 269 | 276 |
| Au-dessus de 21 caractères/s | 130 | 114 | 114 |

Les écrans de 1–3 mots occupent 1,49 % du temps sous-titré contre 1,98 % avec
les paires et 2,67 % avec le prototype. Les 8 488 mots sont conservés.

| Dedew, réserve | Paires | Prototype | S1 |
|---|---:|---:|---:|
| Sous-titres | 329 | 290 | 288 |
| Mots moyens | 8,94 | 10,14 | 10,21 |
| Mots médians | 9 | 10 | 10 |
| Sous-titres de 1–3 mots | 18 | 6 | 1 |
| De 4–9 mots | 173 | 123 | 128 |
| De 10–16 mots | 129 | 150 | 148 |
| De 17 mots et plus | 9 | 11 | 11 |
| Coupures internes aux phrases | 203 | 172 | 170 |
| Dont frontières non ponctuées | 48 | 40 | 40 |
| Au-dessus de 17 caractères/s | 208 | 185 | 189 |
| Au-dessus de 21 caractères/s | 141 | 109 | 109 |

Sur Dedew, les écrans de 1–3 mots passent de 2,69 % à 0,09 % du temps sous-titré.
Les deux nouveaux groupes de 17 et 18 mots tiennent chacun sur deux lignes,
durent 4 et 4,8 secondes et demandent respectivement 19,75 et 14,38 caractères/s.
Il y a donc une petite augmentation de cette catégorie, pas une absence de
tout compromis.

Le reportage reste **strictement inchangé** : 28 sous-titres, moyenne 12,61 mots,
aucun écran de 1–3 mots. C'est une abstention lorsque les limites empêchent des
regroupements, pas une preuve de gain.

## Exemples relus

`|` représente un changement de sous-titre, pas un retour à la ligne.

- **Sirat, 10:23–10:28** : « le riche encore plus riche et le pauvre | encore
  plus pauvre. » devient une seule unité complète. La phrase suivante démarre
  séparément : « C'était donc aussi l'un des maux… ».
- **Sirat, 39:13–39:26** : « Les chiffres que | les statistiques donnent sur le
  nombre d'avortements | d'enfants tués, mes chers amis, se comptent en millions. »
  devient « Les chiffres que les statistiques donnent | sur le nombre
  d'avortements d'enfants tués, | mes chers amis, se comptent en millions. »
  La phrase reste coupée, mais les articulations sont plus lisibles.
- **Dedew, 08:19–08:25** : « … disent : | l'invention | est fille du besoin.
  Quand le besoin survient, on invente une solution, » devient « … disent :
  l'invention est fille du besoin. | Quand le besoin survient, on invente une
  solution, ». Le gain porte sur la phrase entière, pas seulement le mot isolé.
- **Dedew, 13:23–13:33** : « qui certes ne comporte aucune imperfection, ni rien
  qui mène à une incarnation, | ni rien qui mène à une localisation, » devient
  « qui certes ne comporte aucune imperfection, | ni rien qui mène à une
  incarnation, ni rien qui mène à une localisation, ».

## Compromis et limites observés

- Une nouvelle coupure reste discutable sur Sirat : « puis avancer jusqu'à la
  naissance | du Prophète. Mais il y a une question importante » au lieu de
  « puis avancer | jusqu'à la naissance du Prophète… ». Un équilibre numérique
  ne sait pas toujours préserver un groupe grammatical.
- Sur Dedew, « … lorsqu'on les interrogea | sur la présence générale de Dieu, »
  est une coupure moins naturelle que conserver ce complément avec son verbe.
- À 46:16 sur Sirat, « Un | jour » reste séparé : « Un » appartient à un segment
  précédent dont le regroupement minimal durerait 7,1 secondes. Résoudre cela
  demanderait de relâcher une limite ou de disposer d'un alignement plus fin.
- Les écrans au-dessus de 17 caractères/s augmentent légèrement par rapport au
  prototype, tout en restant moins nombreux qu'avec les paires.
- Les exceptions préexistantes restent nombreuses : 230 sur Sirat, 116 sur
  Dedew, 16 sur le reportage. Certaines dépassent deux lignes, sept secondes ou
  21 caractères/s. Le regroupement ne corrige pas un segment indivisible trop
  long ou trop rapide.
- L'anticipation du dernier segment d'un groupe atteint 6,5 secondes sur Sirat,
  5 secondes sur Dedew. Quelques pauses internes dépassent 500 ms : respectivement
  2 et 6 groupes, maximum 980 et 1 100 ms. Ce compromis répond aux pauses au
  milieu des phrases, sans démontrer que chaque anticipation est agréable.
- Les citations, abréviations et réponses d'un mot peuvent rendre les diagnostics
  de fragments ambigus. Pas de diarisation ni de garantie sur les changements
  d'orateur ; pas de nouvelle évaluation de la traduction.

Le gain sur une conférence réservée est encourageant mais ne suffit pas à
revendiquer une généralisation universelle. La réserve est désormais consommée
pour cette campagne : ne pas la réutiliser comme réserve après ajustement.

## Vérifications et preuves

- 9 tests de mécanisme : phrases entières, virgule, équilibre, début/fin de phrase,
  réponse complète d'un mot, Unicode/abréviations, limites temporelles et texte long.
- Invariants de couverture, ordre, texte et timestamps sur les trois jeux.
- Relecture textuelle de toutes les régions modifiées : **97 comparaisons sur
  Sirat** (56 face aux paires, 41 face au prototype), **64 sur Dedew** (56 et 8),
  ainsi que les fragments détectés et leur contexte. Les comparaisons peuvent
  concerner les mêmes portions du corpus ; ce ne sont pas 161 extraits indépendants.
- Rendu libass vérifié pour **1 109 sous-titres** : aucun débordement vidéo,
  tous les nouveaux groupes sur deux lignes au maximum, taille Gros identique.
  Cela ne signifie pas que les exceptions d'entrée tiennent sur deux lignes.
- Pas de visionnage humain intégral d'un nouveau MP4, ni de mesure expérimentale
  de compréhension. Les métriques et la relecture sont celles de l'agent.
- Exécution isolée sans réseau, secrets ou volumes applicatifs ; durée bornée,
  aucune requête IA, aucun traitement en arrière-plan restant.

Preuves complètes privées : `web/.cache/sentence-grouping-20260929/`, essais
`dev-s1`, `reserved-dedew-s1`, `control-news-s1`. Chaque essai contient les
partitions, métriques, régions relues, journaux, ASS/SRT et contrôles libass.
Les résumés et empreintes sont versionnés dans le dossier du laboratoire ; les
textes complets et vidéos restent hors Git.
