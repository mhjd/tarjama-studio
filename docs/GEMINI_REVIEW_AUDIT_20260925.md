# Audit des requêtes de révision Gemini — 25 septembre 2026

## Vérifications et hypothèses avant les nouveaux appels

L'utilisateur conteste à juste titre l'interprétation d'une révision presque vide
et demande de vérifier le prompt, la requête et le niveau de raisonnement.

- Les relectures précédentes demandaient bien `reasoning.effort=medium` ; usage
  déclarait 7861 puis 11569 tokens de raisonnement. Le raisonnement n'était pas
  simplement absent. La traduction Gemini réussie utilisait **high**.
- Les 384 segments arabes ET leurs traductions Luna étaient bien envoyés, sur
  940,7 s. La relecture est plus longue que chaque bloc de traduction : environ
  58 689 caractères d'entrée, contre 5032 pour son premier bloc de traduction.
- Schéma strict bien transmis dans `response_format`. Toutefois, le texte du
  prompt v1 ne reprenait pas les champs exacts ni les valeurs de confiance, disait
  « justification », et n'interdisait pas explicitement les balises Markdown.
  Les réponses utilisaient précisément `justification`, une confiance numérique
  ou `high`, et des balises. C'est une faiblesse évitable du contrat exprimé dans
  le prompt ; ce constat ne démontre pas à lui seul pourquoi les erreurs de sens
  étaient manquées, ni quelle couche a ignoré le schéma natif.
- v1 demandait une relecture globale mais ne détaillait pas un contrôle systématique
  de chaque segment suivi d'une vérification des raccords après correction.

La [documentation OpenRouter du raisonnement](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
confirme l'option `reasoning.effort` et la facturation des tokens de raisonnement
comme sortie. Les catalogues déjà archivés annoncent high et medium pour Gemini 3.8.
Les compteurs ne prouvent pas indépendamment la force interne exacte appliquée.

## Deux appels prévus, sans boucle d'optimisation

A. **high / v1**, sans plafond de tokens de sortie client : identique au dernier
   essai medium/v1 hormis l'effort demandé.
B. **high / v2**, même corpus, transport, outils, fournisseur et schéma : prompt
   de contrôle segment par segment, examen des corrections dans leurs voisins,
   champs/valeurs explicites et schéma répété dans la consigne textuelle.

Même Gemini 3.8 Flash via Google AI Studio imposé, provenance Generation contrôlée.
Même traduction Luna de départ ; aucune correction Gemini précédente réinjectée.
Aucun ID d'erreur connu ni exemple de réponse attendue envoyé. Les cinq points
suivis restent ceux du test de seconde passe Luna. Il s'agit d'un corpus de
mise au point déjà connu : une amélioration éventuelle ne démontrerait pas la
qualité sur des vidéos nouvelles.

Deux appels au maximum, un par variante, sans retry automatique. Pas de limite
artificielle de sortie, ni budget séparé de raisonnement. Délai de 300 s par appel.
Surveillant externe avec lease 60 s, aucun renouvellement autonome :
`web/.cache/gemini-audit-guard/status.json` et `run.log`. Si coupure, ne pas relancer
automatiquement. Une requête déjà acceptée peut rester facturée après déconnexion.

## Résultats

### A : high / prompt v1

151,744 s, **0,16048575 USD**, 25 761 tokens entrée, 37 644 sortie dont
36 585 de raisonnement. Provenance Google AI Studio / Gemini 3.8 Flash daté.
Huit suggestions, aucune recherche déclarée. L'augmentation d'effort est la seule
différence de requête avec le précédent v1/medium sans plafond, vérifiée.

Parmi les points suivis, repère **253** (citation complétée) et **347–348**
(déplacement du verbe), mais pas 365, 151 ou 144. Les corrections 347–348
replacent le verbe dans son segment arabe et conservent une phrase cohérente.
La correction 253 retire bien la complétion de mémoire, sans imposer « dans le
flanc de Dieu » comme dans l'ancienne relecture Luna.

Autres alertes : 115–116 distinguent « démentir » de « nier », pertinent dans le
contexte ; 288–289 corrigent l'enchaînement syntaxique ; 372 rétablit « groupe
sauvé » et améliore « les sunnites et la communauté ». Ces alertes sont utiles,
mais le lot reste non conforme : Markdown, `justification` et confiance numérique
au lieu des champs/valeurs demandés. Lecture diagnostique, aucun correctif appliqué.

### B : high / prompt v2

137,386 s, **0,13712475 USD**, 26 043 tokens entrée, 31 358 sortie dont
30 570 de raisonnement. Google AI Studio / Gemini 3.8 Flash confirmé par Generation,
aucun appel web déclaré. Neuf suggestions, **JSON et contrat conformes**. Les
champs avant sont exacts ; IDs uniques, remplacements non vides, confiance dans
l'énumération demandée. Entre A et B, seule la consigne système change, vérifié.

Parmi les cinq points suivis, repère **347–348 uniquement**. Ne signale ni 365,
ni 253, ni les réserves 151/144. Le meilleur format ne signifie donc pas une
meilleure couverture de tous les défauts que la variante A.

Les neuf propositions concernent :

- 56–57 : « en viennent aux mains parce que » et « et celui-là » corrigent
  le motif de conflit et la coordination. Amélioration linguistique pertinente.
- 154 : rattache « en disant » au propos négatif « nous n'avons entendu personne… » ;
  clarification plausible de la portée de la négation, dont la lecture grammaticale
  ne doit pas être confondue avec une preuve d'intention orale indépendante.
- 282, 288–290 : retire un guillemet intempestif, rétablit le raccord « parmi ce
  qui est intelligible », puis ferme effectivement la citation en 290. Mieux que
  les variantes qui supprimaient seulement la fermeture prématurée.
- 347–348 : remet le verbe dans le sous-titre source correspondant, sans laisser
  de segment vide. Le français est fragmenté comme la source, mais l'ensemble
  reste cohérent.

Aucune régression évidente repérée dans ces neuf changements à la relecture,
mais aucun juge humain indépendant et aucune garantie de correction exhaustive.
Un **candidat local non appliqué** est assemblé et revalidé pour les 384 IDs ;
les sorties initiales et données applicatives restent inchangées.

## Synthèse et correction du diagnostic précédent

| Réglage | Propositions | Points suivis détectés | Format conforme | Coût USD |
| --- | ---: | --- | --- | ---: |
| Medium / v1, sans plafond | 2 | Aucun | Non | 0,049597875 |
| High / v1 | 8 | 253 et 347–348 | Non | 0,16048575 |
| High / v2 | 9 | 347–348 | Oui | 0,13712475 |

Les cinq points ne sont pas tous des erreurs certaines et ne constituent pas un
échantillon statistique. Les autres propositions utiles ne figurent pas dans ce
petit décompte, donc il ne faut pas classer la qualité totale seulement par cette
colonne. Une observation par réglage ne sépare pas totalement causalité et
variabilité des réponses.

**L'objection de l'utilisateur était pertinente : le protocole précédent ne
permettait pas de conclure sur les capacités générales de Gemini.** Le réglage
high retrouve plusieurs défauts manqués à medium dans ces essais, et un contrat
explicite dans le prompt obtient enfin une réponse exploitable par le validateur.
Il n'y avait pas absence de raisonnement, mais un effort différent du test de
traduction et une consigne perfectible. La cause exacte du non-respect antérieur
du schéma natif n'est pas isolée : ne pas attribuer cela avec certitude au modèle
seul ou à une couche OpenRouter particulière.

Il reste un échec important : l'attribution « sur les propos du cheikh » devenue
« du cheikh » n'est détectée par aucune de ces relectures. V2 manque également
la citation développée repérée par v1/high. La deuxième passe aide, mais ne suffit
pas à certifier le résultat. Avant intégration, vérifier sur un passage inédit
et évaluer faux positifs/régressions, sans optimiser uniquement sur ces exemples.

Coût des **deux appels de cet audit : 0.29761050 USD**. Pour une stratégie
Luna initial + seule révision Gemini high/v2 : **0.145269645 USD** sur 15 min 40,7 s,
soit **0.556 USD/h** par extrapolation à densité similaire. C'est environ
2,1 fois moins que la traduction intégrale Gemini high testée, mais sans preuve
que la qualité finale lui soit égale. Coût d'une stratégie testée avec erreurs
résiduelles, hors ASR/export/hébergement. Raisonnement majoritaire dans la sortie,
aucun plafond artificiel client et aucun coût inconnu pour ces deux réponses.

Aucun appel restant, superviseur terminé normalement ; aucun déploiement ni
correctif appliqué en production.

[Preuves, propositions et mesures](../web/review/luna-comparison/gemini-review-audit-results-20260925.json).
Treize tests runner et deux tests de parité des prompts passent. Le contrôle réel
vérifie aussi les différences exactes des requêtes et l'absence de plafond client.

## Reproduction

```sh
make web-luna-review BENCHMARK_OUTPUT=data/model_outputs/gemini-audit-NOUVEAU \
  BENCHMARK_MODEL=google/gemini-3.8-flash BENCHMARK_NO_OUTPUT_LIMIT=1 \
  BENCHMARK_REASONING=high BENCHMARK_PROMPT_VERSION=v2
```

Utiliser v1 pour le contrôle A. La commande seule ne fournit pas le surveillant
externe. Pas de déploiement ni application des suggestions. v1/medium reste le
défaut pour préserver la reproductibilité des anciens tests.
