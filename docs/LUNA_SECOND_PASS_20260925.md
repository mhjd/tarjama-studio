# Seconde passe aveugle sur la traduction GPT-6 Luna

## Protocole fixé avant l'appel

La demande est de savoir si Luna retrouve les erreurs de sa traduction en relisant
le texte arabe et français par gros morceaux. Cet essai envoie tout le corpus
15 min 40,7 s / 384 segments en un seul morceau. La traduction initiale est celle
validée dans `web/review/luna-comparison/recovery-results-20260924.json`, issue
de GPT-6 Luna medium avec reprises. Aucune nouvelle traduction préalable.

Un appel à `openai/gpt-6-luna`, medium, Responses, fournisseur OpenAI imposé,
vérification Generation. Sortie : liste de corrections avec ID, texte avant exact,
texte après, justification et confiance. Les erreurs déjà connues et leurs IDs
ne figurent ni dans la consigne ni dans une liste transmise au modèle. L'entrée
contient seulement le corpus complet et sa traduction. Les suggestions restent
séparées : aucune modification de traduction utilisateur ou de production.

Critères de lecture fixés avant réception :

- ID 365 : attribution « sur les propos du cheikh » devenue « du cheikh ».
- ID 253 : fragment de citation complété par des mots absents.
- IDs 347–348 : contenu déplacé entre sous-titres adjacents.
- ID 151 : « contester » durcit possiblement « soulever une difficulté ».
- ID 144 : explicitation « chercher à le comprendre » ; réserve contextuelle,
  pas un contresens certain. Ces deux derniers ne sont pas des erreurs certaines.

Évaluer détection, correction proposée, fausses alertes et régressions nouvelles.
Détecter quelques erreurs connues ne prouve pas que deux passes suffisent pour
n'importe quelle vidéo. Corpus connu ; aucune validation indépendante humaine.

## Coût et arrêt brutal

Un seul appel, aucun retry, 300 s maximum, 8192 tokens sortie maximum, deux
recherches et deux lectures Parallel maximum (quatre outils au total). Le
surveillant `web/.cache/luna-review-guard/supervise.py` termine le processus après
60 secondes sans signal de présence externe, sans redémarrage. Une requête déjà
reçue par le fournisseur peut rester facturée après déconnexion.

Reprise après interruption : lire `web/.cache/luna-review-guard/status.json`,
`run.log`, puis `data/model_outputs/luna-blind-review-20260925-01/`. Ne rien
relancer automatiquement et ne jamais écraser un résultat. Si le fichier
`summary.json` manque, inspecter les preuves reçues et noter tout coût inconnu.

Commande reproductible (sans surveillant à elle seule) :

```sh
make web-luna-review BENCHMARK_OUTPUT=data/model_outputs/luna-review-NOUVEAU
```

## Résultats

L'appel s'est terminé en **73,833 s**, coût déclaré **0.00533855 USD**, sans reprise.
Provenance Generation : OpenAI, `openai/gpt-6-luna-20260922`.
21 861 tokens entrée ; 5212 sortie dont 4405 de raisonnement. Aucun appel outil
web déclaré. Le processus surveillé a terminé normalement et aucun autre appel
n'est prévu. Les références religieuses ne sont pas certifiées par ce test.

### Détection aveugle des points connus

| Point fixé avant réception | Détecté | Correction proposée |
| --- | --- | --- |
| ID 365, « sur les propos » devenu « du cheikh » | Non | Aucune |
| ID 253, citation complétée | Oui | Enlève l'ajout, mais remplace par « dans le flanc de Dieu », formulation très littérale à valider |
| IDs 347–348, déplacement de texte | Non | Aucune |
| ID 151, « contester » trop fort (réserve) | Oui | Détection pertinente, mais raccord grammatical dégradé avec ID 152 |
| ID 144, explicitation contextuelle (réserve) | Non | Aucune |

Donc **2 des 5 points suivis signalés**, dont l'un était une réserve de registre.
Parmi les trois défauts plus nets (attribution, citation développée, déplacement),
un seul est repéré. Ce petit échantillon sélectionné n'est pas un taux de rappel
statistique généralisable. Le réviseur n'a reçu aucune liste d'erreurs attendues.

### Autres alertes et risques

Dix entrées proposées au total, toutes annoncées « high » par le modèle, y compris
les suggestions problématiques. Les niveaux de confiance auto-déclarés ne suffisent
pas à décider une application automatique.

- ID 293 : distingue utilement « il est attesté à leur sujet » de « ils ont rapporté ».
- IDs 295, 298, 306 : propose « présence » à la place de « proximité » pour maiyya,
  évitant une connotation spatiale. Trois occurrences d'une même question terminologique.
- ID 221 : « traiter/aborder » plutôt que « comprendre », précision plausible,
  sans contresens net établi dans la version de départ.
- ID 203 : veut corriger « ailleurs sur cette terre » présent en **204**, mais
  copie le contenu de 204 dans 203 et ne corrige pas 204. **Nouvelle répétition**
  si les suggestions sont appliquées telles quelles.
- ID 151 : finit par « le fait que », immédiatement suivi en 152 de « cette parole
  d'Allah ». La phrase devient mal construite. Détecter une faiblesse n'assure
  pas que le correctif proposé soit bon dans son contexte adjacent.
- ID 307 : autre vocabulaire possible, sans modifier l'occurrence similaire en
  297 ; pas de gain de fidélité certain établi.
- ID 388 : remplace quatre lectures par quatorze ajoutées aux dix. La source est
  déjà ambiguë ; sans retour à l'audio ou source vérifiée, pas de correction certaine.

### Contrat de sortie

JSON analysable, dix IDs existants sans doublon, tous les champs `before` identiques
à l'entrée. Mais **contrat non conforme** : le modèle utilise `justification` au
lieu de `explanation`, et `high` au lieu des valeurs de confiance demandées.
Le validateur refuse la réponse. Les observations ci-dessus sont une lecture
**diagnostique**, pas un lot de corrections accepté. Pas de renommage silencieux,
aucune correction appliquée au corpus ou à l'application.

### Coût et conclusion

La traduction initiale validée avait coûté **0.008144895 USD**, reprises comprises.
Avec cette tentative de relecture : **0.013483445 USD** pour 15 min 40,7 s,
soit **0.0516 USD/h** par extrapolation linéaire.
La relecture ajoute environ **66 %** au coût de traduction, tout en restant faible
en valeur absolue. Ce n'est **pas le coût d'une traduction intégralement corrigée**,
puisque des erreurs restent et que le lot est refusé. Hors ASR, correction arabe,
export et hébergement. Coûts API déclarés, pas une facture indépendante.

**L'hypothèse est partiellement confirmée :** le même modèle peut repérer des
problèmes de sa première traduction à faible coût. **Deux passes ne suffisent pas
à garantir leur résolution** : certains problèmes nets sont manqués et certains
correctifs introduisent des régressions. Une seconde passe paraît utile comme
révision ciblée, à condition de valider le format et les raccords, de distinguer
corrections établies et incertitudes, puis de tester sur un texte inédit. Aucun
classement définitif face à Gemini : pas de corpus indépendant ni de juge humain.

[Mesures, propositions et appréciations](../web/review/luna-comparison/second-pass-results-20260925.json).
Treize tests du runner (dont intégrité des références de correction) et deux tests
de parité des prompts passent. Aucun déploiement ni modèle applicatif changé.
