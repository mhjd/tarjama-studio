# GPT-6 Luna avec raisonnement — complément du 24 septembre 2026

**Le raisonnement améliore le résultat observé sur les blocs courts, mais ne
résout pas les défauts de restitution.** Je ne recommande pas encore de basculer
la production vers GPT-6 Luna. Ce complément répond à la demande de refaire le
[premier comparatif](LUNA_TRANSLATION_COMPARISON_20260924.md) avec raisonnement.

## Protocole et exécution

Dix nouveaux appels réels à `openai/gpt-6-luna`, sans retry ni réparation :

- Huit avec `reasoning.effort=medium` : contrôle Parallel, deux passages des
  16 difficultés, corpus de 384 segments, puis quatre blocs de 96 segments.
- Un contrôle sur le corpus entier avec `none` sur la même API.
- Un contrôle complémentaire avec `high` sur le corpus entier, après l'échec
  à `medium`, pour vérifier qu'un niveau supérieur ne suffit pas à le résoudre.

Le prompt interne, le schéma, les textes et les outils Parallel sont inchangés.
La [documentation OpenAI](https://developers.openai.com/api/docs/models/gpt-6-luna)
indique que Chat Completions n'accepte l'appel de fonctions de ce modèle qu'à
`none`. Nous passons donc par
[Responses sur OpenRouter](https://openrouter.ai/docs/api_reference/responses/basic-usage).
Le contrôle `none` distingue partiellement cet effet de transport ; un seul appel
par condition ne permet pas d'attribuer statistiquement chaque différence au
raisonnement. Aucun modèle de production ni déploiement n'a changé.

Les réponses déclarent bien des tokens de raisonnement : 98 et 467 pour les
difficultés à `medium`, 104 pour le corpus entier, 233–361 par bloc, 567 pour le
corpus à `high`. Le contrôle `none` en déclare zéro. Le paramètre demandé ne sert
donc pas, à lui seul, de preuve d'exécution.

## Résultats de réception

| Essai | Réponses conformes | Temps | Coût déclaré |
|---|---:|---:|---:|
| Medium : difficultés, deux passages | 2/2 | 11,6 + 13,8 s | 0,001121 $ |
| Medium : corpus entier | 0/1 | 22,7 s | 0,002042 $ |
| Medium : corpus en quatre blocs | 3/4 | 82,4 s cumulées | 0,005222 $ |
| High : corpus entier | 0/1 | 70,3 s | 0,004889 $ |
| None, contrôle Responses : corpus entier | 0/1 | 134,9 s | 0,023944 $ |

Le corpus couvre 15 min 40,7 s. Le test découpé initial sans raisonnement avait
réussi **1/4** des blocs ; celui à `medium` en réussit **3/4**. C'est une amélioration
observée, pas une garantie de fiabilité. Sur les sept appels de traduction à
`medium`, **5/7** sont conformes contre **3/7** dans l'essai initial à `none`.

Les erreurs restent bloquantes :

- **Medium long** : la sortie s'arrête sur une clé mal formée à l'ID 122, alors
  que le corpus va jusqu'à 403 avec des trous d'IDs préexistants. Le statut API
  dit pourtant `completed`. La réponse n'est pas récupérable comme traduction
  complète ; le plafond de 32 768 tokens n'est pas atteint.
- **Medium, deuxième bloc** : JSON mal formé sur l'ID 147 ; présence supplémentaire
  des IDs 193 et 194, qui étaient fournis uniquement comme contexte. Même une
  réparation syntaxique ne satisferait pas le contrat demandé.
- **High long** : JSON invalide sur l'ID 151 (`text=` au lieu du séparateur attendu).
  Le texte va jusqu'à la fin du corpus, mais ne constitue pas un livrable validé.
- **None Responses long** : deux blocs de réponse concaténés, du texte parasite
  entre eux et des caractères supplémentaires hors JSON. Changer d'API seul
  ne résout donc pas l'incident dans ce contrôle.

Tous ces échecs sont conservés comme tels. Ni le `json_schema` strict demandé,
ni le statut `completed` ne suffisent à valider une réponse. La cause exacte
modèle/fournisseur/agrégation OpenRouter n'est pas isolée ici.

## Qualité du français

J'ai relu les deux séries de 16 difficultés et les 384 positions du corpus
découpé, avec extraction diagnostique des objets lisibles du deuxième bloc
invalide. Le corpus `high` n'a pas fait l'objet d'une seconde lecture exhaustive.
Il s'agit d'un jugement de l'agent, sans relecteur humain indépendant. Les textes
sont déjà connus du premier benchmark, pas un jeu tenu à l'écart.

Le français reste généralement naturel. Les négations, nombres et incertitudes
des difficultés sont préservés. Quelques améliorations sur les exemples suivis :

- L'allusion ne rajoute plus « toujours » ; « ce sens » du hadith est rendu par
  « cette idée », au lieu de « cette formulation » dans le premier essai.
- L'ID 332 garde « votre propre savoir » ; l'ID 378 garde désormais « devant Lui ».
- Le visage → essence (ID 322) et l'aide entre proches (ID 385) sont bien rendus.
- La fin du premier bloc conserve les IDs 95 et 96 et leurs textes respectifs.

Des réserves subsistent :

- Premier passage des difficultés : Maryam devient « Marie » sans demande de
  francisation ; le second garde « Mariam ».
- ID 253 : le fragment `في جنب الله` est complété par « au sujet de ce qu'ils ont
  négligé envers Dieu ». Ce développement dépasse les seuls mots du fragment
  fourni, contrairement à la consigne de ne pas compléter une citation.
- ID 365 : une précision **sur les propos** du cheikh devient « une remarque
  **du cheikh** », ce qui déplace l'attribution.
- Des petits déplacements entre fragments adjacents persistent, par exemple
  le verbe de l'ID 348 anticipé dans l'ID 347. Les IDs conservés ne suffisent pas
  à garantir une synchronisation sémantique absolument exacte.

Les améliorations sont encourageantes, mais ne justifient ni « zéro erreur » ni
un avantage qualitatif significatif démontré sur un corpus indépendant.

## Prix et outils

Les quatre blocs à `medium` coûtent **0,0052215 $**, soit **environ 0,020 $/h**
à densité identique (`× 3600 / 940,7`), contre 0,0171 $/h pour les tentatives du
premier essai à `none`. Raisonnement compris ; hors recherches, transcription,
correction arabe, rendu et reprises. **Ce sont des coûts de tentatives**, puisque
le deuxième bloc doit être refait, pas le prix garanti d'une heure validée.
Ne pas extrapoler le faible coût du corpus medium interrompu comme s'il était complet.

Le contrôle Parallel réussit : JSON final conforme, deux recherches et quatre
appels outils déclarés, cohérents avec deux lectures (déduites des compteurs,
pas une preuve détaillée des pages lues). Coût : **0,03316641 $**. Les traductions
elles-mêmes ne déclarent aucun appel web ; les outils étaient disponibles.
Les corpus religieux locaux restent absents, comme dans le premier essai.

**Total des dix appels : 0,070384475 $ déclarés par OpenRouter**, environ 7 cents.
Les tarifs affichés ne sont pas une facture indépendante. Aucun abonnement,
coût de machine ou coût des essais UI ultérieurs n'entre dans ce montant.

## Conservation et reproductibilité

Le [runner](../web/review/luna-comparison/README.md) accepte maintenant modèle,
API, niveau de raisonnement et cas individuel. Six tests unitaires du runner,
plus les deux tests de parité des prompts, passent sans réseau.
Les [résultats et extraits](../web/review/luna-comparison/reasoning-results-20260924.json)
et les empreintes sont versionnés ; réponses originales et requêtes restent
immuables sous `data/model_outputs/` :

- `luna-reasoning-medium-20260924-01`
- `luna-reasoning-medium-split-20260924-01`
- `luna-responses-none-control-20260924-01`
- `luna-reasoning-high-20260924-01`

Les observations concernent ces accès OpenRouter. Aucune correction syntaxique
silencieuse n'a été acceptée et aucun résultat échoué n'a été effacé.
