# Erreurs de traduction et frontières des blocs — 25 septembre 2026

## Conclusion

L’hypothèse d’un effet de bord est plausible pour certains incidents, mais ne
suffit pas à expliquer les exemples recensés. Deux réserves sémantiques de GPT-6
Luna medium sont situées loin des frontières. Une troisième apparaît près du
début d’une moitié de bloc et mérite un test contrôlé de contexte.

Cette analyse relit les requêtes, entrées et réponses archivées : aucun nouvel
appel payant, aucune lecture de secret, aucun changement applicatif ou déploiement.
Les [mesures et empreintes](../web/review/luna-comparison/boundary-audit-20260925.json)
permettent de retrouver les fichiers exacts. Les originaux sont inchangés.

## Méthode

Positions comptées dans le tableau cible réellement envoyé, à partir de 1 : les
IDs ont des trous et ne sont pas des numéros de position. Vérification que le
contenu `segments` de chaque requête correspond à son `input.json`. Distance
temporelle = minimum entre début du segment moins début du bloc et fin du bloc
moins fin du segment. Le contexte externe n’entre pas dans ce calcul.

Les requêtes découpées contiennent bien `context_only` : deux segments avant et
deux après quand ils existent. Aux extrémités de la vidéo, seul le côté disponible
est fourni. Les passages précédents et suivants à l’intérieur du bloc sont déjà
visibles dans le tableau à traduire. Disponibilité ne prouve pas utilisation par
le modèle, et deux segments ne garantissent pas tout le contexte discursif.

## Exemples GPT-6 medium

| Observation | Position dans la requête | Bord le plus proche | Lecture |
| --- | --- | --- | --- |
| ID 365 : précision « sur les propos du cheikh » rendue par remarque « du cheikh » | 58/96, bloc 4 | 38 segments après, 101,84 s avant la fin | Réserve d’attribution au milieu du bloc ; pas de coupure immédiate. |
| ID 253 : ajout « ce qu’ils ont négligé » dans un fragment de citation | 61/96, bloc 3 | 35 segments après, 88,24 s avant la fin | Développement de citation au milieu du bloc, pas une frontière proche. Cela ne démontre pas une interprétation religieuse fausse, mais dépasse le fragment fourni. |
| ID 151 : « contester » au lieu de « soulever une difficulté » | 7/48, deuxième moitié de la reprise | 6 segments avant, 12,08 s après le début | Proche du début ; effet de contexte possible, non établi. |
| ID 144 : ajout explicite « chercher à le comprendre » | 48/48, première moitié de la reprise | Dernier segment | Bien à la frontière, mais le segment précédent parle déjà de comprendre ; l’explicitation n’est pas un contresens certain. |
| IDs 347–348 : verbe déplacé entre deux sous-titres | 40–41/96, bloc 4 | 126,88–129,28 s du début | Frontière entre sous-titres internes, pas entre appels au modèle. |

Les deux premières réserves proviennent de blocs dont le JSON a été validé.
La seconde moitié de reprise (ID 151) a également été validée. Validité JSON et
qualité sémantique sont deux contrôles distincts.

## Le cas « contester » comparé avant/après découpage

Dans le bloc de 96, ID 151 est en position 55, à 86,14 s de la fin. Deux appels
medium aux mêmes frontières donnent respectivement « objecter au Prophète » et
« qui aurait soulevé une difficulté auprès du Prophète ». Les deux réponses
entières sont invalides au niveau JSON ; ces formulations sont lisibles dans les
réponses brutes et servent seulement à l’analyse linguistique.

Après division, le bloc valide de 48 commence à ID 145 ; ID 151 devient le
septième et donne « contester devant le Prophète ». Il reçoit encore IDs 143 et
144 en contexte externe, les six segments 145–150 avant la cible, puis la suite
152–192. La phrase commence à ID 150, présent, et se poursuit à ID 152, présent.
La coupure ne l’a donc pas privée de son début et de sa fin immédiats.

Le changement de contexte peut jouer. Mais les deux appels aux frontières
identiques varient déjà entre « objecter » et « soulever une difficulté » : un
seul essai avant/après ne sépare pas effet du découpage et variation du modèle.
« Contester » reste ici un durcissement possible, pas une inversion certaine.

## Défauts de format et d’alignement

- Sans raisonnement, le bloc 1 finit sur l’ID 95 avec le texte correspondant à
  l’ID 96, absent de la sortie. C’est bien un incident au bord : positions 95–96
  sur 96. Le modèle avait pourtant reçu les IDs 97–98 en contexte après le bloc.
  Le même bloc à medium conserve ensuite les IDs 95 et 96 correctement.
- À medium, le bloc 2 invalide inclut aussi les IDs 193–194, destinés uniquement
  au contexte après la cible 97–192 : confusion entre contexte et cible, au bord.
- Les clés JSON mal formées ne sont pas toutes aux bords : ID 147 à medium est
  en position 51/96 ; sans raisonnement, ID 151 est en 55/96 et ID 226 en 34/96.
  Un défaut de syntaxe JSON ne se confond pas avec un contresens linguistique.
- Le changement de référent « ton savoir » dans l’ancien appel sans raisonnement
  touche ID 332 en position 318/384, à 163,4 s de la fin du corpus entier. Ce
  passage n’était pas près d’une coupure de bloc et tout le corpus était fourni.

## Limites et prochain contrôle pertinent

Ce sont des cas sélectionnés parce qu’ils avaient été signalés, pas un inventaire
exhaustif de toutes les erreurs. On ne peut pas calculer un taux d’erreur près des
bords ni affirmer une concentration statistique à partir de cette sélection.
L’absence de proximité d’une coupure exclut seulement un manque de contexte
immédiat créé par cette coupure ; elle n’exclut pas un besoin de contexte plus large
ou une mauvaise exploitation d’un contexte effectivement présent.

Pour isoler l’effet, garder modèle, API, raisonnement, prompt et passages évalués
identiques, déplacer les frontières pour placer chaque passage alternativement
au bord et au centre, puis répéter les appels. Tester séparément l’élargissement
du contexte externe. Évaluer le sens et l’alignement indépendamment du JSON.
Ces expériences ne sont pas exécutées par cet audit. Aucun changement de la
limite applicative de dix minutes n’est justifié par ce seul examen.
