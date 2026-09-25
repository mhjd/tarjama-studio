# Comparaison autonome Gemini Flash Lite

Préparée le 25 septembre 2026, à lancer explicitement par le propriétaire.
Aucun appel de génération effectué pendant la préparation. Aucun changement
applicatif ni déploiement. Les identifiants 3.1 et 3.5 Flash Lite, leur prise en
charge de `high` et des sorties structurées ont été vérifiés dans le catalogue
public OpenRouter. Le runner les vérifie à nouveau au lancement.

## Lancer sur le VPS

Depuis `/home/codex/projects/tarjama-studio` :

```sh
nohup web/.cache/make web-gemini-lite-benchmark >> web/.cache/gemini-lite-benchmark.log 2>&1 < /dev/null &
```

La commande survit à la fermeture du terminal et ne dépend pas d’une session
Codex. Le fichier journal annonce `RESULTS:` avec le dossier unique créé sous
`data/model_outputs/gemini-lite-pair-<date>-<identifiant>/`. Il annonce ensuite
`FINISHED: complete` ou `finished_with_failures`. Ne pas relancer simplement
parce que le terminal ne montre rien ; lire le journal :

```sh
tail -n 20 web/.cache/gemini-lite-benchmark.log
```

Un verrou empêche deux exécutions simultanées de cette commande. Chaque nouveau
lancement après la fin constitue en revanche un nouvel essai payant, dans un
nouveau dossier. Les anciens résultats ne sont jamais écrasés.

## Protocole fixe

1. `google/gemini-3.1-flash-lite`.
2. `google/gemini-3.5-flash-lite`.

Même corpus arabe de 384 segments / 940,7 secondes ; quatre blocs temporels
d’environ quatre minutes, résumé cumulatif et cinq lignes bilingues précédentes.
Chaque modèle crée sa propre mémoire. Prompt interne commun, raisonnement `high`,
Chat Completions, schéma JSON strict demandé, contrôle métier local des IDs,
provider Google AI Studio imposé et vérification Generation, aucun fallback.
Parallel search/fetch disponibles, aucun outil web natif ajouté ; leur présence
ne signifie pas que le modèle les utilisera. Les outils locaux religieux ne
sont pas disponibles dans ce benchmark. Aucun plafond de tokens de sortie
imposé par le client. La comparaison avec Gemini 3.8 précédent devra mentionner
que celui-ci utilisait JSON simple et un plafond de sortie de 32768 tokens.

Au premier bloc invalide, la chaîne du modèle s’arrête pour ne pas propager une
mémoire invalide ; le deuxième modèle est quand même essayé. Aucune réparation,
aucun retry automatique. On ne prétend pas mesurer les quatre blocs si la chaîne
s’arrête avant. La validation technique ne mesure pas la qualité de traduction :
la relecture comparative sera faite après le retour du propriétaire.

## Bornes et interruption

Maximum huit appels de traduction, séquentiels ; 300 secondes par appel,
1500 secondes par modèle (environ 50 minutes au maximum pour la paire).
Le superviseur arrête le groupe de processus et ses workers en cas de délai
dépassé, SIGINT ou SIGTERM. Aucun signal de présence de l’agent n’est requis.
Le statut indique le PID du superviseur pour un arrêt volontaire : lui envoyer
SIGTERM, pas seulement tuer le processus `make` ou le shell.

Le runner conserve aussi ses limites : arrêt entre blocs après 2 USD déclarés
par modèle, prix de routage maximum de 1 USD/M en entrée et 3 USD/M en sortie,
maximum 16 appels d’outils par traduction, dont 6 recherches et 10 fetch.
**Ce ne sont pas des plafonds de facture totale** : une requête en vol, ses
outils ou un coût manquant peuvent dépasser le seuil. Une déconnexion ne garantit
pas l’arrêt de la génération déjà acceptée en amont. Aucun redémarrage après
interruption. En cas de timeout, les coûts sont indiqués comme potentiellement
incomplets. Les limites temporelles ne demandent pas au modèle de tronquer son
raisonnement ou sa réponse.

La clé administrée est lue uniquement par le runner au moment de l’exécution ;
aucune valeur n’est affichée ni passée en argument. Requêtes archivées sans
en-tête d’autorisation, dossiers privés, sorties brutes préservées.

## Livrables et vérification

`status.json` : état global et par modèle, blocs valides, coût connu, durée.
Un code de sortie 0 exige quatre blocs valides pour chacun des deux modèles ;
2 signifie résultat incomplet/interruption/erreur ; 3 signifie lancement concurrent
refusé. Les journaux par modèle et les sous-dossiers contiennent les requêtes,
réponses, traductions acceptées, provenance et empreintes produits par le runner.
`supervisor-used.py` conserve le superviseur utilisé. Ne pas transmettre les
traces de raisonnement comme explication du modèle ; analyser ses sorties finales.

Vérification sans réseau, sans secret et sans génération :

```sh
make web-gemini-lite-benchmark-check
```

Sur ce VPS, remplacer `make` par `web/.cache/make`. Lors de la préparation :
17 tests du benchmark/superviseur + 2 tests de parité du prompt réussis, puis
simulation des deux commandes. Le test d’arrêt lance et termine un processus
local inoffensif ; il ne contacte aucun fournisseur.
