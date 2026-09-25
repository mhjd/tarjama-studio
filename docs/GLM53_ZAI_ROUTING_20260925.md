# GLM-5.3-Flash : audit du routage et essai limité à Z.AI

## Pourquoi reprendre

L'utilisateur demande de vraiment tester GLM après l'incohérence entre le modèle
`z-ai/glm-5.3-flash` et le champ Chat `provider: OpenAI`. Ce seul champ ne permet
pas de conclure à un remplacement du modèle. Les anciens résultats bruts ne sont
ni modifiés ni supprimés ; leur interprétation de provenance est précisée.

Sources consultées le 25 septembre 2026 :

- [Catalogue des endpoints GLM](https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints).
- [Sélection et restriction des fournisseurs](https://openrouter.ai/docs/guides/routing/provider-selection).
- [Métadonnées de génération](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation).

## Vérifications

L'appel part vers `https://openrouter.ai/api/v1/chat/completions`. Aucun proxy
Python configuré ni entrée locale substituant ce domaine identifiée. Résolution
publique Cloudflare et certificat TLS valide pour openrouter.ai, émis par Google
Trust Services ; vérification TLS jamais désactivée. Ces observations ne sont
pas une attestation indépendante des poids exécutés chez le fournisseur.

1. Ancien appel `gen-1790323149-qEsCOviK2vep2HfssjWn` : Generation déclare
   `z-ai/glm-5.3-flash-20260826`, fournisseur `InferenceNet`, malgré `OpenAI`
   dans Chat. Ses compteurs Generation sont nuls et sa liste d'exécutions amont
   vide : ils ne remplacent pas les coûts déjà enregistrés dans la réponse.
2. Appel court neuf avec `provider.only=["z-ai"]`, `order=["z-ai"]`,
   `allow_fallbacks=false` : Chat déclare `Z.AI`. Après un premier 404 différé,
   Generation confirme Z.AI, le modèle daté, un identifiant amont et un endpoint
   Z.AI réussi. Coût déclaré 0,00001375 USD. L'auto-identification verbale du
   modèle n'est jamais utilisée comme preuve.
3. Protocole complet avec schéma JSON strict natif : HTTP 404 avant toute réponse
   de modèle. Le contrôle sur un seul segment renvoie explicitement « No endpoints
   found that can handle the requested parameters ». Ce n'est pas une faute de
   traduction. Le catalogue Z.AI liste `response_format`, pas `structured_outputs`.
4. Même contrôle avec `response_format: {"type":"json_object"}` : réponse reçue.
   Chat annonce encore `OpenAI`, mais Generation indique Z.AI et GLM daté. Coût
   déclaré 0,00039581 USD. L'incohérence se reproduit donc sur une requête limitée
   à Z.AI. Sa cause interne reste inconnue ; ne pas affirmer un remplacement par
   OpenAI ni prétendre avoir identifié la couche responsable.

La clé est consommée par les scripts sans affichage ; aucune valeur secrète ni
en-tête d'authentification n'est archivé.

## Nouveau benchmark

Même corpus de 384 segments, blocs de quatre minutes, raisonnement high, résumé
cumulatif de 1500 caractères maximum et cinq lignes arabes/françaises précédentes.
Parallel search/fetch restent disponibles. Les corpus religieux locaux restent
absents. Fournisseur Z.AI imposé, aucun repli. Mode JSON simple, schéma toujours
fourni dans le prompt, validation locale inchangée et stricte. Aucune réparation.

Le runner vérifie désormais Generation pour chaque réponse : ID de génération
identique, nom du modèle ou version datée, fournisseur attendu. Les éventuels
404 différés bénéficient de deux reprises bornées à cinq secondes. Si ces preuves
manquent ou se contredisent, le bloc n'est pas qualifié et la chaîne s'arrête.
La valeur Chat reste archivée séparément. Il s'agit de déclarations recoupées de
l'API OpenRouter, pas d'une vérification indépendante des poids du modèle.

### Résultats

Bloc 1 : 90/90 sous-titres valides et résumé de 1444 caractères, **128,847 s**,
**0,00323753 USD**. 4351 tokens entrée, 5692 sortie dont 2875 de raisonnement.
Aucun appel outil déclaré. Chat indique « OpenAI », Generation indique Z.AI et
`z-ai/glm-5.3-flash-20260826`. Le résumé et les cinq lignes bilingues ont été
vérifiés identiques dans la requête du bloc 2, en dehors des IDs cibles.

Relecture des 90 segments : le reproche de l'ID 1 est cette fois restitué
(« prendre ce qui est large et le réduire ») ; le sentier de l'ID 4 reste bien
« dans la montagne », sans montée inventée. Le passage poétique reste discutable
(« le cœur d'un visage »), avec une interprétation ajoutée à l'ID 9 (« Cette essence
reste cachée derrière le reste des traits »). Français parfois maladroit :
« telle que les gens se disputeraient » à l'ID 56. Le résumé restitue l'énumération
complète des six articles de foi, mais son attribution des rôles de parole reste
une inférence. Rien ici ne démontre une absence générale de contresens.

Bloc 2 : **110,459 s**, **0,00324243 USD**. 5277 tokens entrée, 5424 sortie dont
2196 de raisonnement. Aucun appel outil déclaré. Z.AI et GLM daté de nouveau
confirmés par Generation, malgré « OpenAI » dans Chat. JSON analysable, 114 IDs
présents dans le bon ordre, mais **résumé de 1760 caractères au lieu de 1500 maximum**
et **texte vide à l'ID 141**. Le premier contrôle refusé est la longueur du résumé ;
un contrôle séparé des segments démontre que ce n'est pas l'unique défaut.
Le contenu « Messager d'Allah » de l'ID 141 a été déplacé dans l'ID 140. Aucun
bloc 3 ou 4 lancé, aucune réponse réparée ou injectée dans l'application.

Relecture des 114 segments du bloc 2 :

- ID 198 `وأنواع الخلائق والأفارقة` devient « et toutes sortes de créatures,
  d'Orient et d'Occident ». La mention explicite des **Africains** disparaît,
  remplacée par une géographie absente du texte. Défaut net, à l'intérieur du bloc.
- ID 159 `القديم` devient « l'Antécédent » ; ce terme restitue mal la notion
  d'éternité/sans commencement dans le contexte théologique. « ne se pluralise
  pas » est également opaque pour un lecteur français.
- ID 103 « une insufflation venu de l'au-delà » comporte une faute d'accord et
  précise « l'au-delà » là où l'arabe parle de l'invisible.
- ID 151 « trouver problématique chez le Prophète » reste maladroit ; ID 174
  « silence fidèle » ajoute une qualification absente de l'expression arabe.
- Les premières lignes du bloc 2 continuent correctement le passage du bloc 1
  sur les piliers : la présence de contexte n'entraîne pas de répétition des IDs
  précédents. Cela ne prouve pas à elle seule une amélioration causée par le résumé.

Le résumé du bloc 2 est globalement cohérent avec son sujet, mais trop long et
insère des numéros de versets dans la mémoire sans vérification par un outil
local. Le contrat demandait de ne pas inventer de références non établies par un
outil : ces références sont ici plausibles, mais ne doivent pas être présentées
comme vérifiées. Les résumés ne sont pas destinés à l'affichage des sous-titres.

### Bilan et coût

**Un bloc conforme sur deux ; 90 sous-titres acceptés sur 384 attendus.** Le
benchmark complet n'aboutit pas. La transmission réelle du résumé et des cinq
lignes est désormais observée et auditée, contrairement aux essais précédents.
Deux requêtes de benchmark : **239,306 s cumulées**, **0,00647996 USD déclarés**.
Les temps comprennent le contrôle de provenance via Generation.

Contrôles courts de routage/format : **0,00040956 USD** supplémentaires déclarés.
Sous-total connu de cette investigation : **0,00688952 USD**. Les deux refus HTTP
404 ne communiquent aucun usage ; ne pas leur attribuer un coût mesuré nul.
Les métadonnées Generation des appels avec outils retournent des compteurs nuls :
les coûts ci-dessus proviennent des réponses Chat et ne constituent pas un audit
indépendant de facture. Aucun coût par heure complète validée extrapolé.

**Conclusion corrigée :** il est infondé d'affirmer que les essais précédents
utilisaient nécessairement un modèle OpenAI. L'ancien appel revérifié est déclaré
GLM chez InferenceNet ; les nouveaux sont déclarés GLM chez Z.AI. Cette fois le
fournisseur est imposé et la provenance recoupée. Cela ne rend pas le modèle
« mauvais » dans l'absolu, mais ce protocole demeure insuffisamment fiable pour
notre chaîne stricte de sous-titres. L'erreur de format initiale dépendait aussi
d'une incompatibilité entre endpoint et schéma natif. Les erreurs de texte vide
et de contenu du deuxième bloc subsistent après résolution de cette incompatibilité.

[Résultats machine et preuves de provenance sélectionnées](../web/review/luna-comparison/glm53-zai-results-20260925.json).
Les onze tests du runner et les deux tests de parité des prompts passent. Les
nouveaux tests vérifient le fournisseur imposé, le refus d'une provenance absente
ou contradictoire, et la conservation du contrat en mode JSON simple.

## Reproduction

```sh
make web-luna-compare BENCHMARK_OUTPUT=data/model_outputs/glm53-zai-NOUVEAU \
  BENCHMARK_MODEL=z-ai/glm-5.3-flash BENCHMARK_REASONING=high \
  BENCHMARK_CHUNK_MINUTES=4 BENCHMARK_CONTINUITY=1 \
  BENCHMARK_PROVIDER=z-ai BENCHMARK_JSON_OBJECT=1
```

Archives sous `data/model_outputs/` :

- `glm53-route-probe-20260925-01` : contrôle court et ancien appel.
- `glm53-zai-format-probe-20260925-01` : différence entre les deux formats.
- `glm53-zai-4min-continuity-20260925-01` : refus 404 du schéma strict.
- `glm53-zai-4min-continuity-json-20260925-01` : nouveau benchmark.

Le fournisseur et le mode de sortie changent par rapport aux précédents essais.
Les écarts ne pourront donc pas être attribués uniquement au modèle. Aucun
changement du modèle de production ni déploiement.
