> **Retiré le 24 septembre 2026** : Gemini est définitivement exclu. Ce
> protocole sans web reste une archive ; son exécution est désactivée. Utiliser
> `make web-research-check` pour la nouvelle qualification DeepSeek/Parallel.
> Voir `docs/REFERENCE_TOOLS_AND_PARALLEL.md`. Les résultats existants sont conservés.

# Comparaison de traduction indépendante

Ce programme compare `google/gemini-3.5-flash-lite` et
`deepseek/deepseek-v4.1-flash` via OpenRouter. Il ne modifie ni l'application, ni
ses fournisseurs, ni son déploiement. Python standard uniquement.

```sh
make web-model-compare BENCHMARK_OUTPUT=data/model_outputs/comparison-NOUVEAU-RUN
```

Cette commande effectue **six appels réels potentiellement payants** : corpus
384 segments une fois par modèle et 16 difficultés linguistiques deux fois par
modèle. Pas de retry client ; routage/fallback fournisseur OpenRouter autorisé.
Le prompt serveur historique `translation-v1` est figé dans `prompt-v1.txt`,
identique pour les deux modèles et conservé avec son empreinte. Ce banc reste
explicitement sans recherche même après l’évolution du prompt de production.
Les réglages de raisonnement et de température restent ceux des fournisseurs ;
leurs valeurs annoncées sont archivées. Ce protocole compare donc les usages par
défaut, pas un budget de raisonnement identique.

Budget sortie 32 768 tokens par appel, timeout réseau 600 s. Plafond de routage
0,30 USD/M tokens d'entrée et 2,50 USD/M de sortie. Sur ces petits fichiers, les
six réponses entièrement au plafond représentent moins de 0,60 USD d'inférence
estimée ; cela n'est pas un plafond de compte imposé côté facturation. Pas de
recharge, de changement de compte ou de lecture de solde.

La clé enregistrée dans `/etc/vps-agent-secrets/openrouter.api_key` est consommée
par le programme natif, pas affichée à l'agent. Aucun en-tête ni corps d'erreur
HTTP n'est enregistré ; les redirections sont refusées. Les requêtes contiennent
uniquement des textes de test du dépôt, aucune donnée d'utilisateur de l'app.

Les résultats bruts, coûts retournés par l'API, requêtes sans en-têtes, traductions
et métadonnées sont conservés sous `data/model_outputs/`, ignoré par Git. Chaque
exécution exige un nouveau répertoire et refuse de réécrire un fichier existant.
La validation vérifie fin normale, JSON strict, nombre/ordre des IDs, texte non
vide et absence des marqueurs interdits par l'application. Elle ne prouve pas la
fidélité du sens ni le bon alignement sémantique sur l'audio.

Les temps mesurent la réponse complète, réception réseau et validation comprises,
pas le premier token. Un échantillon de trois appels par modèle ne permet pas de
mesurer la disponibilité, les percentiles ou le comportement sous charge. Le
fournisseur routé, les tokens de raisonnement et le coût réellement retourné
comptent davantage que le seul prix minimum affiché au catalogue.

Vérification sans appel payant :

```sh
python3 -B -m unittest discover -s web/review/model-comparison -v
```
