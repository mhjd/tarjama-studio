# Gemini 3.8 Flash — quatre minutes avec continuité

Essai demandé le 25 septembre 2026. Il réintroduit Gemini uniquement comme
candidat explicite du benchmark, sans changer l'application ni le trio par défaut.

## Protocole

`google/gemini-3.8-flash`, raisonnement high (supporté, choisi pour reprendre le
réglage GLM ; medium est aussi disponible), fournisseur `google-ai-studio` imposé,
aucun repli. Quatre blocs temporels de 90, 114, 103 et 77 segments, même corpus
384 segments/940,7 s. Même prompt métier, résumé cumulatif ≤1500 caractères et
cinq lignes bilingues précédentes. Résumé produit dans le même appel, jamais
inséré dans les sous-titres. JSON simple, schéma dans le prompt et contrôle local
strict, pour garder le même contrat que le dernier essai Z.AI. Pas de réparation.

Chaque provenance est recoupée avec Generation : Google AI Studio et
`google/gemini-3.8-flash-20260902`. Le champ provider de Chat peut être incohérent
(« OpenAI ») ; la provenance reste une déclaration d'OpenRouter, pas une inspection
indépendante des poids exécutés. Parallel search/fetch sont proposés ; aucun moteur
Google natif ajouté. Pas de corpus religieux local ni de contrôle web forcé séparé.

[Catalogue modèle](https://openrouter.ai/google/gemini-3.8-flash) et
[endpoints](https://openrouter.ai/api/v1/models/google/gemini-3.8-flash/endpoints)
consultés : prix standard affiché 0,75 USD/M entrée et 3,75 USD/M sortie.
Plafond sortie relevé explicitement à 4 USD/M pour ce run (défaut 3 inchangé).
Les coûts effectifs ci-dessous priment sur ces tarifs susceptibles de changer.

## Interruption et coût

Quatre appels au maximum, sans retry, arrêt au premier bloc invalide, 300 secondes
par appel, 32768 tokens de sortie maximum incluant raisonnement. Un surveillant
séparé termine le groupe de processus après 60 secondes sans renouvellement du
signal de présence par l'agent, ou après 1200 secondes au total. Il ne renouvelle
pas lui-même ce signal et ne redémarre rien. Une requête acceptée en amont peut
rester facturée même si le client se déconnecte. Voir le
[document de reprise](GEMINI38_BENCHMARK_RESUME_20260925.md).

## Résultats

Les quatre blocs sont conformes (384 segments). Les sorties françaises ont été
relues intégralement face au corpus arabe. Observations sur les deux premiers blocs :

- IDs 1 et 4 : reproche de restreindre ce qui est vaste et sentier dans la montagne
  correctement rendus. Le passage poétique 6–9 est plus naturel que chez GLM.
- ID 56 : « en viennent aux mains parce que l'un vient d'al-Azhar » restitue
  correctement la cause et l'intensité du conflit.
- ID 141 : texte présent, à son propre ID (vide chez GLM Z.AI).
- ID 159 : « L'Éternel ne saurait être multiple » est plus pertinent dans ce
  contexte que « l'Antécédent ne se pluralise pas » chez GLM.
- ID 198 : les Africains sont bien conservés, sans substitution géographique.
- Réserves : ID 58 `هذا افتراء` devient « Ce serait absurde ! » (le sens de
  fabrication/invention est atténué) ; ID 144 « vaines spéculations » ajoute un
  jugement à « ne pas s'imposer de peine à ce sujet ». ID 178 « sens dérivé »
  précise `معنى` (sens) d'une manière interprétative dans une citation délicate.
  ID 29 « hérétiques/débauchés » renforce ou spécialise les termes
  « innovateurs/pécheurs ». Ces choix méritent une relecture, pas un verdict
  automatique de parfaite fidélité.

Observations sur les deux derniers blocs :

- ID 282 : insertion éditoriale `[comme]`, inutile à l'affichage ; aucun doublon
  du nom au segment précédent, contrairement au premier essai GLM.
- ID 253 : « côté : envers Dieu » reste peu clair lorsqu'on expose justement le
  terme arabe ; le français idiomatique du fragment ne remplace pas cette explication.
- ID 334 : ajout de « Non » pour expliciter une opposition, absente littéralement
  du fragment ; cela engage une interprétation du référent du pronom.
- IDs 357–358 : les deux sous-titres restent renseignés et leur ensemble restitue
  l'absence d'attribut nouveau dû à la création. ID 365 conserve « sur les propos
  du cheikh », ID 378 « à Lui », ID 401 « nous en a informés » est correct.
- Certaines citations ou le passage 388 sont ambigus dans la transcription ;
  absence de retour au son et de corpus religieux empêchant toute certification.
- Les résumés restent lisibles et sous la limite, mais ajoutent des références
  non vérifiées par outil et quelques précisions : « points de divergence
  secondaires », par exemple. Le dernier omet « si Dieu le veut » dans son
  résumé du salut des groupes, alors que les sous-titres le conservent. La mémoire
  n'est pas un texte de référence garanti ; ici aucun bloc suivant ne l'utilise.

### Mesures finales

| Bloc | Segments | Temps | Coût USD | Résumé (caractères) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 90 | 70.363 s | 0.057342 | 1313 |
| 2 | 114 | 91.76 s | 0.08650725 | 1399 |
| 3 | 103 | 97.975 s | 0.098115 | 1308 |
| 4 | 77 | 73.545 s | 0.064062 | 1227 |

Total : **0.30602625 USD**, **333.643 s** (5 min 34 s), quatre appels sans échec,
sans reprise, sans réparation. Tous les résumés et les cinq lignes précédentes
sont vérifiés dans les requêtes suivantes ; aucun ID de contexte n'est reproduit.
Aucun outil web déclaré pendant ces traductions : cela ne qualifie pas à nouveau
le fonctionnement réel de Parallel, et aucune recherche religieuse n'est certifiée.

Extrapolation linéaire pour une heure de source de densité comparable :
**1.17 USD/h**, avec ce raisonnement high et ce tarif. Ce n'est pas une
moyenne mesurée sur plusieurs vidéos ni un coût incluant transcription, recherche
web, export, hébergement ou reprises. Le raisonnement représente l'essentiel des
tokens de sortie ; un effort différent pourrait changer coût et qualité, mais
n'a pas été testé dans ce run.

### Appréciation

Sur ce corpus, Gemini 3.8 Flash high fournit un **premier jet exploitable**,
nettement plus fiable sur le format et généralement plus naturel que GLM dans
les essais documentés. Il n'est pas sans interprétations discutables. Ce n'est
pas une autorisation de traduire sans relecture, particulièrement les citations.

GLM Z.AI avait coûté 0,00647996 USD pour deux blocs dont un refusé. Les deux
premiers blocs Gemini coûtent 0,14384925 USD (environ 22 fois plus), mais passent
les deux ; comparer ces coûts ne revient pas à comparer deux parcours réussis.
Les anciens essais GPT utilisaient d'autres découpages/API/contextes : pas de
classement contrôlé de tous les modèles. Aucun relecteur humain indépendant,
pas de corpus inédit tenu à l'écart. Aucun modèle applicatif changé.

[Mesures machine et empreintes vérifiées](../web/review/luna-comparison/gemini38-results-20260925.json).
Le surveillant a terminé normalement, aucun processus de test restant et aucun
appel automatique prévu. Le script exact et son état final sont archivés.

## Reproduction

```sh
make web-luna-compare BENCHMARK_OUTPUT=data/model_outputs/gemini38-NOUVEAU \
  BENCHMARK_MODEL=google/gemini-3.8-flash BENCHMARK_REASONING=high \
  BENCHMARK_CHUNK_MINUTES=4 BENCHMARK_CONTINUITY=1 \
  BENCHMARK_PROVIDER=google-ai-studio BENCHMARK_JSON_OBJECT=1 \
  BENCHMARK_MAX_COMPLETION_PRICE=4
```

Cette commande seule ne lance pas le surveillant : dans cet essai elle a été
exécutée par `web/.cache/gemini38-guard/supervise.py` avec son signal externe.
Archive originale : `data/model_outputs/gemini38-high-4min-continuity-20260925-01`.
Aucun secret affiché ; requêtes/réponses et coûts conservés sans écrasement.
Douze tests runner et deux tests de parité des prompts passent.
