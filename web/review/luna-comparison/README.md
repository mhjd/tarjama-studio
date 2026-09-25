# Comparaison Luna / DeepSeek — traduction arabe → français

Benchmark isolé de l'application. Il ne déploie rien, ne modifie aucun projet
utilisateur et ne change pas le fournisseur de production. Aucun appel Gemini.
Résultats et décision : [rapport du 24 septembre](../../../docs/LUNA_TRANSLATION_COMPARISON_20260924.md).

## Relancer

Ces commandes font des appels **payants** à OpenRouter. Le programme lit lui-même
la clé administrée dans `/etc/vps-agent-secrets/openrouter.api_key` ; ne pas
l'afficher, la copier dans une commande ou la passer dans une variable CLI.

```sh
make web-luna-compare-test
make web-luna-compare BENCHMARK_OUTPUT=data/model_outputs/luna-comparison-NOUVEAU
make web-luna-compare BENCHMARK_OUTPUT=data/model_outputs/luna-comparison-split-NOUVEAU BENCHMARK_SPLIT=1
```

Sur ce VPS, `make` est disponible sous `web/.cache/make`.
Chaque commande payante refuse un répertoire existant et fait au plus 12 appels.
Trois modèles sont exécutés en parallèle ; les quatre séries sont séquentielles.
Pas de retry automatique, pas de repli fournisseur/modèle. Délai réel de 300 s
par appel dans un processus séparé. Arrêt entre séries si le coût **déclaré**
atteint 2 USD : ce seuil ne plafonne pas les trois appels déjà en vol et ne
couvre pas un coût absent des métadonnées.

Pour ne tester que GPT-6 Luna avec raisonnement et outils Parallel, utiliser
l'API Responses (Chat Completions ne prend en charge ses outils qu'à `none`) :

```sh
make web-luna-compare BENCHMARK_OUTPUT=data/model_outputs/luna-medium-NOUVEAU BENCHMARK_MODEL=openai/gpt-6-luna BENCHMARK_API=responses BENCHMARK_REASONING=medium
make web-luna-compare BENCHMARK_OUTPUT=data/model_outputs/luna-medium-split-NOUVEAU BENCHMARK_MODEL=openai/gpt-6-luna BENCHMARK_API=responses BENCHMARK_REASONING=medium BENCHMARK_SPLIT=1
```

Chaque commande ci-dessus fait quatre appels. `BENCHMARK_CASE=corpus` permet un
seul appel sur le corpus entier ; il ne se combine pas avec `BENCHMARK_SPLIT=1`.
Le niveau de raisonnement est enregistré avec les tokens de raisonnement
**retournés par l'API** : une option demandée ne prouve pas son exécution.
Le contrôle web avec raisonnement autorise 8 192 tokens de sortie au lieu de
2 048 ; les traductions restent à 32 768, raisonnement compris. Les erreurs HTTP
400/401/403/404/422 arrêtent la série pour éviter de répéter une configuration
rejetée. Une sortie linguistique ou JSON invalide reste un résultat du test.

Les messages et le schéma sont transposés au format Responses sans réécriture du
prompt. Tous les textes de sortie sont conservés pour la validation, y compris
un éventuel préambule indésirable. Le statut `completed` est requis ; un appel
de fonction client non exécuté ou un refus ne devient jamais une traduction.
Changer d'API en même temps que le raisonnement est un facteur de comparaison à
déclarer. Un contrôle Responses à `none` permet de mieux les distinguer.

Le mode normal exécute un contrôle web distinct, les 16 difficultés linguistiques,
le corpus complet, puis les mêmes difficultés une seconde fois. Le mode split
exécute seulement les quatre quarts du corpus, avec deux segments de contexte de
chaque côté. Le contexte ne doit jamais apparaître dans la sortie.

## Contrat et preuves

- Modèles : `openai/gpt-6-luna`, `openai/gpt-5.6-luna`,
  `deepseek/deepseek-v4.1-flash`.
- Prompt serveur courant, issu du prompt desktop commun ; même schéma strict,
  mêmes outils Parallel, `reasoning.effort=none` pour tous.
- Fixtures reprises sans modification de `../translation-lite/` ; le nom
  historique de ce répertoire ne sélectionne aucun modèle.
- Validation stricte importée de `../model-comparison/run.py`, sans exécuter son
  ancien programme retiré. JSON invalide, ID absent/réordonné, texte vide ou
  réponse inachevée restent des échecs, jamais réparés silencieusement.
- Répertoire brut : requêtes sans en-têtes, entrées, réponses JSON, résumés,
  sorties acceptées, catalogue tarifaire, protocole et copie du script exécuté.
  Aucune erreur HTTP brute n'est conservée. Une valeur de clé éventuellement
  reflétée par le fournisseur est masquée avant persistance.
- `results.json` inclut les échecs et leur coût quand l'API le fournit.
  `hashes.json` permet de contrôler les JSON archivés. Les sources, corpus et
  outils peuvent évoluer : comparer les requêtes archivées avant de comparer
  deux dates. Une relance n'est pas déterministe.

Les deux runs du 24 septembre sont conservés, sans réécriture, dans
`data/model_outputs/luna-comparison-20260924-01/` et
`data/model_outputs/luna-comparison-20260924-split-01/` (ignorés par Git).
Le premier utilisait des threads et un timeout de socket ; le second a un délai
réel par processus. Aucun timeout n'est survenu. Les petites améliorations
ultérieures du runner conservent les mêmes requêtes : contrôle du modèle renvoyé,
compteurs d'outils même en cas d'échec, quatre parts bornées.

Les résumés, empreintes, extraits et notes de lecture sont versionnés ici.
`raw-hashes-20260924.json` couvre aussi la copie du script de chaque run.
Les extraits récupérés individuellement dans une réponse JSON invalide servent
uniquement à l'analyse linguistique : **ils ne constituent pas une traduction
acceptée**. Le classement éditorial ne remplace pas la validation du fichier.

### Reprendre un bloc échoué

`--case corpus-part-2` reprend uniquement le deuxième quart du corpus, avec
les mêmes frontières et contexte. `make web-luna-recover BENCHMARK_PART=2 BENCHMARK_OUTPUT=NOUVEAU_DOSSIER`
rejoue ses deux moitiés à `medium` sur Responses, deux appels payants maximum.
Voir le complément « résultat complet après reprises » dans
`docs/LUNA_REASONING_COMPARISON_20260924.md` pour le cumul des échecs et succès.
Les données originales et les trois autres blocs acceptés restent inchangés.


## GLM-5.3-Flash et blocs temporels

Le modèle `z-ai/glm-5.3-flash` est disponible explicitement ; il n'est pas ajouté
au trio par défaut. La nouvelle option `BENCHMARK_CHUNK_MINUTES=10` conserve
le contrôle Parallel et les deux passages des difficultés, mais remplace le
corpus entier par des blocs temporels d'au plus dix minutes. Les segments ne
sont ni coupés ni réordonnés ; deux segments de contexte de chaque côté sont
conservés. Un segment individuel trop long ou des temps incohérents sont refusés.
Cette option est incompatible avec `BENCHMARK_SPLIT`.
`BENCHMARK_CASE=corpus-timed-1` permet de ne reprendre que le premier bloc, dans
un nouveau dossier. `BENCHMARK_TIMEOUT_SECONDS=600` autorise explicitement un
essai diagnostique de dix minutes au lieu de cinq ; cette variation figure dans
le protocole et ne modifie pas le timeout applicatif.

Le 25 septembre, le catalogue déclare `low`, `high`, `max` pour GLM, raisonnement
obligatoire. `medium` n'étant pas proposé, le benchmark demandé utilise `high`,
le niveau intermédiaire disponible. Le programme refuse un effort explicitement
absent des niveaux publiés avant de lire la clé ou de faire un appel payant.
Le réglage demandé et les tokens de raisonnement retournés restent distincts.

```sh
make web-luna-compare BENCHMARK_OUTPUT=data/model_outputs/glm53-NOUVEAU \
  BENCHMARK_MODEL=z-ai/glm-5.3-flash BENCHMARK_REASONING=high \
  BENCHMARK_CHUNK_MINUTES=10
```

Pour le corpus de 384 segments, cela produit cinq appels au maximum : contrôle
web, difficultés, deux blocs de 259 et 125 segments (599,98 s et 340,72 s), puis
difficultés répétées. Pas de retry caché, pas de réparation de JSON. Le catalogue
et les frontières figurent dans les preuves de chaque exécution. Les options
restent isolées de la configuration et du déploiement de l'application.

Résultats et limites : [rapport GLM du 25 septembre](../../../docs/GLM53_TRANSLATION_BENCHMARK_20260925.md).
