# Références dans les sous-titres — activation du 30 septembre 2026

Le propriétaire a demandé l'activation, puis précisé que la qualification devait
utiliser un vrai bloc habituel et les fonctions de production. Source : `83c20ca`.

## Comportement livré

Prompt commun desktop/web `translation-parallel-v4-inline` : après identification
précise par un outil local, le modèle ajoute une parenthèse courte dans le dernier
segment du passage cité, une seule fois. Numéros/plages/variantes doivent provenir
des résultats ; pas d'URL, commentaire de recherche, numéro supposé ni attribution
sur une simple ressemblance de sens. Les références déjà prononcées ne sont pas
dupliquées. Le schéma reste `segments[{id,text}]` : références éditables dans la
relecture et présentes dans les exports, sans panneau supplémentaire.

Les descriptions des arguments `quran_fr` précisent les deux modes exclusifs,
le numéro du dernier verset (pas un nombre de versets), son omission pour un
verset seul et les bornes. Le validateur reste strict et refuse les requêtes
contradictoires. Le modèle conserve `tool_choice:auto` et les budgets habituels.
L'aide de la page Traduire ne prétend plus que les consultations sont désactivées.
Elle ne promet pas que tous les passages ont été identifiés.

Aucune modification de textes existants ou retraduction automatique. Les morceaux
déjà terminés conservent leur contenu et leurs métadonnées de prompt. Le prompt
commun desktop est synchronisé, mais cela ne raccorde pas son adaptateur aux
outils locaux : la qualification ici concerne le worker hébergé.

## Qualification réelle Luna

[Protocole et résultats](../web/review/inline-references-20260930/README.md),
[mesures et parenthèses produites](../web/review/inline-references-20260930/results.json).
Bruts immuables : `data/model_outputs/inline-reference-20260930-*`.

Fonctions réutilisées : `TextChunks`, `TextChunkContext` partagée avec le worker,
`HTTPProviders.Text`, runner OpenRouter, vrais outils locaux et `ValidateText`.
Pas de prompt d'essai forçant les outils, aucun numéro attendu donné à Luna,
pas de traduction française préalable transmise. L'essai ne réimplémente pas
la boucle de reprise du worker : une génération bornée, sans retries de jobs.

Production : dix minutes au plus, 300 segments et 32 000 octets arabes au plus ;
deux segments voisins de chaque côté lorsque disponibles, pas de résumé roulant.
Bloc testé : **145 segments, 00:00.680–09:57.760**, deux segments suivants en contexte.
Modèle **openai/gpt-6-luna, raisonnement medium**, corpus local `20260925-v2`.

Dernière passe : **54,31 secondes**, trois requêtes modèle, cinq appels locaux
dont un invalide corrigé, quatre résultats exacts, quatre références ajoutées :

| Passage à partir de | Référence produite |
| --- | --- |
| 00:50.040 | sourate 21, verset 107 |
| 07:00.680 | sourate 17, verset 31 |
| 07:03.720 | sourate 6, verset 151 |
| 07:42.000 | sourate 4, verset 22 |

Les quatre numéros correspondent aux résultats retournés et aux citations du
passage. Les 145 IDs sont présents, ordonnés, avec texte non vide ; les temps
restent ceux de l'entrée. Aucune attribution ajoutée sans résultat repérée.
La formulation française suit les fragments du corpus, avec ponctuation/casse
adaptées et parfois suppression du « Et » introductif ; ne pas annoncer une
reproduction typographique strictement identique.

Coût rapporté par OpenRouter : **0,004901805 USD** pour cette passe.
Les trois essais (petit diagnostic puis deux blocs complets) totalisent
**0,012881445 USD** rapporté. Les limites et défauts de la première passe restent
documentés ; aucun résultat en échec n'a été écrasé. Aucun appel fournisseur
supplémentaire effectué pendant le déploiement.

Limites : la boucle ne garantit pas que tout sera recherché. Ici, pas d'appel
hadith ; le récit de Jaafar et celui attribué à Aïcha restent sans référence.
Ce test ne prouve donc ni une couverture exhaustive des hadiths ni l'absence
de toute erreur de traduction. L'ajout de parenthèses augmente la densité des
citations courtes ; aucune durée ni synchronisation au mot n'a été inventée.

## Tests et déploiement

Tests Go des packages references/research/studio et du contexte partagé réussis.
Parité du prompt desktop/web vérifiée. Build TypeScript/Vite réussi. Onze tests
Playwright ciblés réussis : affichage/édition/rechargement d'une référence,
téléchargement SRT, export FFmpeg/MP4 réel sur média synthétique, export mobile
et navigation. Ces tests UI ne remplacent pas la qualification sémantique réelle
ci-dessus et n'appellent pas les fournisseurs.

Recette : `web/deploy/preview/active-inline-references-20260930.yml`.
Images locales importées :

- API : `preview.local/atelier/web@sha256:c4e8b8fa8f9390dbffbe8e61702263b10756a494151d5089c03c47375c815b4f`
- Worker : `preview.local/atelier/web@sha256:0873acfe4c6972e8ef3545bede144b9d3111ab3c53656d4c03263804a0eafe0e`
- Qualification : `preview.local/atelier/web@sha256:7f2d4fc37965ae9531ce135a1969de9b300395ac309fe28517786ac6b2d8288a`

Comparaison structurée : seuls ces trois images et le chemin/hash JS attendu
changent. Keycloak/thème, admin privée, egress, volumes et protections identiques.
Sauvegarde application/identité `pv-job-backup-6cd043ed` réussie avant activation.
Aucune migration, aucun re-export ou changement de projet. Preuves opérationnelles :
`web/.cache/inline-reference-release-20260930/`.

Retour arrière applicatif : `vps-preview rollback atelier --revision 53f5b3e75a7d75e1`
après vérification de la disponibilité des images précédentes. Aucune restauration
de base nécessaire pour ce changement de prompt ; le rollback ne réécrit pas
les traductions produites avec la nouvelle consigne.

Activation réussie : révision **39c36d771b5e1da9**, six services prêts sur
https://tarjama.runagen.com. Job `pv-job-preview-check-aa15194f` Succeeded : fichiers frontend
servis aux SHA256 attendus, accès anonyme aux projets refusé, tests S1 réussis.
Le worker actif confirme le chargement des trois outils locaux.
