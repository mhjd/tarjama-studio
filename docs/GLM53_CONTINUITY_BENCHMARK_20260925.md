# GLM-5.3-Flash : quatre minutes et mémoire de continuité

## Protocole demandé

Essai isolé du 25 septembre 2026, sur `z-ai/glm-5.3-flash`, raisonnement `high`
comme lors du benchmark précédent (`medium` absent des efforts proposés).
Même corpus arabe de 384 segments et même prompt de traduction métier, augmenté
d'un contrat expérimental de continuité. Aucun changement de l'application.

- Blocs temporels de quatre minutes au maximum, sans couper de segment.
- Sortie : `segments` et `continuity_summary`, un résumé cumulatif en français
  de 1 à 1500 caractères, produit dans le même appel et séparé des sous-titres.
- Au bloc suivant : résumé validé précédent et cinq dernières lignes arabes,
  avec leur français accepté. Pas de contexte futur. Premier bloc sans mémoire.
- Résumé orienté sujet, intervenants, référents, terminologie et incertitudes.
  Il s'appuie sur l'arabe et ne doit pas ajouter de faits.
- Validation stricte du JSON, de la longueur du résumé, des IDs, de l'ordre et du
  nombre de segments ; aucun ID de contexte autorisé dans la sortie.
- Exécution séquentielle, arrêt au premier bloc invalide, pas de réparation JSON,
  pas de reprise cachée, attente maximale de 300 secondes par appel.
- Outils Parallel search/fetch disponibles, paramètres identiques au précédent
  essai. Pas de nouvel appel séparé de qualification web ni de difficultés courtes.
- Coût du résumé inclus dans les tokens/coûts de chaque réponse. Un résumé
  syntaxiquement valide n'est pas une garantie de fidélité sémantique : il pourrait
  transmettre une interprétation erronée aux blocs suivants.

| Bloc | Segments | Intervalle source |
| --- | ---: | --- |
| 1 | 90 | 0–237,12 s |
| 2 | 114 | 237,12–474,68 s |
| 3 | 103 | 474,68–709,98 s |
| 4 | 77 | 737,98–940,70 s |

Le saut de 28 secondes avant le dernier bloc appartient au corpus initial ; aucun
segment n'est supprimé ou ajouté. Les quatre blocs couvrent exactement les 384
segments existants.

## Résultats

### Première tentative

Premier bloc : **212,029 s**, HTTP 200, réponse refusée car entourée de balises
Markdown `json` ; le contenu intérieur est analysable mais n'est pas accepté par
le validateur strict. 90 objets lisibles, 90 IDs uniques, résumé de 1387 caractères.
Aucun bloc suivant n'est lancé. Coût déclaré **0,012935065 USD**, dont
0,001935065 USD de calcul amont déclaré ; différence de 0,011 USD cohérente avec
les deux recherches web déclarées (aucun fetch déclaré). Usage : 19 441 tokens
entrée, 10 005 sortie dont 7 274 de raisonnement. Aucun appel à un autre modèle.

Relecture des 90 sous-titres récupérables à titre diagnostique : ensemble
compréhensible, sans le décalage massif d'IDs du précédent essai, mais pas sans
erreurs. ID 1, « Le champ est vaste, et l'acception restreinte a aussi son poids »
ne restitue pas le reproche de restreindre ce qui est vaste dans
`حجّر واسعًا وضيّق كبيرًا`. ID 4, « le chemin qui monte à la montagne », ajoute
une montée absente de `الطريقة في الجبل` (chemin dans la montagne). ID 48,
« C'est ce sur quoi Jibril est descendu », est un calque peu naturel pour ce
qu'il a apporté. ID 56 transforme le fait de se battre parce qu'on appartient
à telle université en dispute « pour savoir si tel est de al-Azhar ».

Le résumé couvre les notions principales et explicite une incertitude au
segment 1. Mais il affirme que le bloc s'interrompt au milieu de l'énumération
des six articles de foi, alors que les six figurent déjà dans les dernières
lignes. Il attribue également des rôles d'intervenants que ces seuls segments
ne permettent pas de certifier. La mémoire peut donc elle-même introduire des
hypothèses ; sa validation de forme ne suffit pas.

### Seconde tentative explicite

Même protocole, nouveau dossier `glm53-high-4min-continuity-20260925-02`, sans
modifier le premier résultat. Corps de requête identique octet pour octet.
Réponse après **172,910 s**, HTTP 200, de nouveau refusée : JSON mal formé à
l'ID 18 (`"id":"18":"en tant que…"` au lieu des champs attendus).
89 objets lisibles sur 90 cibles, résumé présent mais non accepté. Aucun bloc
suivant lancé. Coût **0,000903075 USD**, entrée 4351 tokens, sortie 6124 dont
3878 de raisonnement ; aucun appel outil déclaré.

### Bilan

**Deux tentatives du premier bloc, zéro sortie conforme.** Le mécanisme de
transmission du résumé et des cinq lignes est implémenté, mais **n'a pas pu être
qualifié entre deux appels réels**, puisque le premier bloc échoue à chaque fois.
Aucune suppression automatique des balises ni réparation de JSON. Cette
limite est essentielle : on ne sait pas si le résumé améliorerait les blocs
suivants, ni s'il y propagerait certaines erreurs.

Coût total déclaré **0,01383814 USD**, temps d'attente cumulé **384,939 s**
(6 min 25 s), sans coût inconnu sur ces deux réponses. Aucun prix par heure
traduite validée ne peut être calculé : le corpus n'a pas abouti. La première
réponse dépense 0,011 USD de plus en outils que la seconde ; cette différence
ne s'explique donc pas seulement par la longueur des traductions.

Quatre minutes ne suffisent pas à rendre ce réglage fiable avec le contrat JSON
strict actuel. Cela ne démontre ni que toute taille de bloc échoue ni que le
résumé est inutile. Le premier refus porte uniquement sur l'enveloppe Markdown ;
une tolérance explicite à cette enveloppe serait une autre stratégie, tandis que
le second échec nécessiterait une réparation du contenu ou une nouvelle réponse.
Ces comportements doivent rester distincts dans les mesures.

Le fournisseur déclaré est `OpenAI` malgré l'ID renvoyé `z-ai/glm-5.3-flash`,
comme dans l'essai précédent. Ce rapport décrit cette route et ne certifie pas
indépendamment le moteur en amont. Aucun modèle ni déploiement de production changé.

[Mesures et empreintes vérifiées](../web/review/luna-comparison/glm53-continuity-results-20260925.json).
Neuf tests du runner et deux tests de parité des prompts passent. Le test ajouté
vérifie la séparation des cibles, du résumé et du contexte bilingue, et le refus
des IDs de contexte ou d'un résumé vide/trop long. Ce sont des tests logiciels,
pas une preuve de qualité linguistique ni de réussite de la chaîne réelle.

## Reproduction et limites

```sh
make web-luna-compare BENCHMARK_OUTPUT=data/model_outputs/glm53-4min-NOUVEAU \
  BENCHMARK_MODEL=z-ai/glm-5.3-flash BENCHMARK_REASONING=high \
  BENCHMARK_CHUNK_MINUTES=4 BENCHMARK_CONTINUITY=1
```

Archives originales : `data/model_outputs/glm53-high-4min-continuity-20260925-01`.
Chaque requête, entrée, réponse reçue, résumé de mesure, protocole, catalogue et
script exécuté est conservé sans écrasement. La clé n'est ni affichée ni archivée.

Par rapport à l'essai de dix minutes, changent simultanément la taille des blocs,
le contexte et le schéma de sortie. Cet essai juge leur combinaison, sans isoler
un effet causal de chacun. Ce corpus connu n'est pas une évaluation indépendante
sur des vidéos inédites. Les erreurs de transcription source ne sont pas vérifiées
par retour à l'audio. Aucune certification de citations religieuses.
