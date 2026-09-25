# Reprise supervisée : Gemini 3.1 Flash Lite high / GPT-6 Luna medium

## Décision et protocole

Le propriétaire demande de recommencer la comparaison et autorise la supervision.
Objectif : déterminer si 3.1 Lite mérite son surcoût face à Luna medium, en
séparant qualité du français, fidélité, alignement, validité technique et coût
avec reprises. Pas de changement applicatif ni de déploiement.

Essai sur le corpus connu de 384 segments / 940,7 s, quatre blocs temporels
(90, 114, 103 et 77 segments), résumé cumulatif ≤1500 caractères et cinq lignes
bilingues précédentes. Prompt métier inchangé. Aucune erreur connue n’est
communiquée au modèle. Chaque modèle construit sa propre mémoire. Aucun
contexte futur. Le premier modèle exécuté alterne d’un bloc à l’autre ; Luna
commence le premier. Les deux modèles passent par OpenRouter, fournisseur
OpenAI ou Google AI Studio imposé et métadonnées Generation vérifiées.
Luna utilise Responses et Gemini Chat : ce n’est pas une isolation causale
parfaite du modèle seul. JSON Schema strict demandé, validation métier locale,
aucune réparation. Parallel search/fetch proposés aux deux, pas de moteur natif.
Pas de corpus religieux local disponible dans ce benchmark.

Politique fixée avant les réponses : une tentative initiale et au plus une
reprise identique par bloc si une réponse HTTP 200 échoue à la lecture JSON ou
à la validation. Aucune consigne corrective supplémentaire. Arrêt de la chaîne
après deux réponses invalides ; le concurrent peut poursuivre. Pas de retry
pour erreur HTTP, timeout ou provenance non vérifiée. Chaque tentative est
archivée et facturée dans le bilan. Pas de plafond client de tokens de sortie ;
300 secondes par appel, 16 appels de traduction maximum, seuil d’arrêt entre
appels de 2 USD déclarés pour l’ensemble. Ce seuil n’est pas un plafond absolu
sur les appels en vol et les coûts absents. Superviseur externe : bail renouvelé
par l’agent sous 60 secondes, 5400 secondes maximum, aucun redémarrage.

L’échantillon est déjà connu et ne sert pas de test indépendant de généralisation.
Comparer notamment les IDs 1, 6–7, 55–57, 71–87, 115–116, 141, 144, 151, 159,
198, 253, 276, 282, 288–290, 293, 295, 298, 306, 322, 334, 347–348, 357–358,
365, 372, 378, 401, avec leurs voisins. Distinguer erreur certaine, explicitation
et choix de style ; pas de taux global d’erreur extrapolé d’une lecture ciblée.
Sans source audio ni relecteur humain indépendant, aucune certification des
citations. Un gain de format seul n’établit pas un gain de fidélité. Promotion
uniquement si la comparaison complète montre un bénéfice concret justifiant le
coût ; sinon conserver une conclusion provisoire/inconclusive.

## Exécution

Bruts : `data/model_outputs/lite-vs-luna-replay-20260925-01/`.
Runner : `web/review/luna-comparison/lite_vs_luna.py`.
Commande reproductible, payante, sous supervision :

```sh
make web-lite-vs-luna BENCHMARK_OUTPUT=data/model_outputs/lite-vs-luna-NOUVEAU
```

Sur ce VPS : `web/.cache/make`. Ne pas relancer dans un dossier existant.
Les résultats seront documentés après l’arrêt des appels.

## Notes de lecture — premier bloc

Lecture des 90 segments source avec les deux sorties acceptées. Les deux
conservent cette fois les IDs et le contenu des lignes 71–87 ; pas de décalage
prolongé comme lors du précédent essai Luna. Le vers 6–7 reste sur ses lignes.

- ID 1 : les deux préservent le reproche de restriction ; Gemini est plus
  littéral, Luna plus synthétique. Pas de contresens comme celui de DeepSeek.
- ID 56 : Gemini conserve « se battent parce que », Luna atténue en « se
  quereller en disant ». Avantage Gemini sur la précision de l’action et du lien.
- ID 9 : Gemini écrit « C’est sous-entendu dans le reste des contextes » ;
  l’arabe décrit une dissimulation dans le passage sur le visage. Cette
  lecture métalinguistique paraît déplacée. Luna « Le reste est dissimulé »
  s’accorde mieux au contexte. Réserve interprétative à vérifier au son.
- ID 48 : Luna « C’est ce que Gabriel a révélé » est moins précis que
  Gemini « C’est ce que Gabriel a apporté », proche du verbe arabe.
- Français de Luna généralement plus direct ; Gemini conserve des calques
  (« c’est Gabriel qui l’a descendu », « fondements et ramifications »),
  des parenthèses et des translittérations supplémentaires. Ce n’est pas
  nécessairement une erreur de sens, mais demande plus de finition.

Ces notes ne permettent pas à elles seules de promouvoir un modèle.

## Notes de lecture — deuxième bloc

Lecture des 114 segments de chaque sortie acceptée face à l’arabe.

- IDs 115–116 : Gemini « démenti envers Dieu / Son Messager » est plus précis
  que Luna « renient Dieu / Son Messager », susceptible d’évoquer un rejet
  religieux plus général. Avantage Gemini sur cette nuance sensible.
- ID 128 : Luna préserve la condamnation personnelle de l’individu ; Gemini
  « par le juge lui-même » rattache l’insistance au juge, ce qui déplace
  l’accent juridique. À relire dans l’enchaînement 126–128.
- IDs 141 et 198 : les deux conservent le Messager à son ID et les Africains.
  ID 159 : les deux rendent correctement l’idée de non-multiplicité de l’Éternel.
- ID 144 : les deux explicitent l’activité (« creuser ces questions » /
  « l’expliquer »). Ce n’est pas une garantie de fidélité littérale parfaite.
- ID 151 : Luna « objecter » et Gemini « soulever une objection » restent
  proches ; aucun gain décisif de Gemini face à la réserve historique.
- Gemini contient des constructions maladroites à 181 (« C’est ce que,
  lorsque... ») et 193–194 (deux verbes conjugués mal raccordés), ainsi
  qu’une insertion éditoriale entre crochets à 178. Luna est plus fluide.
- Le raccord 202–205 doit être examiné au bloc suivant : Luna reformule
  l’amorce négative « il n’est pas possible » en « Ainsi ».

## Notes de lecture — troisième et quatrième blocs

Lecture des 180 segments acceptés de Gemini face à l’arabe ; lecture diagnostique
ciblée des deux réponses Luna invalides au troisième bloc, sans réparation ni
import. Au total : 384 segments Gemini et 204 segments Luna acceptés relus.

- Gemini 253 : « flanc : envers Dieu », sans compléter artificiellement la
  citation. Le lien entre le terme expliqué et le français reste difficile à
  saisir. Luna invalide : première tentative « dans le côté de Dieu », seconde
  « au sujet de ce qu’ils ont négligé à l’égard de Dieu ». La seconde ajoute
  des mots absents du fragment, comme lors de l’essai historique. Ni l’une ni
  l’autre ne constitue une traduction acceptée.
- Gemini 276 rend correctement la corporéité, sans substituer l’incarnation.
  282 conserve le nom à sa ligne ; 288–290 raccorde correctement le raisonnement.
- Gemini 302 anticipe « sans qu’Il soit leur quatrième », qui appartient à
  303. Les IDs sont conformes, mais une partie de citation apparaît trop tôt.
- Gemini 322 conserve visage/essence ; 357–358 garde la phrase et ses deux
  segments ; 365 dit correctement « sur les propos du Cheikh » ; 378 conserve
  « à Lui ». Ces points sont meilleurs que certaines anciennes sorties Luna,
  mais aucun bloc 4 Luna n’a été généré dans cette comparaison.
- Gemini 347–348 anticipe « S’est établi » puis le répète. Le problème
  historique de répartition entre sous-titres n’est donc pas entièrement réglé.
- Gemini 334 ajoute « Oui » et choisit « Son » pour le pronom, alors que
  le passage oppose justement plusieurs référents. Lecture interprétative à
  contrôler, pas une référence sûre en l’absence d’audio.
- Gemini ajoute des gloses entre crochets et du Markdown dans les textes
  (254–255, 267, 328–329, 335, 358, 373, 389, 401...). Cela alourdit les
  sous-titres. À 401 « Dieu en a informé » manque de complément idiomatique ;
  « Dieu nous en a informés » serait plus naturel sans ajouter « dans le Coran ».
- Le raccord de question 202–206 reste lourd et mérite un travail éditorial.
  Ne pas attribuer systématiquement toute difficulté au modèle : la source
  contient elle-même des ellipses et changements de construction.

Aucune trace de raisonnement interne n’a été lue pour ces observations.

## Résultats finaux

| Condition | Appels, reprises incluses | Blocs acceptés | Segments acceptés | Temps cumulé des appels | Coût USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Luna medium | 4 | 2/4 | 204/384 | 195,959 s | 0,007038045 |
| Gemini 3.1 Lite high | 4 | 4/4 | 384/384 | 164,266 s | 0,044681750 |

Gemini : quatre succès initiaux. Luna : deux succès, puis deux JSON invalides
au troisième bloc ; arrêt sans lancer le quatrième. Les erreurs Luna sont des
clés mal formées, autour de 293 à la première tentative et de 287 à la seconde,
pas une limite de sortie atteinte. Chaque tentative est conservée. Le mode
strict était demandé : la cause du non-respect côté chaîne de service n’est pas
établie, et ne doit pas être assimilée directement à une moindre intelligence.

Sur les **deux blocs communs acceptés**, Gemini coûte 0,028210 USD contre
0,00359755 USD pour Luna, soit **7,84 fois plus**. Temps respectifs : 91,645 s
et 92,956 s, un écart trop faible et non répliqué pour conclure sur leur vitesse.
Pour Gemini complet seulement, extrapolation à densité comparable :
**0,171 USD par heure de source**, hors transcription, export et hébergement.
Pas d’extrapolation du coût de cette sortie Luna incomplète en prix d’une heure
livrée. Total connu de la campagne : **0,051719795 USD**.

High/medium sont bien demandés et conservés dans les requêtes. Le fournisseur
rapporte néanmoins zéro token de raisonnement pour le troisième bloc Gemini ;
les trois autres en rapportent 5210, 4504 et 3860. Ce champ ne permet pas de
prouver que l’effort demandé a été effectivement exercé à chaque appel.
Aucun appel aux outils web n’a été rapporté : le prix ne qualifie pas un usage
intensif des recherches. Provenance Generation conforme pour les huit appels ;
les incohérences du champ provider des réponses Chat restent documentées.

Les résumés et cinq lignes précédentes ont été vérifiés dans les requêtes de
chaque chaîne : transmission exacte, sans mélange entre modèles. Pas de plafond
client de sortie ajouté ni de modifications de prompt au fil des tentatives.
22 tests hors API réussis (20 runner/superviseur + 2 parité prompt), dont des
simulations de chaîne complète, d’arrêt après deux invalidités et de non-reprise
après timeout. Aucun appel payant dans les tests.

## Conclusion et limites

Cet essai renforce **l’intérêt pratique de Gemini 3.1 Flash Lite high** : il
livre tout le fichier sans intervention, pour un coût absolu encore faible.
Il ne démontre pas un meilleur rapport *fidélité pure/prix* : Luna est beaucoup
moins cher et plus naturel sur les passages communs ; Gemini préserve certaines
nuances mais introduit ses propres problèmes de sens, d’alignement et de gloses.
Le précédent essai Gemini avait aussi échoué au troisième bloc : ce succès ne
prouve pas sa fiabilité universelle.

Pour un premier jet complet avec relecture humaine, Gemini est un candidat
plus convaincant qu’avant cette reprise. Si le critère dominant est le coût des
appels et si l’intégration sait récupérer proprement les échecs, Luna reste
pertinent. Ne qualifier aucun de ces résultats comme traduction sans relecture.
Une généralisation exige un corpus réservé et une validation humaine ; cet essai
sur corpus connu ne remplace pas ces vérifications. Aucune adoption en production.

Preuves versionnées :
[`lite-vs-luna-replay-results-20260925.json`](../web/review/luna-comparison/lite-vs-luna-replay-results-20260925.json).
Superviseur terminé normalement ; aucun appel ni retry ne reste actif.
