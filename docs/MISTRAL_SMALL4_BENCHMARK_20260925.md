# Mistral Small 4 — comparaison supervisée

## Protocole fixé avant les réponses

Le catalogue public OpenRouter identifie `mistralai/mistral-small-2603` comme
**Mistral Small 4**. Raisonnement disponible : high / none ; choix high pour
comparer avec les Gemini. Fournisseur Mistral imposé via OpenRouter, aucune
substitution ni fallback. Catalogue et endpoints revérifiés et archivés par
le runner, provenance vérifiée via Generation après chaque appel.

Même corpus connu (384 segments / 940,7 s), prompt métier, quatre blocs temporels
de quatre minutes, résumé cumulatif et cinq lignes bilingues précédentes que
les derniers essais Gemini/Luna. Chat Completions, schéma JSON strict demandé,
validation locale des IDs et des champs. Parallel search/fetch disponibles,
pas de moteur natif ni de corpus religieux local. Aucun plafond client de tokens
de sortie ; 300 secondes par appel. Une reprise identique maximum par bloc
invalide ; arrêt après deux invalidités, sans réparation cachée ni poursuite
avec une mémoire invalide. Pas de retry HTTP/timeout/provenance. Huit appels de
traduction maximum, seuil de 2 USD déclarés entre appels (pas un plafond absolu
sur un appel déjà accepté). Superviseur avec présence de l’agent sous 60 secondes,
délai global 3000 secondes, aucun redémarrage.

Comparer fidélité, fluidité, alignement, format, temps et coût avec les résultats
archivés ; aucun nouvel appel aux comparateurs. Lire l’arabe et les sorties,
examiner les points déjà repérés sans les révéler au candidat. Corpus connu,
pas de validation indépendante ni d’écoute source : pas de promesse sans erreurs
ou de généralisation. Les différences d’API, de fournisseur et d’heure d’exécution
restent des facteurs confondants. Un format invalide ne prouve pas une mauvaise
traduction ; séparer lecture diagnostique et résultat accepté. Aucune modification
de l’application ni déploiement.

Bruts : `data/model_outputs/mistral4-replay-20260925-01/`.
Comparateurs principaux : `data/model_outputs/lite-vs-luna-replay-20260925-01/`
et `data/model_outputs/gemini35-lite-replay-20260925-01/`.

```sh
make web-lite-vs-luna BENCHMARK_CANDIDATE=mistral4 BENCHMARK_OUTPUT=data/model_outputs/mistral4-NOUVEAU
```

Sur ce VPS : `web/.cache/make`. Commande payante, sous surveillance externe.

## Résultat technique

- Premier bloc, première tentative : HTTP 200, 60,183 s, coût 0,00265365 USD.
  Réponse entourée de balises Markdown malgré la demande de schéma strict.
  Après retrait des balises **en mémoire pour diagnostic seulement**, les 90
  segments et le résumé satisfont le contrat. Aucune traduction acceptée créée.
- Reprise identique : HTTP **429**, 6,851 s, sans usage ni coût retournés.
  Le runner n’archive pas le corps d’erreur susceptible de contenir des données
  sensibles. Nous ne savons pas quelle limite exacte a déclenché ce refus.
  Ce n’est pas une preuve d’incapacité linguistique du modèle. Aucun retry HTTP
  n’était prévu : arrêt sans lancer les autres blocs.
- Total : deux appels, zéro bloc accepté, 67,034 s ; **0,00265365 USD connus**
  (environ 0,00233 EUR au taux de référence déjà utilisé de 1 EUR = 1,1367 USD),
  plus coût éventuel non communiqué du 429. Pas de prix par heure livrée établi.
- Generation confirme fournisseur **Mistral**, modèle
  `mistralai/mistral-small-2603`. Le champ provider Chat indique pourtant
  « OpenAI », comme lors d’autres essais ; le contrôle recoupé est conservé.
  High demandé, 580 tokens de raisonnement déclarés sur la réponse reçue.
  Aucun appel outil web rapporté.

## Lecture diagnostique des 90 segments

Le texte français a été relu intégralement face à l’arabe, sans consulter les
traces internes de raisonnement. Il reste une sortie refusée ; le diagnostic
ne transforme pas le résultat en succès et ne répare pas les alignements.

- **ID 1 : sens changé.** `حجّر واسعًا وضيّق كبيرًا` reproche de restreindre
  ce qui est vaste/grand. Mistral écrit « Il a tout mélangé et brouillé les
  pistes ». Les dernières sorties 3.1/Luna préservaient cette idée de restriction.
- **IDs 6–9 : déplacement du vers.** L’ID 6 ne garde que l’introduction,
  le début du vers passe à 7 et sa suite à 8, où l’arabe explique déjà le terme.
- **IDs 34–48 : décalage prolongé.** La bonne méthode apparaît dès 34 au lieu
  de 35 ; le Livre de Dieu passe de 36 à 35 ; la Sunna de 37 à 36. À 41,
  l’arabe parle des quatre écoles tandis que le français commence déjà la
  révélation transmise par Gabriel. À 44, Mistral parle de Chafi‘i alors que
  l’arabe dit seulement que cela n’est l’école de personne. Les IDs présents
  et ordonnés n’empêchent donc pas la désynchronisation du sous-titrage.
- **IDs 69–73 : nouveau décalage.** « Ce n’est pas exact » apparaît en 71
  au lieu de 72, et la définition de la croyance comme science en 72 au lieu
  de 73. Le texte se recale ensuite, sans corriger les lignes antérieures.
- **IDs 84–89 : anticipation et répétition.** Les six articles de foi sont
  introduits en 84 au lieu de 85, les messagers en 86 au lieu de 87 ; destin
  traduit en 87 et à nouveau en 89. Le dernier « En résumé » (90) transforme
  aussi la portée « globalement / dans l’ensemble » en connecteur discursif.
- Français fréquemment lisible mais chargé de translittérations (« madhhab »,
  « usul », « mandub »). Le résumé ajoute une « unité doctrinale » qui dépasse
  la simple comparaison des enseignements des universités, et affirme
  « Incertitudes : Aucune » ; ce n’est pas une garantie de fiabilité.

## Comparaison et avis

**Note éditoriale provisoire : 2/5 sur ce bloc**, en incluant fidélité et
alignement dans la qualité. Ce n’est pas une mesure statistique du modèle.
Les problèmes de sens et surtout les déplacements répétés des traductions
rendent cette sortie peu adaptée à Tarjama, indépendamment des balises Markdown
et de la limitation HTTP. Enlever les balises ne résoudrait pas ces défauts.

Sur le premier bloc comparable :

| Candidat | Temps | Coût USD | Observation |
| --- | ---: | ---: | --- |
| Mistral Small 4 high, première tentative | 60,183 s | 0,00265365 | Sortie refusée, décalages importants |
| Luna medium, dernier essai | 42,852 s | 0,00175905 | Bloc accepté, pas de décalage prolongé |
| Gemini 3.1 Lite high, dernier essai | 46,531 s | 0,0139695 | Bloc accepté, quelques nuances mieux conservées |
| Gemini 3.5 Lite high, dernier essai | 46,640 s | 0,0225813 | Bloc accepté, caractère parasite et réserves |

Ces délais ponctuels ne garantissent pas une vitesse reproductible. Le coût de
reprise Mistral est inconnu ; le tableau porte exclusivement sur les premières
réponses. Aucun des blocs suivants n’a été testé : pas de classement complet
par heure, ni de jugement sur les erreurs historiques situées plus loin.

Aucun motif de remplacer 3.1 Lite ou Luna par Mistral à ce stade. Les données
ne suffisent pas à conclure sur tous les usages du modèle, mais ce premier bloc
révèle un problème concret pour notre tâche de sous-titrage. Aucun changement
de production. Superviseur terminé, aucun appel restant.

24 tests hors API passent (22 runner/superviseur et 2 parité du prompt), dont
vérification que le mode Mistral ne relance aucun comparateur.
[Preuves et empreintes](../web/review/luna-comparison/mistral4-results-20260925.json).
Catalogue public consulté :
[OpenRouter — Mistral Small 4](https://openrouter.ai/mistralai/mistral-small-2603).
