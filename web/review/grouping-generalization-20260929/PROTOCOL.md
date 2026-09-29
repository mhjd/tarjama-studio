# Campagne hors ligne : protocole avant essai

Voir `docs/SUBTITLE_GROUPING_GENERALIZATION_20260929.md`. Ce répertoire ne change
ni le prototype livré ni le regroupement applicatif.

## Provenance et réserve

Le README historique identifie le corpus de 384 segments : vidéo `hM_hCQ6RUcc`,
conférence de Muhammad al-Hasan al-Dedew, distincte de Sirat `YuV8IY-Bgoc`.
Les 384 IDs arabes/français correspondent exactement ; les horaires sont valides,
sans chevauchement. Aucun texte arabe normalisé ne correspond exactement à un
segment de Sirat (contrôle de doublons, pas preuve autonome de provenance).
La réserve courte `gbrDbQVYDuQ` reste un contrôle supplémentaire ; sa nature et
son locuteur ne sont pas qualifiés comme seconde conférence indépendante.
Les textes français de réserve ne sont pas ouverts avant le gel du candidat.

Précision de provenance avant les essais : la recherche de l'URL dans les anciens
journaux UI a affiché involontairement quatre extraits du reportage court. Il
sera donc étiqueté contrôle partiellement exposé, jamais réserve entièrement
aveugle. Les documents `MOBILE_PLAYER_REVIEW_20260926.md` et
`TEN_MINUTE_UI_20260924.md` le décrivent comme reportage France 24 sur les biais
de l'IA : ce n'est pas une deuxième conférence. Le français de la conférence
Dedew reste réservé.

## Candidate A : priorité aux fragments et aux fins de phrase

Même génération de groupes admissibles et même mesure libass que le prototype.
Seule la priorité lexicographique change, dans cet ordre :

1. exceptions d'entrée ;
2. affichages de moins de 5/6 s ;
3. affichages d'un seul mot (ponctuation exclue) ;
4. fins de phrase d'entrée franchies à l'intérieur d'un groupe ;
5. coupures après mot grammatical suspendu ;
6. autres coupures non ponctuées ;
7. groupes au-dessus de 17 caractères/s ;
8. nombre de groupes ;
9. somme des pauses internes.

Hypothèse : le prototype protégeait la ponctuation des noms/confirmations avant
leur lisibilité, et évitait les fragments grammaticaux avant les changements de
phrase. Inverser ces priorités doit réduire les écrans isolés et éviter de réunir
une question avec le début de la phrase suivante. Ce traitement modifie deux
priorités ensemble : ne pas lui attribuer une cause unique.

Risque prévu : un mot qui constitue une réponse autonome, même lentement
prononcé, peut être rattaché à une phrase voisine. Compter les régressions
sémantiques et l'anticipation ; ne pas annoncer une victoire sur le compteur seul.

## Sélection en développement

Exécuter A une fois sur tout Sirat après les tests de mécanisme synthétiques.
Exiger conservation et contraintes, pas plus de sous-titres d'un mot ou fugitifs
que les deux comparateurs. Revoir toutes les frontières modifiées, en particulier
les trois gains déjà identifiés (10:24, 46:17, 46:29), les trois régressions
(15:01, 35:35, 49:21) et tous les nouveaux groupes franchissant une fin de phrase.
Les exemples connus servent uniquement au développement.

Si A échoue, ne pas ouvrir la réserve. Une variante B éventuelle doit faire
l'objet d'une hypothèse écrite avant exécution, sans modifier les contraintes
ni dépasser le plafond de deux variantes. Si A est retenue, geler ses empreintes,
puis comparer une seule fois A, prototype et paires sur les deux jeux réservés.
Une régression de réserve ne sera pas corrigée dans cette campagne.

## Ressources et preuves

Zéro API, zéro téléchargement, zéro déploiement. Pas de rendu vidéo complet.
Répertoire de résultats créé exclusivement, entrées en lecture seule, image
outils locale par ID immuable, sans réseau, 2 CPU / 1536 Mio / 128 processus,
délai 10 minutes par commande et plafond cumulé 30 minutes. Empreintes et toutes
les partitions conservées. L'identité du média court non qualifiée empêche à
elle seule de conclure à la généralisation exigée sur deux conférences.

## Développement A : constat puis hypothèse B (avant exécution B)

A : 830 écrans, 3 d'un mot, 9 fugitifs, contre 826/11/11 pour le prototype
et 827/5/12 pour les paires. Les contraintes de conservation passent. À 20:27,
elle rattache la réponse « Aux Arabes. » à « Enfin, dernier point… » plutôt
qu'à la question. La limite de vitesse de l'entrée peut aussi conduire à sauver
une exception en réunissant une phrase complète et l'amorce de la suivante
(le défaut de 35:35 n'est pas résolu). A n'est pas sélectionnée.

B conserve les mêmes groupes admissibles, sans nouvelle liste de mots ni seuil.
Sa priorité sera : affichages fugitifs, mots isolés, groupes qui traversent une
fin de phrase **et se terminent sans fin de phrase**, exceptions d'entrée, puis
les autres critères de A (fins de phrase internes, coupures grammaticales,
coupures non ponctuées, >17 cps, nombre, pauses).
L'hypothèse est de préférer une proposition fermée à une proposition fermée
suivie d'une amorce. Risque explicite : conserver davantage de segments d'entrée
trop rapides ; à mesurer et ne pas masquer. Une ponctuation mal placée peut
toujours tromper cette règle. Aucun changement des contraintes admissibles.

Les premières assertions de deux tests synthétiques décrivaient mal le prototype
(un mot long créait déjà une exception de vitesse ; une phrase en fin de corpus
n'a pas de frontière sortante). Les fixtures/assertions ont été rectifiées
avant l'essai A, sans changement de A. Les huit tests de mécanisme passent ;
trois reproduisent un échec du prototype et une réussite de A.
