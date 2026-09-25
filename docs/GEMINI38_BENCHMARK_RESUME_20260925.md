# Gemini 3.8 Flash : reprise sûre du benchmark

Demande utilisateur : essayer Gemini 3.8 Flash après GLM, puis protéger le coût
API contre une interruption brutale de la session Codex.

Modifications locales : modèle explicitement disponible dans le runner, plafond
sortie configurable (4 USD/M pour le tarif 3,75 USD/M observé ; défaut 3 inchangé).
Douze tests runner + deux tests prompts passent. Aucun modèle applicatif changé.

Essai prévu : `google/gemini-3.8-flash`, high, fournisseur imposé google-ai-studio,
JSON simple et validation locale stricte, 4 minutes, résumé cumulatif et 5 lignes
bilingues précédentes. Même protocole que le dernier essai Z.AI. 384 segments,
quatre appels maximum, aucun retry automatique, arrêt au premier bloc invalide,
300 secondes maximum par appel, sortie bornée à 32768 tokens incluant raisonnement.
Outils Parallel bornés par le runner. Le seuil inter-appels de 2 USD reste un
contrôle a posteriori, pas un plafond de facturation garanti pour un appel en vol.

Le script `web/.cache/gemini38-guard/supervise.py` lance le benchmark dans un groupe
de processus distinct et le termine si le fichier `lease` du même dossier n'a
pas été renouvelé par l'agent depuis 60 secondes. Le script ne renouvelle jamais
lui-même ce fichier. Arrêt global après 1200 secondes, aucune relance. Un appel
déjà accepté par le fournisseur peut rester facturé malgré la déconnexion.

Avant toute reprise : lire `web/.cache/gemini38-guard/status.json`, `run.log` et
les artefacts `data/model_outputs/gemini38-high-4min-continuity-20260925-01/`.
Ne pas relancer le script automatiquement, ne pas toucher la clé, ne jamais
écraser les réponses. Si terminé, analyser ce qui existe. Si coupé, documenter
l'appel en vol comme coût inconnu et ne pas prétendre qu'il était gratuit.
Les résumés, requêtes et réponses sont enregistrés au fil de l'eau, même si
`results.json` final n'a pas pu être écrit.

Terminé normalement : quatre blocs valides, coût déclaré 0,30602625 USD. Aucun
appel restant. Voir [le bilan](GEMINI38_CONTINUITY_BENCHMARK_20260925.md).
