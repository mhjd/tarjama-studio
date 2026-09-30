# Affichage des références — investigation du 30 septembre 2026

Suite autorisée et qualifiée : voir [l’activation du prompt](INLINE_REFERENCES_RELEASE_20260930.md). Le constat ci-dessous décrit la version précédente.

Demande du propriétaire : une référence courte dans le sous-titre, entre
parenthèses, choisie par le modèle, plutôt qu'un panneau supplémentaire.
Cette note distingue l'état actuel de la proposition. Aucun prompt, appel IA,
texte utilisateur ou affichage de référence n'est modifié par la livraison S1.

## État vérifié dans le code

- Le worker charge le corpus local configuré dans `REFERENCE_CORPUS_DIR` et
  expose `quran_fr`, `sahih_ar`, `hadith_ar` au runner OpenRouter.
- `tool_choice: auto` laisse le modèle décider de ses appels. Le prompt demande
  les outils pour les citations reconnues, mais le moteur ne garantit pas leur
  utilisation pour chaque citation. La boucle est bornée : huit appels locaux,
  six tours au plus et délai global de cinq minutes ; la finalisation peut
  intervenir plus tôt. Les recherches générales restent confiées à Parallel.
- Le résultat JSON validé ne contient que `segments[{id,text}]`. Une référence
  lisible peut déjà figurer dans `text` : le format ne l'interdit pas.
- Le prompt commun demande de conserver les références prononcées et interdit
  les numéros inventés. Il ne demande pas explicitement d'ajouter une parenthèse
  à chaque citation identifiée par l'outil. L'absence de parenthèse ne prouve
  donc pas l'absence d'appel.
- Les appels et résultats locaux sont dans `TextResult.Grounding`, sauvegardé
  avec les morceaux terminés. Le journal des tentatives conserve seulement des
  compteurs/métadonnées autorisés, pas les textes ni les arguments des outils.
  Il n'existe pas d'association structurée source ↔ segment dans l'interface.
- Le texte de `Editor.tsx` disant que la vérification automatique « n'est pas
  activée » est trop général depuis l'activation du corpus : des consultations
  sont possibles, sans certification automatique de toutes les citations.
- Le regroupement export utilise une traduction enregistrée : il ne relance
  ni modèle ni recherche. Les vidéos S1 partagées ne sont pas une qualification
  des outils de références. Les anciens textes ne sont pas enrichis rétroactivement.

Le test fournisseur du 25 septembre prouve la capacité d'appeler les trois
outils et d'en recevoir les résultats. Il les demandait explicitement : il ne
prouve pas leur utilisation spontanée sur Sirat. Aucun nouvel appel facturé ni
lecture de données privées de production n'a été nécessaire à cette investigation.

## Proposition minimale

Conserver le schéma `segments[{id,text}]` et demander au modèle d'insérer la
référence directement dans le texte français. C'est suffisant pour qu'elle
apparaisse dans la relecture, le SRT et le MP4, sans panneau ni nouveau modèle
éditeur. Le propriétaire peut la corriger comme le reste du sous-titre.

Instruction proposée pour le prompt commun desktop/web :

> Lorsqu'une citation est identifiée précisément grâce au résultat d'un outil
> local, ajoute une référence courte entre parenthèses à la fin du passage cité,
> une seule fois, dans son dernier segment : `(sourate 2, verset 255)` ou
> `(Bukhari, n° 1)`. Pour une plage ou une variante, conserve exactement les
> bornes et suffixes retournés. N'ajoute pas une seconde référence si elle est
> déjà donnée dans le texte. Ne complète pas une attribution incertaine et
> n'attribue pas une simple paraphrase sur la base d'une ressemblance de sens.
> N'ajoute ni URL ni commentaire de recherche dans les sous-titres.

Ces exemples décrivent le format, pas une attribution à un passage de Sirat.
Le modèle choisit où la citation se termine. Les temps ne sont pas modifiés.
Le regroupement tient naturellement compte des caractères ajoutés ; une
parenthèse peut donc rendre un groupe trop long et entraîner une autre coupure.
Ne pas ajouter un sous-titre ou du temps artificiellement pour la référence.

L'ancien avertissement pourrait devenir : « Les références identifiées sont
indiquées dans les sous-titres. Leur absence ne signifie pas qu'un passage ne
contient aucune citation. » À activer seulement après qualification du nouveau
comportement ; ne pas promettre des références déjà présentes dans les anciens projets.

## Qualification avant une prochaine activation

Vérifier une citation exacte, une citation sur plusieurs segments, une paraphrase,
une variante de hadith ambiguë et une recherche sans résultat. Contrôler les
appels réellement exécutés, l'accord avec le résultat de l'outil, l'absence de
doublons, de numéros inventés et de texte supplémentaire non prononcé hors référence.
Inclure une relecture et un export réel pour vérifier que les parenthèses sont
lisibles et restent modifiables. Synchroniser le prompt commun et sa version web.

Une instruction seule ne garantit pas l'exactitude des attributions ni l'appel
systématique des outils. Si les essais montrent des références inventées malgré
la consigne, ajouter ensuite une association structurée aux résultats réellement
retournés et une validation serveur, plutôt qu'un détecteur fragile de parenthèses.
Cela serait une évolution distincte : consulter un outil ne certifie toujours
pas la correspondance sémantique avec les paroles du conférencier.

## Exemple dans la copie Sirat fournie

La copie `segments.json` fournie par l'administrateur (966 segments, version 6)
contient à 07:03.720 : « Et dans un autre verset : “Ne tuez pas vos enfants pour
cause de pauvreté.” » sans numéro de sourate/verset. Cela confirme le manque
visible dans ce texte enregistré, mais ne permet pas de déduire si un outil a
été utilisé lors de sa génération. L'export ne peut pas compléter ce numéro
par simple regroupement ; il faudrait une identification vérifiée, distincte
et explicite, sans relancer toute la traduction silencieusement.

Après déploiement S1, le nouveau worker a confirmé le 30 septembre à 10:49 UTC
`Local reference corpus loaded: tools=3`. Ceci confirme la disponibilité du
corpus dans la version active, sans prouver un appel sur une citation donnée.
