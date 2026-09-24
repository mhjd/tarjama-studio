> Actualisation prioritaire du 24 septembre : prompt `translation-parallel-v3`,
> Gemini retiré, DeepSeek/OpenRouter et outils Parallel. Le prompt métier demeure
> dérivé de `prompts/translation.md`, sans sortie vide en cas de référence absente.
> Corpus locaux et remarques à implémenter ; candidat non déployé. Voir
> [les décisions actuelles](../../docs/REFERENCE_TOOLS_AND_PARALLEL.md).
> Le compte rendu ci-dessous décrit l’ancien essai v2 et reste historique.

# Prompt de traduction desktop et web

La source de vérité reste `prompts/translation.md`, déjà utilisée par
`ui/electron/library.ts` pour le prompt desktop par défaut. Aucun réglage ou
prompt personnalisé desktop existant n'est supprimé. La branche desktop et les
releases installées ne sont pas modifiées par ce travail sur web-vps.

`make web-prompts-sync` génère le prompt embarqué par Go. Le générateur conserve
chaque ligne des consignes métier, dont tout le paragraphe sur les citations.
Il adapte seulement les contraintes Markdown, les métadonnées conservées côté
serveur et les placeholders de personnalisation/entrée au contrat JSON. Un
segment JSON correspond à un bloc desktop. Pas d'abrègement des règles de style,
de Hamidullah, des variantes de hadith ou des citations traversant plusieurs IDs.

`make web-prompts-check` refuse une divergence. `make web-test` et `make web-build`
l'exécutent avant leur travail. Un test compare chaque ligne métier de la source
et refuse les changements inattendus du format desktop. Il n'est donc pas
nécessaire de maintenir manuellement deux versions du prompt.

La version des nouveaux morceaux est `translation-desktop-v2`. Les morceaux
anciens conservent leur résultat et métadonnées d'origine lors d'une reprise ;
aucun projet, texte relu ou export existant n'est recalculé silencieusement.
Le nettoyage arabe a son propre prompt et n'est pas changé dans cette correction
du prompt de **traduction**.

## Recherche réellement nécessaire

Le client candidat déclare `google_search` et `url_context` pour la traduction
Gemini. Le prompt demande uniquement la vérification des citations, pas une
recherche générale. Une version Hamidullah introuvable ne doit pas être remplacée
par une retraduction attribuée faussement à Hamidullah. Une réponse vide ou
incomplète est refusée par le validateur ; aucun résultat partiel n'est publié.

Les métadonnées de recherche reçues du fournisseur sont conservées séparément
des textes dans le checkpoint du morceau. Elles ne sont jamais copiées dans les
sous-titres. Le modèle n'a pas le droit de fabriquer ce champ dans son JSON : le
client l'ajoute depuis l'enveloppe fournisseur après validation stricte.

Déclarer un outil ne prouve pas qu'il a été utilisé, ni que chaque citation a été
vérifiée correctement. Il faut qualifier la présence des résultats de recherche,
la version française exacte, le fragment arabe, les variantes et l'alignement.
Une source renvoyée par le fournisseur reste une donnée non fiable. Aucun HTML
fournisseur n'est exécuté ou affiché par ce changement.

L'intégration d'affichage des références et Search Suggestions reste à finaliser
avant une mise en service de Grounding, suivant le résultat de la qualification
réelle. Le prompt/candidat ne doit pas être présenté comme déployé ou comme une
vérification déjà opérationnelle sur l'application publique.

## État de qualification du 23 septembre

Voir les preuves dans `web/deploy/preview/evidence/prompt-parity-20260923/` et la
recette `translation-research-20260923.yml`. Cette recette ajoute une tâche de
qualification ; elle garde les images des services en production inchangées.
La tâche n'a ni accès base, ni identité applicative, ni clé OpenRouter. Elle
utilise la clé Gemini administrée sur quatre segments publics de test.

Deux appels réels avec la clé Gemini administrée ont reçu HTTP 429, y compris
le second après ajout d'un diagnostic limité aux identifiants publics de quota.
Aucun identifiant de quota n'a été retourné par cette réponse. Il n'est donc pas
possible d'affirmer qu'il s'agit d'une limite quotidienne, d'un palier gratuit,
d'une indisponibilité transitoire ou d'une limite propre à Grounding. Aucune
traduction avec recherche n'a été validée. Aucun changement de facturation n'a
été effectué. La disponibilité de cette capacité sur le compte Gemini doit être
rétablie/confirmée avant qualification finale et activation.

La recette active antérieure a été rétablie après les essais ; les quatre
services conservent leurs images précédentes. Le nouveau prompt et les outils
restent **candidats non activés**. Aucun projet utilisateur n'a été modifié.

Tests réussis : tests Go avec détection de courses, go vet, compilation
TypeScript/Vite, huit tests UI Playwright locaux, sauvegarde/restauration
PostgreSQL synthétique, deux tests de parité du prompt. Les tests réseau refusés
ne comptent pas comme tests fonctionnels réussis.

Les six appels comparatifs antérieurs restent documentés séparément dans
`web/review/model-comparison/RESULTS-20260923.md`. Ils utilisent un prompt v1 figé
et **aucun outil web** ; ils ne constituent pas la qualification du prompt v2.
