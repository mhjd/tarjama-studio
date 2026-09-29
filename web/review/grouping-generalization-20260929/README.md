# Regroupement progressif : campagne indépendante de l'application

**Résultat : A et B non retenues. Aucun déploiement ni nouveau MP4.**
Protocole : [PROTOCOL.md](PROTOCOL.md). Bilan :
[rapport](../../../docs/SUBTITLE_GROUPING_EXPERIMENT_RESULTS_20260929.md).

Ce dossier importe la mesure et les contraintes du prototype de rendu, sans
modifier son code. `candidate_a.py` conserve exactement la première candidate ;
`candidate.py` contient B, dernière variante rejetée. Le runner évalue B. Les
résultats A conservent le code exact exécuté et ses empreintes dans leur dossier
privé ; ne pas utiliser le runner actuel pour prétendre reproduire A.

Commandes depuis la racine (nouveau nom obligatoire, aucun écrasement) :

```sh
make web-grouping-experiment-test
make web-grouping-experiment-qualify
# Le contrôle ci-dessus ÉCHOUE volontairement pour la candidate rejetée.
# Ne pas le confondre avec la suite de tests applicatifs.
make web-grouping-experiment ARGS='dev --run nouveau-nom'
```

Ne pas relancer pour produire à nouveau une preuve déjà disponible. Les deux
essais réellement exécutés sont `dev-a` et `dev-b`, dans
`web/.cache/grouping-generalization-20260929/`. Chaque lancement crée un dossier
exclusif, monte uniquement ses entrées en lecture seule et impose réseau coupé,
2 CPU, 1536 Mio, 128 processus et dix minutes maximum. Aucun média, secret ou
volume de production n'est monté. Aucun crédit IA dépensé.

Les commandes `historical` et `short` sont bloquées en l'absence de
`SELECTION.json`. Ce fichier n'a **pas** été créé : aucune candidate n'a franchi
la qualification de développement. La conférence Dedew reste réservée ; le
reportage court est partiellement exposé par des extraits de vieux journaux UI.

Les compteurs ne suffisent pas à qualifier la cohérence. Ne pas « réparer »
le test négatif en affaiblissant son assertion ou en ajoutant les mots du cas
à une liste. Une éventuelle campagne suivante doit fixer une nouvelle hypothèse
avant de toucher au code et conserver ces résultats négatifs.
