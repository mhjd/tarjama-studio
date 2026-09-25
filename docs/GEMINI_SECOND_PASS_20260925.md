# Gemini réviseur de la traduction Luna — 25 septembre 2026

## Protocole avant réception

Demande : vérifier si la traduction Luna suivie d'une relecture Gemini améliore
les erreurs à coût raisonnable. Un seul appel, sans relance, même corpus arabe et
même français Luna que la relecture Luna précédente : 384 segments / 940,7 s,
passage complet. Même prompt de révision, mêmes IDs et textes avant exacts exigés,
même schéma différentiel. Aucun indice sur les erreurs attendues transmis.

`google/gemini-3.8-flash`, raisonnement **medium**, comme pour la relecture Luna ;
ce niveau diffère du high de la traduction intégrale Gemini. Chat Completions,
fournisseur Google AI Studio imposé, aucune bascule, provenance recoupée avec
Generation. JSON schema natif, validateur local inchangé. Parallel seulement,
deux recherches et deux lectures maximum. Aucun corpus religieux local.

Un appel maximum, 300 secondes, 8192 tokens sortie incluant raisonnement. Une
réponse visible courte ne signifie pas peu de tokens facturés : les tokens de
raisonnement sont également comptés. Prix plafond entrée 1 USD/M, sortie 4 USD/M.
Le superviseur `web/.cache/gemini-review-guard/supervise.py` coupe le processus
après 60 s sans renouvellement externe du lease et ne redémarre jamais. Une
requête déjà acceptée peut rester facturée. En cas de coupure : lire son
`status.json` et `run.log`, puis `data/model_outputs/gemini-blind-review-20260925-01`.
Ne pas relancer ni écraser les résultats automatiquement.

Critères repris du [test Luna](LUNA_SECOND_PASS_20260925.md) : attribution ID 365,
citation complétée ID 253, alignement 347–348, réserves de registre 151 et 144.
Évaluer également les corrections nouvelles, les faux positifs et les régressions.
Aucune proposition ne sera appliquée à la traduction ou à l'application.

## Résultat

**Aucune erreur signalée.** La réponse visible est :

````text
```json
{
  "issues": []
}
```
````

Le validateur strict refuse cette enveloppe Markdown (`JSONDecodeError`). La
lecture diagnostique de son contenu est néanmoins sans ambiguïté : liste vide.
Il ne s'agit pas d'un lot de corrections caché par le seul défaut de format.
Aucune réparation acceptée, aucune modification appliquée. `finish_reason=stop` ;
le plafond de 8192 tokens n'est pas atteint, donc ne pas affirmer que la réponse
a été coupée par ce plafond.

Métadonnées Generation : Google AI Studio, `google/gemini-3.8-flash-20260902`.
Le champ Chat conserve l'anomalie « OpenAI » déjà documentée ; la provenance est
recoupée avec Generation et la restriction du fournisseur. Les requêtes portent
sur des entrées et un prompt **identiques octet pour octet** à l'essai Luna.
API/transport et tokenisation diffèrent ; c'est un essai de chaque configuration,
pas une mesure répétée du modèle seul. Aucun appel web déclaré dans les compteurs.

### Détection

Aucun des cinq points suivis n'est signalé : attribution au cheikh, citation
complétée, déplacement 347–348, « contester » et explicitation sur « comprendre ».
Les deux derniers étaient des réserves ; les trois premiers restent des défauts
plus nets dans le français fourni. L'absence d'alerte ne démontre pas leur absence.
Aucune nouvelle correction ni fausse alerte visible ; la précision d'une liste
vide ne constitue pas une mesure pertinente de qualité.

Luna avait repéré deux points sur cinq et formulé d'autres propositions utiles,
mais aussi des correctifs problématiques. Dans cette tentative, Gemini ne fournit
**aucun gain de révision observable**. Ne pas généraliser à tous les prompts,
niveaux de raisonnement ou tailles de blocs ; aucun de ces autres réglages n'a
été essayé dans cette expérience bornée.

### Tokens, prix et temps

- Temps : **44,494 secondes** ; un appel, sans reprise.
- Entrée : **25 761 tokens**, coût déclaré **0,01932075 USD**.
- Sortie : **7875 tokens**, coût déclaré **0,02953125 USD**.
- Dont **7861 tokens de raisonnement** ; différence sortie moins raisonnement :
  **14 tokens**, cohérente avec la minuscule réponse visible.
- Total de relecture : **0.048852 USD**, contre 0,00533855 USD pour Luna.

Le raisonnement représente **99,8 % des tokens de sortie**. Une sortie visible
courte ne garantit donc pas une faible dépense. L'entrée constitue également
environ 40 % du prix ici : relire tout l'arabe et tout le français a un coût.
Les tarifs viennent du champ usage de l'API, pas d'une facture indépendante.

Avec la traduction Luna initiale (0,008144895 USD, reprises incluses), coût de
cette stratégie tentée : **0.056996895 USD** pour 15 min 40,7 s, extrapolé à
**0.218 USD/h** à densité comparable. C'est environ 5,4 fois moins que
la traduction intégrale Gemini high précédente, mais **sans amélioration obtenue**.
Ce chiffre n'est pas le prix d'une traduction corrigée ou validée sémantiquement.
Il exclut ASR, export, hébergement et recherches additionnelles ; l'effort medium
ici diffère du high utilisé pour traduire intégralement avec Gemini.

### Conclusion

L'idée de réserver le modèle plus coûteux à la révision peut être économiquement
raisonnable, mais cet essai n'en démontre pas l'efficacité : Gemini n'a rien
signalé malgré les défauts présents. Ne pas basculer automatiquement sur cette
stratégie sur la seule base de son prix ou de la brièveté de sa réponse. Il faudrait
un autre protocole préétabli puis un extrait inédit avant d'envisager l'intégration.
Aucun appel restant, surveillant terminé normalement, aucune relance prévue.

[Résultats et empreintes](../web/review/luna-comparison/gemini-second-pass-results-20260925.json).

## Reproduction

```sh
make web-luna-review BENCHMARK_OUTPUT=data/model_outputs/gemini-review-NOUVEAU \
  BENCHMARK_MODEL=google/gemini-3.8-flash
```

Cette commande seule ne lance pas la surveillance externe. Le modèle de relecture
par défaut reste Luna ; aucun modèle applicatif changé. Treize tests runner et
deux tests de parité des prompts passent. Les textes et prompts sont connus :
ce n'est pas un corpus indépendant et il n'y a pas de juge humain indépendant.


## Complément demandé : sans plafond de sortie côté client

L'utilisateur demande de retirer le plafond artificiel de tokens, en conservant
une réponse limitée aux erreurs trouvées, pas une nouvelle traduction complète.
Une nouvelle tentative explicite est lancée dans
`data/model_outputs/gemini-blind-review-unlimited-20260925-01`, même prompt,
entrée, modèle, fournisseur et raisonnement medium. Seul le plafond de sortie
est retiré : ni `max_tokens` ni `max_output_tokens` envoyé. Les limites propres
au modèle/fournisseur subsistent ; aucun budget de raisonnement séparé ajouté.
Un seul appel, pas de reprise automatique, surveillance de présence 60 secondes
et délai global 300 secondes conservés. Le premier essai n'avait pas de marqueur
de troncature ; son résultat ne peut être attribué au plafond sans preuve.

Reprise en cas de coupure : consulter
`web/.cache/gemini-review-unlimited-guard/status.json`, son `run.log` et les
artefacts. Ne pas relancer automatiquement.

### Résultat du complément

**Deux suggestions, aucune des cinq erreurs/réserves suivies détectée.** Gemini
propose de retirer le point et les guillemets fermants prématurés en 288, puis
« parmi ce qui est intelligible » à la place de « à quelque chose de raisonnable »
en 289. C'est une amélioration syntaxique locale plausible de l'enchaînement arabe,
mais pas une résolution des défauts principaux identifiés. Aucun texte corrigé
complet validé ou appliqué.

La réponse est encore entourée de balises Markdown ; les objets utilisent
`justification` au lieu de `explanation` et une confiance numérique `0.95` au lieu
de l'énumération demandée. Même en retirant les balises à titre diagnostique, le
contrat ne serait pas conforme. Les champs avant correspondent exactement au
texte fourni. `finish_reason=stop`, provenance Generation Google AI Studio et
`google/gemini-3.8-flash-20260902`.

- Temps : **66,206 s** ; un seul appel supplémentaire explicitement demandé.
- Entrée : **25 761 tokens**, dont **20 445 en cache** ; coût **0,005520375 USD**.
- Sortie : **11 754 tokens**, dont **11 569 de raisonnement** et une différence
  de **185 tokens** pour la réponse visible ; coût **0,0440775 USD**.
- Total relecture : **0.049597875 USD**. Le coût reste voisin de l'essai plafonné
  grâce au cache d'entrée, malgré davantage de tokens de raisonnement/sortie.
- Luna initial + cette seule seconde passe : **0.057742770 USD**, extrapolé à
  **0.221 USD/h** à densité comparable ; coût d'une stratégie tentée,
  pas d'un résultat corrigé et validé.
- Les **deux essais Gemini de révision** ont coûté au total **0,098449875 USD**.
  Ce montant expérimental ne doit pas être présenté comme le prix d'une seule passe.

La requête est vérifiée identique à la précédente hormis le retrait de `max_tokens`.
Aucun `max_output_tokens` ni plafond séparé de raisonnement n'est envoyé. Les limites
propres au fournisseur subsistent. Un seul essai par condition ne permet pas de
séparer effet du plafond et variabilité du modèle. L'essai ne confirme pas que
Gemini retrouve systématiquement les erreurs de Luna, même avec une sortie libre.
Le surveillant a terminé normalement ; aucun processus ni appel restant.

[Mesures du complément](../web/review/luna-comparison/gemini-second-pass-unlimited-results-20260925.json).

```sh
make web-luna-review BENCHMARK_OUTPUT=data/model_outputs/gemini-review-NOUVEAU \
  BENCHMARK_MODEL=google/gemini-3.8-flash BENCHMARK_NO_OUTPUT_LIMIT=1
```
