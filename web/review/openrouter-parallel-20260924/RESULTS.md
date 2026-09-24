# Parallel via les outils serveur OpenRouter — 24 septembre 2026

Correction de `4145708` sur `web-vps`. Le propriétaire avait raison : aucun
accès Parallel séparé n’est nécessaire. Les deux outils reçoivent explicitement
`engine: parallel`, et consomment la seule clé OpenRouter déjà administrée.
Le client Parallel direct et sa dépendance de secret ont été retirés.
Aucune valeur de clé n’a été affichée ; seuls les programmes d’essai consomment
son fichier. Aucun déploiement ni changement du service actif.

## Tests déterministes

- Suite backend complète avec PostgreSQL temporaire : `go test -race -count=1`
  et `go vet` réussis (voir `go-test-final.log`).
- Contrat des deux outils, moteur explicite même pour un modèle possédant une
  recherche native, budgets, clé unique, erreurs sans corps confidentiel,
  annulation, refus de Gemini et d’outils clients inattendus.
- Provenance séparée du JSON des sous-titres ; faux grounding du modèle refusé.
- Parité du prompt métier desktop/web : deux tests réussis.
- Image de qualification reconstruite avec le code courant ; aucun import VPS.
- UI inchangée par cette correction : les 33 tests UI du lot précédent ne sont
  pas présentés comme un nouveau parcours réel de traduction.

## Premiers essais réels et résultats conservés

Tous utilisent DeepSeek V4.1 Flash, le moteur Parallel imposé et un exemple
public UNESCO, sans transcription privée ni données d’un projet existant.
Les premiers probes Python précèdent le runner final ; leurs requêtes/réponses
restent sous `data/model_outputs/`, avec empreintes dans `evidence-sha256.txt`.

| Essai | Temps | Coût retourné par OpenRouter (USD) | Constat |
| --- | ---: | ---: | --- |
| `openrouter-server-tools-20260924-01` | 14,47 s | 0,01787962 | Recherche + deuxième outil comptés ; JSON enveloppé dans Markdown, refusé par le contrat applicatif |
| `openrouter-server-tools-20260924-02` | 14,34 s | 0,01553672 | Essai streaming, JSON brut conforme après instruction explicite ; même limite de traces |
| `openrouter-server-tools-20260924-03` | 8,31 s | 0,00081008 | Fetch seul exposé, un appel exécuté ; le modèle rapporte un contenu UNESCO cohérent, mais son objet hors schéma serait refusé |

Les essais 01/02 indiquent une recherche et deux exécutions serveur. L’appel
Fetch est **inféré** du second compteur, avec seulement Search et Fetch exposés.
L’essai 03 isole Fetch : un appel de cet outil est compté, mais l’API ne renvoie
pas son résultat brut ni un statut d’extraction exploitable indépendamment du
modèle. Aucun de ces compteurs n’est une certification des pages ou citations.

Le schéma est maintenant rappelé dans les instructions en plus de
`response_format`; la validation locale stricte reste obligatoire. Les essais
mal formés sont conservés, pas remplacés par le premier succès.

## Qualification répétable

Le runner final `openrouter-parallel-20260924-04` réussit en **55,97 s** :
une recherche et quatre appels serveur exécutés (trois appels Fetch inférés),
JSON strict valide avec l’unique ID attendu. Coût API retourné : **0,0263643294 USD**,
49 255 tokens d’entrée et 446 de sortie agrégés. Cette latence et ce volume
montrent le coût possible des lectures supplémentaires, même pour un exemple court.
Ce n’est pas une estimation du coût d’une heure traduite.

[Résumé du fournisseur](qualification-summary.json) et [JSON final](qualification-answer.json).
Total des quatre essais : **0,0605907494 USD** selon les usages retournés,
sans extrapolation tarifaire ni clé dans les preuves.

 La portée est l’invocation des
outils et le contrat JSON sur cet exemple, pas une évaluation linguistique sur
20 minutes ni un parcours complet de l’application. Les futurs corpus locaux,
le panneau de remarques et la bascule du service restent distincts.

[Décisions et commandes](../../../docs/REFERENCE_TOOLS_AND_PARALLEL.md).
