# Fiabilité des traitements LLM : corrections du 26 septembre 2026

Cette livraison corrige les défauts reproductibles de l’[audit](LLM_RELIABILITY_AUDIT_20260926.md).
Elle a été préparée sur `web-vps`, sans déploiement ni migration de la base active.
Le déploiement autorisé ensuite et les essais fournisseurs réels sont consignés
dans [le rapport de qualification](LLM_REAL_QUALIFICATION_20260926.md).
L’incident historique de 08:26 reste de cause indéterminée : les nouveaux
journaux ne permettent pas de reconstruire des informations perdues auparavant.

## Recherche et réponse finale

Une génération peut désormais effectuer cinq requêtes de recherche/continuation,
puis une sixième réservée à la réponse finale. Le modèle conserve les messages
originaux, leur raisonnement et les résultats des outils. À la finalisation,
`tool_choice: none` interdit les nouveaux appels et les outils web sont retirés.
La finalisation intervient plus tôt après huit exécutions locales, ou lorsqu’une
continuation commence avec moins de 90 secondes sur le délai global de cinq minutes.
Un appel déjà en cours peut toujours épuiser ce délai : ce n’est pas une garantie
qu’une minute de calcul final sera disponible après une panne distante.

Si une réponse demande neuf recherches locales, les huit premières sont exécutées
et la neuvième reçoit `budget_exhausted`, sans résultat inventé. Toutes les demandes
reçoivent leur réponse protocolaire avant la finalisation. Un lot anormal de plus
de 64 appels, un outil interdit, des IDs dupliqués ou un fournisseur qui continue
à demander des outils malgré `none` sont refusés avec un code privé précis.
Un protocole généré invalide bénéficie des mêmes reprises bornées sur un morceau
plus court ; un outil interdit ou un résultat local invalide reste un échec
nécessitant une intervention.

Le budget web reste au maximum de 16 appels **sur toute la génération**, jamais
renouvelé aveuglément à chaque continuation. Chaque requête réserve au plus quatre
appels de ce budget avant de partir. Un compteur complet permet de restituer les
appels non utilisés ; un compteur partiel ou absent conserve toute la réservation.
Ainsi, même sans aucune métadonnée d’usage, quatre requêtes peuvent encore utiliser
le web avant de passer aux outils locaux et à la finalisation. Une absence de
compteur ne supprime plus immédiatement tout le budget restant.

Le compteur agrégé historique et la forme `server_tool_use` sont reconnus. Une
forme avec seulement `web_search_requests` est une observation partielle : elle
ne prouve pas l’absence de fetch et ne rembourse donc rien. Les valeurs inconnues
marquent le diagnostic comme incomplet. Le total complet peut aussi être établi
si les deux compteurs search/fetch sont explicites et valides. La documentation
illustre le compteur search ; les formes réelles restent à qualifier sur la route
utilisée, sans compromettre cette réserve conservatrice.
[Documentation OpenRouter](https://openrouter.ai/docs/guides/features/server-tools).


## Attentes, reprises et consommation

Trois états comptables distincts remplacent le compteur utilisé pour tout :

- `attempts` sert au délai de reprise, sans incrément lors d’une attente locale de quota.
- `text_failures` compte uniquement les réponses invalides du morceau courant.
  Deux reprises automatiques réduisent ce morceau, puis un échec persistant reste
  actionnable. Les morceaux déjà validés ne changent pas.
- `text_attempts` réserve durablement une tentative **avant** de contacter le
  fournisseur. Un crash, une annulation ou un timeout de facturation inconnue
  consomme donc sa place, même si aucun résultat n’est revenu.

Limites automatiques : quatre générations par ordinal de morceau ; au total,
`max(12, 4 × nombre de blocs initiaux)` par job et période de reprise explicite.
Cette seconde limite empêche les divisions successives de renouveler indéfiniment
le budget. Chaque génération conserve son propre plafond de requêtes/outils et
de durée. Ce sont des bornes de calcul, **pas un plafond financier exact** : les
boucles internes et usages manquants du fournisseur empêchent de le garantir.

Un refus 429 dès la première requête, sans usage retourné, libère la réservation.
Un 429 après une recherche déjà commencée la consomme. L’attente de quota demeure
persistante avec backoff ; elle ne consomme pas les deux reprises de format.
Seul un 429 déclenche désormais un cooldown de la clé entière. Un timeout ou un
502 sur un passage attend au niveau du job et ne bloque pas tous les utilisateurs.

« Réessayer » et l’enregistrement explicite d’une clé ouvrent une nouvelle période
`text_epoch` ; l’historique des tentatives et les morceaux terminés sont conservés.
Un redémarrage du worker, une nouvelle prise de lease ou une division de morceau
n’ouvre jamais une nouvelle période. L’application ne change pas de modèle.

## Format, taille et diagnostics

Luna medium et les blocs cibles de dix minutes sont conservés. Les garde-fous des
passages denses passent à 300 segments et 32 000 octets arabes, afin de laisser
plus de place au JSON, à l’expansion française et au raisonnement. Cela reste
une heuristique de taille, pas un tokenizer ni une preuve de non-troncature.
Les anciens blocs terminés, même plus longs, sont repris sans recalcul.

Le schéma envoyé impose le nombre de segments et, quand la liste reste compacte,
les IDs autorisés. La validation locale exige toujours chaque ID dans le bon
ordre, un texte non vide et aucun marqueur technique. Aucun résultat partiel
n’est publié comme traduction complète. Le prompt `cleanup-v2` décrit enfin les
outils qu’il reçoit réellement, avec vérification ciblée plutôt que systématique.
Le prompt métier de traduction partagé avec le desktop n’a pas changé.

Les échecs gardent désormais les métadonnées retournées par le client, y compris
lors d’une erreur dans une réponse HTTP 200. La table privée `text_attempts`
conserve le job, l’ordinal, la période, le modèle/prompt/raisonnement, les dates,
la durée, le code stable, les IDs de requêtes, les compteurs et les usages
numériques connus. Une facturation potentiellement incomplète est signalée.

Le journal applique une liste explicite de champs autorisés : aucun texte de
sous-titre, prompt, argument d’outil, résultat de recherche, secret ou message
brut du fournisseur. Il n’est pas exposé dans l’API utilisateur. Les résultats
validés continuent à conserver leur provenance documentaire séparée du texte.
Une réservation sans fin est marquée `interrupted_or_running`, pas comme gratuite
ni comme réussie. Les échecs d’écriture de l’état ne sont plus ignorés.

## Validation et portée

Commandes reproductibles, sans fournisseur réel :

```sh
make web-llm-reliability-audit
make web-test
make web-build
```

Sur ce VPS sans `make` système, utiliser `web/.cache/make` à la place de `make`.
Les scénarios de l’audit sont devenus des tests de non-régression et sont intégrés
à la suite normale. La reproduction historique reste inchangée dans
`web/review/reliability-20260926/reproduction.log`.

Contrôles ajoutés : finalisation après cinq continuations et après un lot de neuf
outils, conservation des réponses/outils/usage, formats de compteurs, attentes
sans appel, plafond des timeouts, crash après réservation, reprise manuelle sans
perte d’historique, refus de lease périmée, quota avant/après recherche, isolation
entre utilisateurs, limite globale malgré divisions, confidentialité du journal,
conservation du premier diagnostic, migration répétable avec projets existants,
schéma strict sans contournement de validation locale.

La suite complète a réussi : tests Go avec `-race`, `go vet`, build TypeScript/Vite,
46 tests Playwright (ordinateur, Pixel, iPhone), sauvegarde/restauration PostgreSQL.
Après les derniers ajustements de métadonnées et de reprises du protocole, les
suites research/studio ont été relancées intégralement avec `-race`, ainsi que
`go vet` et la compilation finale. Les fournisseurs restent simulés dans ces tests.
Preuves conservées dans `web/review/reliability-fixes-20260926/`.

Les tests déterministes établissent les garanties d’orchestration. Ils ne prouvent
ni la disponibilité du fournisseur, ni la qualité linguistique, ni l’acceptation
en production du schéma enrichi par chaque route OpenRouter. Une qualification
réelle courte, riche en références, puis longue et plafonnée reste à réaliser
après livraison. Aucune dépense API ni modification du service actif pour cette
correction. Les recherches déjà obtenues sont conservées dans une continuation ;
un nouvel essai après échec ne reprend pas une conversation fournisseur partielle.
Son coût reste borné par les réservations ci-dessus.

## Livraison préparée, sans activation

Migration additive : `004_text_attempts.sql`. Le nouveau code refuse sa readiness
si cette migration manque. Les anciennes colonnes, projets et checkpoints ne sont
ni supprimés ni réinterprétés. Les compteurs spécifiques commencent à zéro : les
anciennes erreurs ne peuvent pas être classées rétroactivement.

Après un signal séparé de déploiement :

1. Construire les images API et worker depuis le commit testé avec
   `make web-api-image web-worker-image`, puis les importer localement ; reprendre
   les digests retournés, jamais les tags d’une compilation antérieure.
2. Partir de `web/deploy/preview/active-automatic-recovery-20260926.yml` ; conserver
   secrets administrés, profils isolés, stockage et images inchangées des autres
   composants. Préparer une recette avec API/worker désactivés pour la migration.
3. Valider et planifier les recettes avant activation. Vérifier l’état, obtenir
   une **nouvelle sauvegarde réussie**, arrêter les traitements applicatifs via la
   recette prévue, puis exécuter explicitement la migration avec la nouvelle image.
4. Seulement après réussite de la migration, activer API/worker et qualifier HTTP,
   OIDC, un petit parcours réel puis le long parcours avec diagnostics et borne
   de dépense fixée. Ne pas relancer en masse les anciens jobs en échec.

Un retour à l’ancienne image reste compatible avec les ajouts de schéma, mais
perd les nouvelles protections de reprise ; il ne restaure ni données ni schéma.
Les anciens workers doivent être arrêtés pendant la bascule pour ne pas continuer
avec l’ancienne politique. Cette procédure était préparée lors du correctif ;
son exécution autorisée ensuite figure dans le rapport de qualification lié en tête.
