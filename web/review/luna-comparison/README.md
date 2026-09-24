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
