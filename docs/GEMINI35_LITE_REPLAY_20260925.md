# Gemini 3.5 Flash Lite high — reprise comparative

## Protocole fixé avant les appels

Essai demandé le 25 septembre 2026, après la comparaison 3.1 Lite high / Luna
medium. Réutilisation de leurs résultats archivés, sans les refacturer.
Même corpus connu, prompt, quatre blocs de quatre minutes, résumé cumulatif et
cinq lignes bilingues précédentes. Gemini 3.5 Lite high via OpenRouter / Google
AI Studio, Chat Completions, schéma JSON strict demandé, validation locale,
Parallel search/fetch seuls outils web proposés. Pas de corpus religieux local.
Aucun plafond client de tokens de sortie ; 300 secondes par appel. Une reprise
identique maximum par bloc invalide, aucune réparation du texte ou du JSON.
Arrêt après deux invalidités du même bloc ; huit appels de traduction maximum.
Seuil d’arrêt entre appels de 2 USD déclarés, qui ne plafonne pas la facture
d’un appel en vol ni les coûts manquants. Superviseur externe : bail de présence
60 secondes, délai global 3000 secondes, aucun redémarrage.

Comparer techniquement la complétude, les reprises, coûts et délais, puis relire
les traductions face à l’arabe et aux comparateurs. Ne pas considérer une sortie
JSON valide comme preuve de fidélité ou d’alignement. Examiner aussi les erreurs
connues, sans jamais les révéler au candidat. Corpus déjà vu, aucune validation
indépendante de généralisation, pas de relecteur humain ni de contrôle audio.
Comparateurs non exécutés simultanément : latences non contrôlées. High demandé
ne prouve pas le raisonnement effectivement exercé si les métadonnées sont
incomplètes. Ne pas modifier la production selon un seul essai favorable.

Comparateur principal :
`data/model_outputs/lite-vs-luna-replay-20260925-01/`.
Nouveaux bruts :
`data/model_outputs/gemini35-lite-replay-20260925-01/`.

```sh
make web-lite-vs-luna BENCHMARK_CANDIDATE=gemini35 BENCHMARK_OUTPUT=data/model_outputs/gemini35-lite-NOUVEAU
```

Sur le VPS : `web/.cache/make`. Commande payante, sous supervision externe.

## Lecture du premier bloc

Les 90 segments ont été relus face à l’arabe et aux sorties acceptées de
3.1/Luna. Pas de dérive prolongée d’IDs, les lignes 71–87 restent alignées.

- ID 1 : « rigidifier ce qui est large » est moins exact que 3.1
  (« réduit ce qui était grand »), mais sans inversion complète du sens.
- ID 9 : « Et le reste est dissimulé » est plus cohérent avec le contexte
  que l’interprétation métalinguistique de la dernière sortie 3.1.
- ID 45 : caractère parasite `u` en fin de sous-titre, malgré un JSON valide.
- ID 56 : « se disputent en disant » atténue l’action physique et la cause ;
  3.1 « se battent parce que » est plus précis.
- Le français reste lisible, mais souvent plus long que Luna ; plusieurs
  choix sont stylistiques, pas des contresens. La formule sur les écoles
  45–46 transforme une attribution en « décrète », interprétation plus libre.

## Arrêt et lecture diagnostique du deuxième bloc

Le deuxième bloc échoue deux fois : guillemets non échappés à l’ID 170 dans la
première réponse ; balises Markdown autour du JSON dans la seconde. Après retrait
**en mémoire, pour diagnostic seulement**, des balises, la seconde réponse satisfait
le contrat des 114 segments. Aucun fichier accepté n’a été créé à partir de cette
normalisation, aucune poursuite cachée de la chaîne. Ce défaut d’emballage pourrait
être traité sans nouvelle génération ; ce run conserve cependant la même règle
stricte que ses comparateurs. Une future normalisation devra s’appliquer à tous
les candidats et être évaluée séparément.

Lecture des 114 lignes de cette seconde réponse face à la source :

- ID 144 : « Nous ne nous infligeons pas de peine à ce sujet » reste proche
  de l’arabe, sans ajouter « expliquer » ou « creuser » comme 3.1/Luna.
- ID 128 : l’insistance porte bien sur l’individu, contrairement au « juge
  lui-même » de 3.1, mais le raccord « qu’un juge ne le lui applique
  personnellement » est maladroit.
- ID 159 : « l’Ancien ne se multiplie pas » est beaucoup moins clair dans
  ce contexte théologique que « L’Éternel ne peut être multiple » (Luna)
  ou « L’Éternel n’est pas multiple » (3.1). Ce n’est pas une amélioration.
- ID 151 : « soulever d’objection » est proche des autres modèles ; aucun
  avantage décisif pour la réserve historique « soulever une difficulté ».
- IDs 115–116 : « déni envers » est moins précis/idiomatique que « démenti
  envers » de 3.1. Éviter de transformer ce constat lexical en taux global.
- IDs 141 et 198 restent présents avec leur sens essentiel. Quelques
  anticipations minimes subsistent (131 empiète sur 132), pas de décalage
  prolongé comme dans une ancienne sortie Luna.
- Le français comporte des formulations lourdes (« foi y afférente »,
  « pèleriner à la Maison », « sources de réception ») et un raccord
  syntaxique mal formé à 181–183. Luna est généralement plus naturel.

204 segments 3.5 ont donc été lus : 90 acceptés et 114 en diagnostic seulement.
Les blocs 3–4 n’ont pas été produits. Impossible de comparer 3.5 sur les erreurs
253, 347–348 ou 365, ni de certifier ses citations. Les traces internes de
raisonnement n’ont pas été consultées.

## Mesures et comparaison

| Essai | Blocs acceptés | Appels (échecs inclus) | Temps cumulé | Coût USD |
| --- | ---: | ---: | ---: | ---: |
| 3.5 Lite high, nouveau | 1/4 | 3 | 133,479 s | 0,0581436 |
| 3.1 Lite high, dernier essai archivé | 4/4 | 4 | 164,266 s | 0,04468175 |
| Luna medium, dernier essai archivé | 2/4 | 4 | 195,959 s | 0,007038045 |

Le coût 3.5 inclut 0,0225813 USD au premier bloc, puis 0,0238174 et 0,0117449
USD pour les deux tentatives du deuxième. Le premier bloc accepté commun coûte
**1,62 fois plus que 3.1** et **12,84 fois plus que Luna**. Temps du premier
bloc : 46,640 s (3.5), 46,531 s (3.1), 42,852 s (Luna). Une observation par
condition et dates non simultanées : pas de classement robuste de vitesse.
Pas d’extrapolation en prix par heure livrée pour 3.5, chaîne incomplète.

Les trois appels sont déclarés Gemini 3.5 Flash Lite, Generation indique
Google AI Studio / `google/gemini-3.5-flash-lite-20260721`. Le champ provider Chat
incohérent ne remplace pas ce contrôle. Aucun appel web rapporté. High est bien
présent dans les trois requêtes ; tokens de raisonnement déclarés : 5110, 4792,
puis 0. L’exécution exacte de l’effort ne peut pas être attestée indépendamment.

Prompt et corpus ont les mêmes empreintes que le comparateur principal ; même
règle de reprise, délais, schéma et continuité. Résumé et cinq lignes précédentes
vérifiés exactement dans les deux tentatives du deuxième bloc.

Gemini 3.8 high avait terminé ses quatre blocs pour 0,30602625 USD dans un essai
historique, mais avec JSON simple et plafond de sortie : contexte utile seulement,
pas une comparaison contrôlée avec ce nouveau run. DeepSeek et les autres Luna
n’ont pas été relancés et leurs protocoles antérieurs diffèrent également.

## Décision

**Pas de raison observée de préférer 3.5 Lite à 3.1 Lite** : aucun gain global de
fidélité établi, français encore maladroit, coût supérieur et chaîne incomplète
avec la même règle d’acceptation. 3.5 corrige certains détails mais en dégrade
d’autres. Cela ne signifie pas que le modèle est universellement inférieur :
l’échantillon est petit, connu et les générations varient. Son échec sur une
balise ne doit pas être présenté comme une mauvaise traduction de tout le bloc.

Conserver la préférence provisoire pour 3.1 Lite high comme candidat pratique,
et Luna medium comme option économique à fiabiliser. Aucun changement en
production. Les appels sont tous arrêtés, aucune relance au-delà du protocole.

23 tests hors API réussis : 21 tests runner/superviseur, dont vérification que
le mode 3.5 ne relance pas les comparateurs, et 2 tests de parité du prompt.
Preuves :
[`gemini35-lite-replay-results-20260925.json`](../web/review/luna-comparison/gemini35-lite-replay-results-20260925.json).
