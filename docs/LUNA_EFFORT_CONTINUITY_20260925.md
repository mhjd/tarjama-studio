# Luna high contre medium — continuité, 25 septembre 2026

## Protocole et périmètre

Comparaison demandée par le propriétaire : `openai/gpt-6-luna`, raisonnement
`high` puis `medium`, Responses, fournisseur OpenAI imposé, sans fallback.
Corpus existant : 384 segments arabes, 940,7 secondes, découpé en quatre blocs
chronologiques de 90, 114, 103 et 77 segments (environ quatre minutes).
Même prompt métier, résumé cumulatif de 1500 caractères maximum et cinq lignes
bilingues précédentes. Chaque condition construit sa propre mémoire : les entrées
du premier bloc sont identiques ; celles des suivants peuvent diverger.
Parallel search/fetch disponibles, pas de recherche native supplémentaire.
Aucun plafond artificiel de tokens de sortie ; 300 secondes par appel,
arrêt de la chaîne au premier résultat invalide, aucune réparation automatique.
Les prix sont les coûts mesurés retournés par l’API, pas des tarifs annoncés.

Le corpus et ses difficultés sont déjà connus : ce n’est pas une évaluation
sur données tenues à l’écart. Examiner séparément fidélité linguistique, alignement
des segments, validité du contrat JSON, temps et coût. Les problèmes connus
(253, 347–348, 365 notamment) ne sont jamais révélés au modèle. Sans accès aux
blocs concernés, on ne peut pas établir que ces problèmes sont corrigés.
Pas de qualification audio ni de certification des citations religieuses.

## Sécurité d’exécution et interruption

Un superviseur externe exige un signal de présence renouvelé par l’agent sous
60 secondes, sans auto-renouvellement ni redémarrage, et impose 1200 secondes
au total. Le premier essai high a terminé son premier bloc puis s’est arrêté
sur JSON invalide. La première tentative medium a été interrompue par expiration
du signal de présence : son dossier est vide, sans requête archivée. Une nouvelle
exécution medium distincte est lancée, avec quatre appels au maximum et les mêmes
protections. Aucun retry high. Une requête déjà acceptée par le fournisseur peut
rester facturée malgré la déconnexion ; aucun coût inconnu n’est assimilé à zéro.

## Résultats

Les deux chaînes s’arrêtent au **premier bloc**, conformément au protocole.
Comparaison effective : 90 segments source, 237,12 secondes, un appel terminé
par condition. Les requêtes archivées sont **identiques sauf reasoning.effort**.
Aucune mémoire précédente dans ce premier bloc ; l’effet de la continuité entre
blocs n’a donc pas été évalué. Aucun segment n’a été accepté ou importé.

| Mesure | High | Medium |
| --- | ---: | ---: |
| Temps client | 44,799 s | 46,918 s |
| Coût déclaré USD | 0,00265155 | 0,00180305 |
| Tokens entrée | 3 797 | 3 797 |
| Tokens sortie, raisonnement compris | 4 354 | 2 657 |
| Tokens raisonnement déclarés | 2 408 | 583 |
| Recherche / fetch exécutés | 0 | 0 |
| Contrat accepté | Non | Non |
| Problème | Syntaxe JSON invalide, ID 66 | 89 segments au lieu de 90 ; ID 87 absent |

Le modèle retourné est `openai/gpt-6-luna` et les métadonnées Generation
indiquent OpenAI / `openai/gpt-6-luna-20260922` pour les deux appels. Cela reste
la provenance déclarée par OpenRouter, pas une attestation indépendante des poids.
High coûte environ **47 % de plus sur ce seul appel**. Le faible écart de temps
ne démontre pas une différence de latence reproductible. Coût connu total :
**0,00445460 USD**, hors éventuel coût inconnu de la tentative interrompue.
Pas d’extrapolation en prix d’une heure livrée : aucune chaîne n’a abouti.

### Format strict déjà demandé

Ce n’est pas seulement une instruction textuelle : les deux requêtes Responses
contiennent `text.format.type = json_schema`, `strict = true`, le schéma complet
et `provider.require_parameters = true`. Aucun plafond `max_output_tokens`.
Malgré cela, la réponse high, marquée `completed`, contient :

```text
{"id":"66","text qu’elle ne comprend que des vérités absolues et certaines,"}
```

C’est une violation de syntaxe, et donc du format demandé. La cause dans la
chaîne fournisseur / routage / génération n’est pas établie. Ce constat ne doit
pas être assimilé à une infériorité linguistique. La
[documentation officielle OpenRouter](https://github.com/OpenRouterTeam/docs/blob/main/guides/features/structured-outputs.mdx)
précise que l’application des contraintes varie selon le fournisseur. Le schéma
actuel exige des IDs textuels, sans imposer la liste exacte ni la longueur du
corpus : l’omission de medium est rejetée par la validation métier locale,
pas nécessairement interdite par ce schéma JSON.

### Lecture linguistique et alignement

Les deux textes finaux du bloc ont été lus face aux 90 segments arabes, sans
consulter les traces de raisonnement. Pour high, lecture diagnostique du texte
brut seulement : aucune réparation ni réimportation du JSON.

- **IDs 71–87 : avantage net high sur l’alignement.** L’arabe 71 signifie que
  tout le monde doit passer par ce chas ; 72 dit « C’est faux » ; 73 introduit
  la doctrine comme discipline. High garde ces contenus aux bons IDs. Medium
  condense le passage précédent puis met « C’est faux » à 71 et la discipline
  à 72 : le décalage continue sur la grammaire, le soufisme, la morphologie,
  puis la foi. Il omet finalement l’ID 87. Ce serait visible en sous-titrage.
- **IDs 6–7 : avantage medium.** Le vers commence déjà dans l’arabe 6 et la
  suite 7 dit « lisse, sans grain de beauté ni cicatrice ». Medium conserve
  cette répartition. High ne garde que l’introduction à 6, déplace le début
  du vers à 7 et n’y restitue pas les grains de beauté ni cicatrices.
  Le vers répété aux IDs 10–11 est complet : cela ne corrige pas l’omission
  ni la désynchronisation lors de sa première occurrence.
- **IDs 35–36 et 55–56 : high déplace aussi du contenu.** « Originelle »
  appartient à 36, high l’anticipe à 35. « Se battre » appartient à 56,
  high l’anticipe à 55. Medium respecte mieux ces coupures, mais « se
  quereller » atténue la violence physique exprimée par `يتضارب`.
- **IDs 1 et 4 : les deux restituent le sens essentiel**, restreindre ce qui
  est vaste et le sentier dans la montagne. Français généralement lisible
  dans les deux sorties ; plusieurs variantes relèvent du style.

Sur ce bloc, high évite la dérive durable des IDs de medium, mais ne respecte
pas parfaitement chaque coupure et perd un fragment du vers. **Aucun verdict
global de meilleure fidélité ni d’absence de contresens n’est établi.**
Les erreurs précédemment discutées aux IDs 151, 253, 347–348 et 365 sont hors
périmètre atteint. Une seule sortie par réglage, corpus connu, pas de relecture
humaine indépendante ni retour à l’audio : pas de classement statistique.

## Décision et preuves

Ne pas remplacer medium par high sur la seule base de cet essai. High montre
un intérêt pour l’alignement, mais l’intégration doit d’abord résoudre ou gérer
les sorties non conformes. Une comparaison linguistique complète demeure à faire.
Aucun changement de modèle de production ni déploiement.

Résultats, provenance, diagnostics et empreintes :
[`luna-effort-continuity-results-20260925.json`](../web/review/luna-comparison/luna-effort-continuity-results-20260925.json).
Bruts immuables : `data/model_outputs/luna-high-4min-continuity-20260925-01/`
et `data/model_outputs/luna-medium-4min-continuity-20260925-02/`.
Les scripts et états finaux des deux surveillants sont copiés dans
`data/model_outputs/luna-effort-guard-20260925/` et
`data/model_outputs/luna-effort-medium-guard-20260925/`.
Les deux surveillants sont arrêtés, aucun appel ne tourne encore.

## Reproduction

Sous surveillance externe avec signal de présence renouvelé par l’opérateur :

```sh
make web-luna-compare BENCHMARK_MODEL=openai/gpt-6-luna BENCHMARK_API=responses BENCHMARK_PROVIDER=openai BENCHMARK_REASONING=high BENCHMARK_CHUNK_MINUTES=4 BENCHMARK_CONTINUITY=1 BENCHMARK_NO_OUTPUT_LIMIT=1 BENCHMARK_OUTPUT=data/model_outputs/luna-high-NOUVEAU
```

Puis même commande avec `medium` et un autre dossier inédit. Ne jamais
relancer automatiquement sur échec. Le nouveau paramètre enlève uniquement
la limite de sortie demandée par le client ; les limites du fournisseur restent
applicables. Le comportement par défaut du runner n’est pas modifié.
Validation du runner : 14 tests et 2 tests de parité de prompt réussis.

