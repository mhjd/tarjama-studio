# Extrait Sirat — références dans le texte

Entrée : copie fournie par le propriétaire/admin, projet version 6,
16 segments à 06:28.260–07:23.380. Aucun français préalable transmis au modèle.
Deux citations à distinguer : 17:31 (crainte de pauvreté) et 6:151 (pauvreté).
Cette attente humaine n'est pas incluse dans la requête. Aucun prompt spécial
qui force un appel d'outil : prompt de production `translation-parallel-v4-inline`.

Modèle : `openai/gpt-6-luna`, raisonnement medium, même provider/runner que
l'application, corpus `20260925-v2`, outils Parallel habituels également présents.
Les textes, IDs et bornes source ne sont pas modifiés. Aucune base applicative
ni projet utilisateur n'est touché. Une seule génération, sans relance automatique ;
runner borné à six tours/cinq minutes et processus externe à 420 secondes.

Commande payante explicite, dossier de sortie impérativement neuf :

```sh
make web-inline-reference-check REFERENCE_CHECK_OUTPUT=data/model_outputs/inline-reference-NOUVEL-ESSAI
```

Sur ce VPS, `make` est `web/.cache/make`. Le programme lit le fichier de clé
enregistré sans afficher ses valeurs ni ses en-têtes. Requêtes et réponses
brutes restent dans le dossier de sortie ; aucun écrasement silencieux.
Le secret ne doit jamais être copié dans ce dossier ou committé.

Critères : JSON accepté par la validation applicative, IDs/nombre/ordre intacts,
appels locaux réellement exécutés, références et mots cités conformes aux
résultats du corpus, parenthèse unique sur chaque passage concerné, pas de
référence ajoutée au commentaire autour. Noter le coût et la durée, les défauts
linguistiques et les limites de lecture sans les confondre avec un problème JSON.

## Qualification réaliste demandée ensuite

Le propriétaire a demandé un bloc habituel et les vraies fonctions. Le benchmark
accepte désormais `--chunk-index` : il appelle `studio.TextChunks`, puis
`studio.TextChunkContext`, fonction partagée avec `Worker`. L'appel reste
`HTTPProviders.Text` avec le prompt embarqué, Luna medium, les outils du corpus,
le runner de production et `ValidateText`. Aucun prompt spécial de diagnostic.
Les retries du worker/base de données ne sont pas simulés : une génération bornée.

Le premier bloc réel contient **145 segments**, de **00:00.680 à 09:57.760**,
avec les deux premiers segments du bloc suivant en `context_only` (aucun précédent).
Limites actuelles : dix minutes, 300 segments, 32 000 octets arabes ; deux
segments voisins avant/après. Pas de résumé roulant en production.

Exécution avec l'entrée intégrale conservée dans le premier résultat :

```sh
REFERENCE_CHECK_INPUT=data/model_outputs/inline-reference-20260930-sirat-chunk0-01/input.json \
REFERENCE_CHECK_CHUNK=0 make web-inline-reference-check \
REFERENCE_CHECK_OUTPUT=data/model_outputs/inline-reference-NOUVEL-ESSAI
```

Trois essais, tous conservés (`results.json`) :

1. Diagnostic 55 s : deux appels locaux réussis, deux références correctes.
2. Bloc complet : six requêtes modèle, erreurs de paramètres et une recherche
   hors sujet. Trois références produites ; 4:22 omise faute de résultat reçu.
3. Même bloc, descriptions des paramètres de l'outil clarifiées : trois requêtes
   modèle, cinq appels locaux dont un invalide corrigé, quatre résultats exacts,
   quatre parenthèses correctes. 54,31 s, coût modèle rapporté 0,004901805 USD.

Les numéros 21:107, 17:31, 6:151 et 4:22 proviennent des réponses locales réellement
reçues. Les mots du fragment français suivent l'édition locale, avec variations
mineures de ponctuation/casse et omission du « Et » introductif à certains débuts
de citations : ne pas revendiquer une copie typographique strictement identique.
Aucune attribution sans résultat n'a été trouvée dans les quatre parenthèses.
Le premier appel de la dernière passe combine encore fragment et référence :
le validateur le refuse et le modèle se corrige, sans exposer l'erreur à l'utilisateur.
Aucune validation n'a été assouplie pour accepter cet appel contradictoire.

Limites : aucune recherche hadith exécutée. Le récit de Jaafar au Négus et le
récit attribué à Aïcha sur les mariages préislamiques restent sans référence.
Ce test qualifie l'affichage des citations identifiées, pas une recherche
exhaustive de toutes les allusions et récits, ni l'absence de toute erreur de
traduction. Les références ajoutent des caractères sans durée supplémentaire :
les citations courtes peuvent être plus chargées. Aucun timing n'est inventé.
Ne pas attribuer de référence par une simple ressemblance de sens pour combler
ces omissions. Aucune retraduction du projet utilisateur n'a eu lieu.
