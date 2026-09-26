# Audit de fiabilité des traitements LLM — 26 septembre 2026

## Conclusion

L'orchestration actuelle possède plusieurs défauts reproductibles qui peuvent
interrompre une traduction correcte en cours de préparation. L'affichage plus
discret des reprises ne corrige pas ces défauts. Il faut reprendre le contrat
entre recherche, génération, validation, attente et reprise, avec des tests
qui traversent ces frontières.

Audit du code applicatif `b93a8e4`, déployé en révision `bc8dfb4c73dabc15`.
Lecture des journaux du worker, inspection du code et six scénarios locaux
reproduits avec PostgreSQL isolé et faux transport fournisseur. Aucun appel
OpenRouter/Groq payant, aucune relance de projet utilisateur, aucune modification
de la recette active ni des protections du VPS pendant cet audit.

## Incident observé et limite du diagnostic historique

Le worker en service rapporte le 26 septembre à 08:26:03 UTC :
`kind=translate reason=unclassified`, pour le job
`e2c6d15e7d87a82e6ca6faf2ce54fe3b`.

Cet échec est contemporain de la capture utilisateur. Les journaux disponibles
ne contiennent ni le type d'erreur précis, ni l'étape de la boucle, ni l'ID de
requête OpenRouter de cette tentative. L'erreur est remplacée par le message
générique dans `Store.Fail`. **La cause exacte de cet incident n'est donc pas
établie.** Les plafonds d'outils décrits ci-dessous produisent exactement cette
catégorie, mais une erreur de stockage ou un autre cas non classé est également
possible. Ne pas affirmer a posteriori qu'il s'agissait d'un quota, d'un modèle
mal nommé ou d'un JSON invalide.

Il manque aussi un historique exhaustif des tentatives pour calculer un taux
d'échec ou une fréquence par cause. Les tests ci-dessous démontrent des défauts,
pas leur part statistique dans les incidents réels.

## Constats prioritaires

### P1 — Les plafonds d'outils coupent brutalement la traduction

Dans [runner.go](../web/backend/internal/research/runner.go), une génération
dispose de cinq requêtes HTTP et de huit appels locaux. Au cinquième tour,
les outils restent proposés, mais une réponse qui en demande un est rejetée.
Un lot dépassant le reliquat d'appels locaux est rejeté avant toute exécution
de ce lot. Aucun tour de finalisation sans outils n'est réservé.

Deux reproductions utilisant le vrai client et le worker :

- Cinq demandes successives d'un outil : quatre outils exécutés, cinq requêtes
  HTTP, puis job `failed`, motif `unclassified`.
- Neuf demandes d'outils dans une réponse : zéro outil exécuté, une requête HTTP,
  puis job `failed`, motif `unclassified`.

Le prompt demande justement de consulter les références religieuses. Un passage
riche en références peut donc buter sur une limite de l'application sans que
le fournisseur soit indisponible. Les limites sont nécessaires ; les convertir
directement en échec de toute la traduction est le problème.

La documentation OpenRouter décrit une finalisation avec le contexte acquis
lorsque le budget des **outils serveur** est épuisé. Notre boucle d'outils locaux
ne fournit pas ce comportement. Les deux budgets sont distincts.
[Documentation officielle](https://openrouter.ai/docs/guides/features/server-tools).

### P1 — Attentes de quota et réponses invalides partagent le même compteur

`Store.Fail` incrémente `jobs.attempts` pour toute attente. `worker.provider`
retourne une attente même lorsqu'un cooldown empêche de contacter le fournisseur.
Puis `textResponseFailure` refuse une reprise à partir de `attempts >= 2`.

Reproduction : deux passages bloqués par un cooldown, donc **zéro appel modèle**,
puis une première réponse incomplète. Le job échoue définitivement après ce seul
appel. L'utilisateur n'a pas bénéficié des reprises adaptatives prévues.

La réduction de taille dans `smallerTextRetry` dépend aussi de ce compteur mélangé.
Un quota peut ainsi modifier le découpage alors qu'aucun problème de taille n'a
été constaté. Sources : [queue.go](../web/backend/internal/studio/queue.go),
[worker.go](../web/backend/internal/studio/worker.go).

### P1 — Les preuves des tentatives échouées sont perdues

Le `Runner` sait accumuler un ID de requête, des usages et des références. Mais
`HTTPProviders.textWithResearch` renvoie immédiatement sur erreur, avant de
copier cet audit. Après une erreur de validation, le worker ne conserve pas
non plus le résultat rejeté dans un journal séparé des morceaux validés.
La base conserve l'audit des morceaux réussis uniquement.

Reproduction : un outil réussi avec usage retourné, puis HTTP 502. Le runner
possède encore une référence et un usage ; l'adaptateur renvoie un audit vide.
Le coût déjà engagé et le chemin ayant conduit à l'échec ne sont donc pas
reconstituables depuis les données applicatives conservées.

La protection des secrets est correcte, mais journaliser seulement `unclassified`
supprime aussi les informations non secrètes nécessaires au diagnostic.
Source : [providers.go](../web/backend/internal/studio/providers.go).

### P2 — Les timeouts sont réessayés sans plafond total

Le délai global de cinq minutes comprend raisonnement, outils et réponse finale.
Une erreur de transport devient une `ProviderError` temporaire. Le backoff est
borné ; le nombre cumulé d'appels et la dépense potentielle ne le sont pas.

Reproduction : six timeouts consécutifs, le job reste `waiting_provider` après
six requêtes. Le code ne prévoit pas de seuil ultérieur d'arrêt. Ce n'est pas
la preuve de six facturations : après une interruption réseau, la facturation
et l'achèvement distant restent incertains.

Le même traitement impose également un cooldown à toute la clé partagée,
alors qu'un timeout sur un passage ne prouve pas une saturation globale.
La conservation d'une attente de quota est souhaitée par le propriétaire ;
elle doit être séparée des appels qui ont réellement consommé du calcul.

### P2 — Les capacités web peuvent disparaître pendant une continuation

La boucle attend `usage.server_tool_use_details.tool_calls_executed`. Si ce
compteur manque, elle considère le budget web épuisé, par prudence.
La forme d'usage illustrée par la documentation actuelle expose notamment
`usage.server_tool_use.web_search_requests`, sans ce compteur détaillé.
[Documentation officielle](https://openrouter.ai/docs/guides/features/server-tools).

Reproduction avec cette forme documentée et zéro recherche déclarée : après un
outil local, les outils web sont retirés. C'est une restriction volontaire pour
éviter de réaccorder un budget aveuglément ; elle doit être qualifiée contre
les réponses réelles et rendue explicite. Elle peut dégrader les vérifications,
mais ne prouve pas à elle seule l'origine du dernier échec.

### P2 — La politique de taille n'est pas reliée aux budgets réels

La production utilise encore des blocs cibles de dix minutes, jusqu'à 600
segments et 64 000 octets arabes. Les essais de blocs plus courts dans les
benchmarks n'ont pas modifié ce contrat de production. Le budget de sortie est
fixé à 32 768 tokens et le raisonnement à medium. Le nombre de citations et les
IDs/structures de sortie ne participent pas au découpage.

Le raisonnement et la sortie visible peuvent partager la limite `max_tokens`
selon le fournisseur. Une limite de taille en octets arabes ne suffit donc pas
à garantir une réponse complète. Cela reste un **facteur de risque**, sans preuve
qu'il ait déclenché l'incident de 08:26.
[Documentation officielle](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

Autre incohérence : le prompt de nettoyage dit ne disposer d'aucune recherche
documentaire, alors que le même adaptateur lui propose les outils locaux et web.
Ce contrat doit être clarifié, séparément des consignes de traduction.

## Pourquoi les tests précédents n'ont pas suffi

Les parcours UI utilisent des fournisseurs simulés, qui répondent proprement.
Ils vérifient affichage, persistance, navigation et export, pas la robustesse
d'une conversation LLM réelle à nombreux outils. Le test existant
`TestLocalLoopCannotRunForever` prouvait que la boucle s'arrêtait ; il acceptait
l'erreur comme résultat, sans vérifier une finalisation ou une reprise utile.
La qualification réelle des références couvrait un petit nombre d'appels.

Les barrières de données restent utiles : réponse incomplète rejetée, morceaux
validés conservés, publication atomique, aucune édition d'une transcription brute,
pas d'export de traduction partielle. Il faut préserver ces garanties.

## Correction recommandée et critères d'acceptation

1. **Diagnostic structuré durable par tentative.** Code d'erreur stable, étape,
   modèle, IDs de requêtes, durées, compteurs, usages connus, éventuelle dépense
   incertaine, ordinal du morceau. Pas de secret ni de transcription dans les
   journaux ordinaires. Séparer ce journal des résultats validés et du message UI.
2. **Séparer les compteurs.** Attente sans appel, erreurs de transport,
   réponses invalides et consommation d'outils doivent avoir leurs propres
   politiques. Deux attentes ne doivent jamais consommer deux reprises JSON.
3. **Finaliser la recherche proprement.** Réserver temps et requête pour générer
   le JSON final sans nouvel outil. Répondre explicitement aux appels au-delà du
   budget, sans les exécuter ni prétendre avoir trouvé la référence. Conserver
   le raisonnement et les résultats nécessaires au protocole de continuation.
4. **Reprendre le morceau au bon endroit.** Si la finalisation reste impossible,
   réduire le morceau de façon bornée et conserver les références déjà obtenues
   quand elles sont réutilisables. Ne pas simplement augmenter toutes les limites
   ou rejouer une recherche complète indéfiniment.
5. **Borner le calcul, conserver l'attente.** Plafond de tentatives actives,
   budget cumulé et coupe-circuit par job ; attente durable pour un vrai quota,
   sans appels facturables en boucle. Un timeout individuel ne doit pas être
   présenté automatiquement comme saturation de toute la clé.
6. **Qualifier progressivement.** Tests déterministes de ces six scénarios,
   puis petit passage réel riche en références, puis vidéo longue avec diagnostics
   conservés et budget explicite. Les critères : terminer/reprendre utilement,
   aucun morceau perdu, aucun appel non borné, aucun diagnostic `unclassified`
   pour une condition connue. Le taux d'échec réel reste à mesurer ensuite.

## Reproduction de l'audit

`make web-llm-reliability-audit`

Six scénarios reproduits avec succès, détecteur de courses Go activé, sans
requête externe. Le succès de ces tests signifie **défauts reproduits**, pas
défauts corrigés. Ils portent le build tag `reliability_audit` et sont exclus
des suites normales pour ne pas figer le comportement défectueux comme contrat.
Les transformer en tests de non-régression souhaitée pendant les corrections.

Preuve : `web/review/reliability-20260926/reproduction.log`.
Seuls tests, scripts et documentation sont ajoutés par cet audit ; le runtime
déployé reste inchangé. Les vidéos mobiles ont été préparées avant cette analyse :
[rapport et limites des captures](MOBILE_PLAYER_REVIEW_20260926.md).
