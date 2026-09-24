# GPT-6 Luna, GPT-5.6 Luna et DeepSeek V4.1 Flash — 24 septembre 2026

**GPT-6 Luna produit globalement le français le plus naturel dans cet essai,
mais ne constitue pas un remplacement fiable en l'état.** DeepSeek est le seul
à rendre le passage long complet avec tous ses IDs ; il contient néanmoins de
vraies erreurs de traduction. GPT-5.6 Luna est rapide, mais sa sortie longue
déplace les traductions entre segments. Aucun des trois n'est « sans erreur ».

Je conserverais donc le modèle de production actuel pour l'instant. Le candidat
à approfondir pour améliorer le style est GPT-6 Luna, après résolution et nouvelle
qualification des sorties structurées et de l'alignement. Ni le modèle, ni les
chunks de production, ni le déploiement n'ont été modifiés par ce benchmark.

## Ce qui a réellement été testé

- 24 appels OpenRouter : 8 par modèle, sans retry ni réparation automatique.
- IDs demandés : `openai/gpt-6-luna`, `openai/gpt-5.6-luna`,
  `deepseek/deepseek-v4.1-flash`. Ce dernier est le troisième candidat comparé.
- Même prompt interne `translation-parallel-v3`, généré depuis
  `prompts/translation.md`, même contrat JSON, mêmes outils Parallel pour tous.
  Source applicative au départ : commit `2be6223`, sur `web-vps`.
- `reasoning.effort=none` pour les trois : configuration commune permettant
  l'appel de fonctions GPT-6 Luna via Chat Completions. Ce test ne compare pas
  leurs meilleurs réglages de raisonnement et ne change pas celui de production.
  Voir la [documentation GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
- Corpus : **384 segments, 15 min 40,7 s**, transcription arabe religieuse déjà
  présente dans le dépôt, sans modification. Ses IDs ne sont pas tous consécutifs.
  Ce test porte sur la traduction du texte fourni, pas sur l'ASR ou la vidéo finale.
- 16 difficultés courtes exécutées deux fois : négations, chiffres, dialecte,
  incertitude, citations et variantes, instructions citées à traiter comme données.
- Après les échecs du passage long, même corpus divisé en **4 × 96 segments**,
  deux segments de contexte avant/après. Ce suivi diagnostique ne remplace pas
  les résultats initiaux et n'est pas une évaluation indépendante.
- Un appel distinct par modèle force recherche puis lecture d'une page sur le nom
  français de l'UNESCO. Il vérifie les outils, pas la qualité de traduction religieuse.

Les outils `quran_fr`, `sahih_ar`, `hadith_ar` ne sont toujours pas installés : le
prompt le dit explicitement. Les traductions de citations produites ici ne sont
donc pas des citations françaises certifiées par notre futur corpus local.
Il n'y a eu aucune recherche web dans les appels de traduction eux-mêmes d'après
les compteurs retournés ; les outils étaient disponibles, sans appel obligatoire.

## Réception, alignement et temps

« Valide » signifie réponse terminée, JSON conforme, même nombre de segments,
mêmes IDs et ordre, texte non vide. Cela ne prouve ni la fidélité du sens ni le bon
placement sémantique derrière chaque ID ; ces points ont aussi été relus.

| Mesure | GPT-6 Luna | GPT-5.6 Luna | DeepSeek V4.1 Flash |
|---|---:|---:|---:|
| Difficultés courtes : réponses valides | 2/2 | 2/2 | 2/2 |
| Passage long : réponse valide | Non | Non | Oui |
| Passage long : temps observé | 188,6 s | 48,3 s | 250,5 s |
| Corpus découpé : réponses valides | 1/4 | 3/4 | 3/4 |
| Corpus découpé : somme des temps des 4 appels | 90,8 s | 74,2 s | 252,0 s |
| Total traduction : réponses valides | 3/7 | 5/7 | 6/7 |

Les temps incluent la réception HTTP. Les modèles étaient comparés en parallèle,
mais les quatre parties d'un même modèle ont été lancées dans des séries
successives. Ce sont des observations ponctuelles, pas des percentiles de charge.

Échecs précis :

- **GPT-6, passage long** : réponse de 101 949 caractères, blocs répétés, JSON
  mal formé puis interrompu ; `finish_reason=null`. Aucun livrable exploitable.
  Sur les petits blocs : ID 96 absent dans le premier, clés JSON mal formées aux
  IDs 151 et 226 dans les deux suivants. Le dernier bloc est valide.
- **GPT-5.6, passage long** : 377 segments au lieu de 384, IDs 301–307 absents.
  Plus grave : dès les alentours de l'ID 119, fusion de contenu puis décalage
  prolongé des traductions derrière les mauvais IDs. Restaurer les sept IDs ne
  réparerait pas les timecodes. Le découpage corrige ce décalage dans les régions
  examinées, mais le deuxième bloc contient une chaîne JSON non fermée à l'ID 181.
- **DeepSeek, corpus découpé** : une accolade supplémentaire après l'ID 56 rend
  le premier bloc invalide. Les trois suivants et le passage long sont valides.

Le `response_format` strict était demandé, sans repli fournisseur. Ces échecs
restent des échecs malgré ce paramètre. Nous observons la réponse livrée par
OpenRouter ; ce test n'isole pas l'origine modèle, fournisseur ou agrégation des
outils d'une sortie corrompue. Il ne faut pas résoudre cela en acceptant des
segments manquants ou en déplaçant automatiquement leurs textes.

## Jugement qualitatif et exemples

Lecture des 16 difficultés deux fois et des 384 lignes du passage long ; lecture
ciblée supplémentaire du corpus découpé, notamment aux frontières et sur les
erreurs précédentes. Les noms ont été masqués par A/B/C pendant la rédaction des
notes : A = DeepSeek, B = GPT-5.6, C = GPT-6. Il s'agit d'une évaluation qualitative
par l'agent, sans relecteur humain indépendant ni score statistique de qualité.

Pour pouvoir lire les sorties invalides, leurs objets segmentaires ont été
extraits individuellement à titre diagnostique. **Aucune sortie ainsi extraite
n'a été comptée comme valide.** Les notes préalables au dévoilement et les
[extraits comparés](../web/review/luna-comparison/review-excerpts-20260924.json)
sont conservés.

| Exemple | Observation et importance |
|---|---|
| `حجّر واسعًا وضيّق كبيرًا` — ID 1 | DeepSeek traduit la seconde moitié par « élargi ce qui est étroit », alors qu'il s'agit de réduire ce qui est grand : inversion de sens, reproduite avec le découpage. GPT-6 long traduit correctement ; sa version découpée ajoute en revanche « généralisation excessive ». |
| Négation : « Je n'ai pas dit que le traitement ne fonctionne pas, mais qu'il ne fonctionne pas pour tous » | Au premier essai, GPT-5.6 écrit « inefficace, mais qu'il ne l'était pas pour tous » : il nie l'inefficacité plutôt que l'efficacité, ce qui change la nuance. Erreur non répétée au second essai. GPT-6 préserve correctement cette négation. |
| `ولا تقتضي تجسيمًا` — ID 276 | DeepSeek long écrit « sans impliquer d'incarnation » ; GPT-6 « cela n'implique pas de Lui attribuer un corps », plus précis. DeepSeek emploie ensuite « corporeïsation » dans le test découpé. |
| `بدل أن تحيل الإنسان إلى علمك` — ID 332 | GPT-6 long remplace « ton savoir » par « son propre savoir », changeant le référent. Le test découpé rétablit « votre propre savoir ». |
| `والوجه أنه الذات` — ID 322, test découpé | GPT-6 garde correctement « le Visage désigne l'essence ». DeepSeek produit « la position est que l'Essence est l'Essence » et GPT-5.6 « l'Essence désigne l'Être » : perte du terme « visage ». |
| `وكلهم آتيه` — IDs 378–379 | GPT-6 omet « à Lui », dans les deux configurations. DeepSeek le conserve. |
| `لا حميم يغني عن حميم` — ID 385 | DeepSeek écrit « nul intime ne remplacera un intime ». Le sens est qu'un proche ne pourra aider un autre ; GPT-6 et GPT-5.6 découpé rendent cette idée correctement. |
| Registre général | GPT-6 est souvent plus clair et concis ; DeepSeek garde des calques comme « acte religieux ordonné d'un ordre non catégorique » ou « science et englobement ». GPT-5.6 est fluide aussi, mais son décalage long rend le sous-titrage inutilisable. |

Classement **du français et des passages lisibles** : préférence pour GPT-6,
puis GPT-5.6 pour la fluidité, puis DeepSeek, plus littéral. Ce n'est pas un
classement de fichiers directement utilisables : sur le passage long, DeepSeek
est seul à satisfaire le contrat et à conserver globalement l'alignement.

Des erreurs existent chez les trois. On ne peut donc pas reprendre l'affirmation
« GPT ne fait aucune erreur ». Certains fragments sources sont eux-mêmes ambigus
(par exemple l'ID 388 sur les lectures coraniques) : ils ne sont pas comptés comme
des fautes certaines du modèle sans contrôle du son et de la référence.
Un exemple idiomatique des difficultés figure déjà dans le prompt ; il ne constitue
pas une preuve indépendante de généralisation. Ce corpus connu ne suffit pas à
qualifier tous les dialectes, thèmes ou vidéos d'une heure.

## Prix réellement déclarés

Les chiffres suivants sont la somme de `usage.cost` dans les réponses OpenRouter,
**échecs inclus**, pas une facture indépendante ni un tarif garanti. Toutes les
sommes sont en dollars US. Ni transcription, ni correction arabe, ni rendu média
ne sont inclus.

| Modèle | Coût des 4 blocs couvrant 15 min 40,7 s | Extrapolation à 1 h de même densité | Coût des 8 appels du benchmark |
|---|---:|---:|---:|
| GPT-6 Luna | 0,004472 $ | **0,0171 $** | 0,030860 $ |
| GPT-5.6 Luna | 0,010610 $ | **0,0406 $** | 0,039889 $ |
| DeepSeek V4.1 Flash | 0,005525 $ | **0,0211 $** | 0,027197 $ |

**Ce sont des coûts de tentatives, pas le prix d'une heure de sous-titres validés.**
Aucun modèle n'a réussi les quatre blocs sans incident. Les reprises nécessaires
et d'éventuelles recherches s'ajouteraient. Le facteur d'extrapolation est
`3600 / 940,7` ; ce n'est pas une vidéo d'une heure effectivement traduite.

Pour le passage long unique, DeepSeek a renvoyé une sortie valide pour **0,004735 $**
(environ 0,0181 $/h à densité identique). GPT-5.6 a coûté 0,010160 $ malgré l'échec.
L'appel long GPT-6 indique **`cost=0`**, mais un coût d'inférence amont de
**0,0146174 $** ; cette anomalie est conservée, jamais présentée comme un modèle
gratuit, et ce point n'est pas utilisé pour extrapoler son coût horaire.

Coût total déclaré des 24 appels : **0,097946715 $**, soit environ **0,10 $**.
Les quatre blocs consomment respectivement :

| Modèle | Tokens d'entrée | Tokens de sortie |
|---|---:|---:|
| GPT-6 Luna | 13 064 | 7 215 |
| GPT-5.6 Luna | 13 064 | 7 401 |
| DeepSeek V4.1 Flash | 15 593 | 7 932 |

L'entrée inclut prompt et contexte répétés. Cache et découpage influencent les prix.
Les tarifs publiés lors du contrôle sont 0,10 $/M en entrée et 0,50 $/M en sortie
pour [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), contre
0,20 $/M et 1,20 $/M pour
[GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna).
Le [catalogue OpenRouter](https://openrouter.ai/api/v1/models) archivé annonce
0,15 $/M et 0,60 $/M pour DeepSeek, avec des variantes horaires jusqu'à
0,30 $/M et 1,20 $/M. Les montants DeepSeek effectivement retournés ici sont
inférieurs à ce calcul catalogue : conserver les deux, ne pas garantir ce prix futur.

Autre limite de provenance : le champ `model` correspond au modèle demandé,
mais les réponses affichent `provider: OpenAI` **y compris pour DeepSeek**.
Le benchmark établit donc le comportement des IDs servis par cet accès OpenRouter ;
il n'atteste pas indépendamment le moteur effectivement exécuté en amont.

## Recherche et lecture web

Parallel uniquement, pour les trois. Recherche avancée, maximum 20 résultats,
6 recherches, 10 lectures, plafond de 16 appels outils par traduction ; le
contrôle UNESCO a son propre plafond de 4 appels outils. Aucun moteur natif demandé.

| Contrôle UNESCO | Recherches déclarées | Total appels outils exécutés | Sortie JSON finale valide | Coût déclaré, outils + tokens |
|---|---:|---:|---|---:|
| GPT-6 Luna | 2 | 3 | Oui | 0,025552 $ |
| GPT-5.6 Luna | 1 | 2 | Oui | 0,017208 $ |
| DeepSeek | 1 | 2 | Non : préambule anglais avant le JSON | 0,015805 $ |

Les appels supplémentaires à la recherche sont cohérents avec `web_fetch`, seul
autre outil disponible. Les compteurs ne donnent pas une trace détaillée des URLs
lues ni une preuve de leur bonne exploitation : distinguer accès aux outils,
format final et vérification réelle d'une référence.

[Parallel via OpenRouter Search](https://openrouter.ai/docs/guides/features/server-tools/web-search)
annonce 0,005 $ par recherche comprenant 10 résultats, puis 0,001 $ par résultat
supplémentaire. Une recherche à 20 résultats peut donc atteindre 0,015 $.
[Fetch](https://openrouter.ai/docs/guides/features/server-tools/web-fetch)
annonce 0,001 $ par lecture, auxquels s'ajoutent les tokens des contenus transmis.
Sur ces modèles peu chers, les recherches peuvent coûter davantage que la traduction.

## Conservation et suite recommandée

Le [runner réutilisable](../web/review/luna-comparison/README.md), les
[résultats machine](../web/review/luna-comparison/results-20260924.json), les
empreintes des réponses brutes et les notes sont versionnés. Les deux répertoires
bruts sous `data/model_outputs/` restent inchangés et ignorés par Git.

Avant une éventuelle bascule vers GPT-6 : isoler le défaut de restitution JSON
avec/sans outils ou via un autre transport autorisé, puis refaire un test sur un
corpus non utilisé ici. Le validateur ne doit jamais assouplir les contraintes
d'IDs pour faire passer un modèle. Les outils religieux locaux doivent faire
l'objet d'une qualification distincte quand ils seront disponibles.

Validation du runner : tests unitaires sans réseau et contrôle de synchronisation
des prompts via `make web-luna-compare-test`. Aucun nouveau test UI, export vidéo
ou déploiement n'est revendiqué pour cette comparaison.
