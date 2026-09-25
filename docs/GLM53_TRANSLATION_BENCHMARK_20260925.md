# GLM-5.3-Flash — traduction en blocs de dix minutes, 25 septembre 2026

> Complément de provenance : la vérification ultérieure de Generation indique
> GLM-5.3-Flash chez InferenceNet pour l'appel `gen-1790323149-qEsCOviK2vep2HfssjWn`
> du second essai à quatre minutes, malgré « OpenAI » dans la réponse Chat.
> Les autres anciens appels ne sont pas tous revérifiés. Le champ Chat isolé
> ne prouve donc pas une substitution. Voir [l'audit de routage et le nouvel essai Z.AI](GLM53_ZAI_ROUTING_20260925.md).


## Paramètres et périmètre

Demande : tester `z-ai/glm-5.3-flash` via OpenRouter avec raisonnement medium si
possible et blocs de dix minutes. Le catalogue public consulté et archivé propose
`low`, `high`, `max`, raisonnement obligatoire, `max` par défaut. **Medium n’est
pas proposé.** Choix explicite : `high`, intermédiaire parmi les trois niveaux,
sans prétendre qu’il est équivalent à medium sur GPT-6.

Sources officielles : [fiche du modèle](https://openrouter.ai/z-ai/glm-5.3-flash),
[catalogue API](https://openrouter.ai/api/v1/models),
[contrat de raisonnement](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
Les options archivées du run font foi pour cet essai, pas pour un tarif futur.

Même corpus arabe de 384 segments, durée 940,7 s, et même prompt que les essais
GPT-6 / DeepSeek : SHA-256
`beac04067b637244ff7b3eb744ef6b72e307c5ac902975bc8d95324d58fca677`.
Découpage temporel, sans couper de segment :

- Bloc 1 : 259 segments, IDs 0–259 avec un trou préexistant, 0 à 599 980 ms ;
  contexte après : IDs 260–261.
- Bloc 2 : 125 segments, IDs 260–403 avec trous préexistants, 599 980 à 940 700 ms ;
  contexte avant : IDs 258–259.

Chat Completions, `reasoning.effort=high`, sortie limitée à 32 768 tokens incluant
le raisonnement, schéma JSON strict, pas de repli de modèle/fournisseur. Outils
Parallel identiques aux benchmarks précédents (recherche jusqu’à 20 résultats,
lecture web). Le contrôle web séparé impose une recherche puis une lecture ; les
traductions disposent des outils sans appel obligatoire. Les corpus religieux
locaux ne sont pas disponibles. Aucune citation française canonique certifiée.

Cinq appels initiaux, sans retry caché : contrôle web, 16 difficultés, deux blocs
temporels, puis les 16 difficultés répétées. Attente réelle bornée à 300 secondes.
Une reprise diagnostique explicite du premier bloc augmente uniquement l’attente
à 600 secondes ; le corps de la requête est identique octet pour octet, empreinte
`f8b251e7df846c54cfafb2caf29d43aca97c69b755d41832d9bfb788f1835437`.
Cette reprise reste distincte de la mesure à cinq minutes ; elle ne change aucun
timeout ni fournisseur de l’application. Six appels au total.

## Résultats de la série initiale

| Appel | Réception conforme | Temps | Coût API déclaré USD |
| --- | --- | ---: | ---: |
| Contrôle Parallel | Oui | 15,397 s | 0,01537132 |
| Difficultés, passage 1 | Oui | 27,720 s | 0,00032179 |
| Bloc 1, 9 min 59,98 s | Non : timeout | 300,001 s | Non communiqué |
| Bloc 2, 5 min 40,72 s | Non : JSON invalide | 171,749 s | 0,001323045 |
| Difficultés, passage 2 | Oui | 25,382 s | 0,00030891 |

Les deux blocs du corpus sont donc refusés dans la série initiale. Les réponses
courtes valides ne qualifient pas à elles seules un parcours complet.
Les tokens de raisonnement déclarés sont respectivement 169, 884, non reçus,
6 601, 784 : le raisonnement n’est pas simplement une option demandée. Ces
compteurs ne prouvent pas indépendamment le niveau interne exact du fournisseur.

Le contrôle Parallel déclare une recherche et deux appels outils exécutés ; le
second est cohérent avec fetch, seul autre outil proposé. Il ne constitue pas
une trace indépendante des URLs consultées. Aucun outil web n’est déclaré dans
les trois réponses de traduction reçues de la série initiale. Pour le timeout,
absence de métadonnées : l’utilisation éventuelle d’outils et la facturation
restent inconnues, pas nulles.

Le bloc 2 contient notamment la séquence invalide `"id":"266":null`, ainsi que
les IDs 258–259 fournis uniquement en contexte avant la cible. Une extraction
objet par objet retrouve 127 objets lisibles pour 125 cibles, contexte inclus.
Ces extraits sont **diagnostiques, jamais acceptés comme traduction valide** ;
réparer uniquement la syntaxe ne résoudrait pas l’ajout de segments de contexte.

## Lecture qualitative

Lecture des 16 difficultés deux fois et des 125 cibles lisibles du second bloc.
Pas de relecteur humain indépendant ; corpus déjà connu, pas de jeu tenu à l’écart.
Les comparaisons suivantes concernent les sorties effectivement visibles, pas
une traduction complète validée.

- Négations, chiffres, conditionnel, incertitude et Maryam sont globalement
  préservés dans les deux séries courtes. L’idiome de la charrue figure déjà dans
  le prompt : il n’est pas un cas indépendant de généralisation.
- ID 365 : « une simple remarque **sur les propos du cheikh** » conserve mieux
  l’attribution que la variante GPT-6 medium précédemment signalée.
- ID 378 : « tous viendront **à Lui** » conserve le complément ; ID 276 rend
  `تجسيم` par « Lui prêter un corps », plus précis que « incarnation » observé
  chez DeepSeek dans l’ancien essai.
- ID 281 ajoute Ali ibn Ismaïl al-Ash’ari, absent de ce segment mais présent au
  suivant ; ID 282 le répète. Défaut d’alignement et répétition interne au bloc,
  pas un problème à la coupure temporelle.
- ID 334 ajoute « Non » à une interrogation sans négation explicite dans le
  fragment arabe : interprétation ajoutée, particulièrement délicate avec un
  référent de pronom ambigu. Ne pas en déduire une conclusion théologique.
- IDs 357–358 déplacent « aucun attribut » dans le premier sous-titre et donnent
  « quels qu’ils soient » dans le second, au lieu de son contenu source propre.
- Français parfois raide ou incorrect : « ce qu’il a intenté » au second passage
  des difficultés ; ID 401 « Allah nous l’a informé », plutôt que « Allah nous
  l’a appris » ou « nous en a informés » ; ID 399 « d’autres que cela » reste flou.
- Le passage ID 388 sur les lectures coraniques est ambigu dans la transcription
  source : pas de faute certaine attribuée au modèle sans retour au son.

## Reprise diagnostique et conclusion

Le premier bloc rejoué avec une attente maximale de 600 s répond après
**519,134 s (8 min 39 s)** : HTTP 200, mais **JSON invalide**, `finish_reason=stop`.
Usage déclaré : 6 809 tokens d'entrée, 17 650 de sortie dont 10 383 de
raisonnement ; coût **0,002539965 USD**, aucun appel outil déclaré.

La réponse interrompt un objet, introduit un commentaire de réparation en anglais,
puis recommence une partie de la traduction et finit avec une balise étrangère au
JSON. L'extraction diagnostique retrouve 338 objets lisibles pour seulement
169 IDs distincts, tous dupliqués, et 90 cibles sans objet lisible. Ce n'est pas
une simple virgule à réparer. Les variantes récupérées des IDs 138–169 montrent
aussi un décalage : le texte de l'ID 139 se retrouve à l'ID 138, et ainsi de suite.
Aucune sortie réparée n'est acceptée ni injectée dans l'application.

Examen ponctuel de ce bloc, sans prétendre avoir relu exhaustivement ses variantes :
ID 1, `حجّر واسعًا وضيّق كبيرًا`, reproche une restriction de ce qui est vaste.
« C'est un cadre très large — et un resserrement tout aussi grand » ne restitue
pas clairement ce reproche. Cette difficulté est près du début ; les décalages
138–169 sont à l'intérieur du bloc. Tous les défauts ne s'expliquent donc pas
par un manque de contexte aux frontières.

**Bilan : zéro réponse de corpus conforme sur trois tentatives**, contre deux
séries de difficultés courtes conformes et un contrôle web conforme. Ce réglage
high / dix minutes sur cette route n'est pas qualifié pour Tarjama. Le français
récupérable comporte des réussites réelles, mais aussi des formulations fautives,
des déplacements de contenu et des pertes d'alignement. Il ne démontre aucun
avantage global justifiant de remplacer le modèle actuel. Ce résultat ne permet
pas de conclure sur d'autres efforts, tailles de blocs ou routes GLM.

**Coût connu des six appels : 0,01986503 USD**, auquel s'ajoute l'éventuelle
facturation non communiquée de l'appel expiré à 300 s. Le contrôle web représente
0,01537132 USD de ce sous-total. Sans traduction complète acceptée, annoncer un
prix mesuré par heure traduite serait trompeur. Les tarifs catalogue minimaux
(0,045 USD/M entrée, 0,14 USD/M sortie à la consultation) ne remplacent pas ce
coût observé, qui inclut raisonnement, routage, outils et essais échoués.

Pour mémoire, l'ancien parcours GPT-6 medium avait produit un corpus complet
après reprises pour 0,008144895 USD et 139,030 s cumulées ; DeepSeek avait passé
son corpus pour 0,0047347 USD et 250,456 s. Ces coûts de traduction excluent le
contrôle web séparé, et les réglages diffèrent : voir les limites ci-dessous.

Les [résultats machine et empreintes vérifiées](../web/review/luna-comparison/glm53-results-20260925.json)
conservent les six mesures, les protocoles et la distinction entre coût inconnu
et coût nul. Les empreintes des deux archives ont été revérifiées après le test.

## Reproductibilité et limites de comparaison

Commande de la série initiale :

```sh
make web-luna-compare BENCHMARK_OUTPUT=data/model_outputs/glm53-NOUVEAU \
  BENCHMARK_MODEL=z-ai/glm-5.3-flash BENCHMARK_REASONING=high \
  BENCHMARK_CHUNK_MINUTES=10
```

Reprise bornée du premier bloc dans un dossier différent : mêmes paramètres,
plus `BENCHMARK_CASE=corpus-timed-1 BENCHMARK_TIMEOUT_SECONDS=600`.
Le runner et ses huit tests, ainsi que les deux tests de parité des prompts,
passent. Les demandes non prises en charge de niveau de raisonnement sont
refusées avant tout appel payant.

Les runs originaux sont conservés sans écrasement sous `data/model_outputs/` :
`glm53-high-10min-20260925-01` et `glm53-high-10min-20260925-longwait-01`.
Requêtes sans en-têtes ni clé, entrées, réponses reçues, catalogues, protocoles,
script exécuté et empreintes restent auditables. Aucun corps d’erreur HTTP brut
ni valeur secrète dans les preuves.

Le champ `model` renvoyé correspond à l’ID demandé ; le champ `provider` des
réponses reçues indique `OpenAI`, comme dans les précédents essais. Le test
qualifie donc le comportement de cette route OpenRouter, sans attestation
indépendante du moteur réellement exécuté en amont.

GPT-6 medium a été mesuré via Responses et blocs de 96/48 segments ; GLM utilise
Chat Completions, high et 10 minutes. Même prompt et texte, mais pas une
comparaison contrôlée à API, raisonnement et découpage identiques. Les différences
ne peuvent être attribuées au seul modèle. Aucun déploiement ni changement du
modèle de production n’est effectué par ce benchmark.
