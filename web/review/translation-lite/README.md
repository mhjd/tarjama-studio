# Qualification indépendante de Gemini 3.5 Flash-Lite

Le benchmark réutilise `HTTPProviders.Text` et le prompt serveur inchangé
`web/backend/internal/studio/prompts/translate.txt` (translation-v1), son schéma et
ses validations. Il ne lance ni worker applicatif, ni base, ni traitement média.
Il ne reçoit que la clé Gemini enregistrée. Le prompt desktop Markdown historique
n'est pas envoyé : son adaptation JSON serveur est le prompt utilisé par l'app.

- `corpus.json` provient, sans modification du texte, des 384 segments de
  `test-fixtures/windows/transcription_amelioree_gpt.json` : 15 min 40,7 s.
- `challenges.json` contient 16 cas rédigés pour examiner idiomes, négations,
  nombres, dialectes, conditionnel, citations entre segments et instruction citée.
- Chaque cas fait **un seul appel**, sans retry caché, sans GPT juge automatique,
  sans recherche de citations ni changement du prompt après observation.
- Les réponses brutes HTTP réussies, la requête avec prompt, les entrées et la
  traduction validée sont conservées dans un nouveau répertoire exclusif
  `/storage/data/model_outputs/RUN/CAS`. Aucun header/secret n'est enregistré.
- Les erreurs HTTP ne sont pas archivées en clair (identifiants possibles).

`make web-text-benchmark-image` construit l'image distincte. Importer par
`vps-preview image-import`, puis préparer avec `prepare.py` à partir de la recette
active **actuelle**, de son digest réel et d'un nouveau nom de run. Le générateur
préserve les services mais remplace les jobs déclarés ; les revoir avant
validate/plan/deploy. L'application est recréée par le moteur lors de deploy.
Exécuter explicitement `text-corpus` puis `text-challenges` via
`make web-preview-run PREVIEW_JOB=...`. Les jobs lecteurs n'ont ni clé ni réseau.

`collect.py` récupère de petites pages JSON par les jobs lecteurs administrés.
Limite observée : la rétention/sélection des anciens jobs peut empêcher les logs
d'une nouvelle page d'être visibles ; le collecteur s'arrête alors sans annoncer
une récupération complète. Ne pas relancer aveuglément : le curseur peut avoir
avancé. Les résultats complets restent sur le volume. La traduction des 16 cas
est récupérée localement ; celle du corpus est récupérée jusqu'au segment 145
(145 entrées, certains IDs sont absents dans la source).

Les résultats réels et la décision qualitative figurent dans `RESULTS-20260923.md`.
Une relance identique n'est pas garantie déterministe ; aucune précision statistique
ni équivalence à un autre modèle n'est déduite de ces deux appels.
