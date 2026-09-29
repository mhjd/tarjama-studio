# Nouvelle campagne : phrases et mots isolés aux deux extrémités

Autorisation : le propriétaire accepte les coupures de phrase et demande surtout
une taille de bloc raisonnable, sans le premier **ou dernier** mot de la phrase
isolé sur un autre écran. Cela remplace le rejet absolu d'une nouvelle coupure
du protocole précédent. Les échecs A/B restent conservés, pas réinterprétés comme
des réussites. Aucun changement de l'application ni déploiement dans cet essai.

## Hypothèse S1, révisée avant toute mesure selon la précision du propriétaire

L'esquisse initiale comptait surtout les fragments d'un mot. Le propriétaire a
précisé avant toute exécution que ce serait trop littéral : il préfère une
phrase entière, sinon une articulation naturelle, sinon une coupure équilibrée.
L'esquisse est remplacée par le mécanisme ci-dessous ; aucun résultat n'a servi
à faire ce changement.

Repérer les phrases sur le texte français complet avec ICU, locale
`fr@ss=standard` (abréviations françaises standard, pas une liste du projet).
Mesurer les intersections de chaque phrase avec chaque sous-titre. Les morceaux
isolés d'un ou deux mots deviennent une conséquence mesurable de la répartition,
pas la fonction à optimiser directement. Une phrase entière brève n'est pas
intrinsèquement un mauvais sous-titre.

Choisir globalement une partition admissible, priorités lexicographiques :

1. exceptions d'entrée ;
2. nombre de frontières de sous-titres à l'intérieur d'une phrase ;
3. parmi ces coupures, celles sans virgule, point-virgule, deux-points ou tiret
   d'incise à la frontière ;
4. coupures après un mot grammatical suspendu selon la petite heuristique
   française existante (aucun enrichissement propre à cette vidéo) ;
5. déséquilibre entre les morceaux d'une même phrase : somme des carrés des
   fractions de mots de chaque morceau ; à nombre de coupures égal, cette somme
   est minimale pour des morceaux de tailles proches ;
6. nombre total de sous-titres, puis somme des carrés de leurs tailles pour ne
   pas multiplier les petites phrases sur des écrans distincts sans raison ;
7. groupes au-dessus de 17 caractères/s, puis somme des pauses internes.

Une phrase n'est gardée entière que si les frontières des segments existants le
permettent et si elle tient dans les limites. Les sous-titres peuvent contenir
plusieurs phrases courtes entières. Pour une phrase longue, la ponctuation est
préférée à l'équilibre arithmétique ; ce dernier n'est qu'un départage. Ne pas
interpréter une virgule comme preuve certaine de frontière syntaxique. Il s'agit
pour l'instant d'une approche consciente des phrases/ponctuations, pas d'un
parseur complet des propositions grammaticales.

Plafonds inchangés : 7 s, deux lignes de 42 caractères, largeur réelle taille
Gros, 21 caractères/s. Entrées déjà hors limites conservées et signalées.
Aucun texte réécrit, déplacé ou réhorodaté au mot. Un début « … . Un » coincé
au sein d'un segment long peut rester impossible à rattacher en sept secondes.
Absence de diarisation : pas de garantie pour des changements d'orateur.

## Données et décision

Développement : Sirat et tests synthétiques, tous les anciens exemples restent
en développement. Réserve finale : conférence Dedew `hM_hCQ6RUcc` de 384 segments,
français archivé non ouvert lors des campagnes de regroupement précédentes.
Contrôle additionnel partiellement exposé : reportage France 24 `gbrDbQVYDuQ`,
28 segments. Empreintes et provenance du protocole précédent conservées.
Ce n'est pas une preuve sur deux conférences réservées : cette limite restera
explicite, même en cas de gain sur Dedew.

Comparer paires déployées, prototype livré, S1 sur chaque jeu entier. Mesurer
les tailles moyenne/médiane, histogramme 1–3/4–9/10–16/17+ mots, temps d'écran
de ces catégories, coupures internes, articulations ponctuées, répartition des morceaux de phrase,
fragments d'un mot aux trois positions (diagnostic secondaire), durée/vitesse,
anticipation et exceptions. La qualité de traduction n'est pas réévaluée.
Pour éviter un jugement uniquement circulaire, relire tous les nouveaux et
anciens fragments d'un mot avec leurs phrases complètes et toutes les frontières
modifiées, en indiquant ce qui a réellement été inspecté.

Sélection S1 seulement si les invariants passent et si, sur Sirat, elle diminue
les coupures internes par rapport aux paires sans augmenter les coupures non
ponctuées ni les écrans de 1–3 mots. La dernière condition protège la taille
moyenne souhaitée ; les phrases brèves complètes sont aussi distinguées dans le
rapport. Lire les compromis sans rejeter une coupure simplement parce qu'elle
existe. Geler code et hypothèse avant d'exécuter la réserve une fois. Vérifier
les mêmes critères sur Dedew. Un contrôle court sans groupes admissibles ne
prouve ni gain ni échec. Si la réserve révèle un échec, ne pas ajuster sur elle.

Au plus deux variantes de développement, hypothèse de la seconde écrite avant
son essai si nécessaire. Budget fournisseur zéro ; aucun nouveau modèle ni
traduction. Au plus trente minutes de calcul, pas de rendu vidéo d'une heure.
Rendus courts/captures autorisés sur les copies existantes si utiles. Résultats
dans un nouveau répertoire exclusif ; aucune preuve précédente écrasée.

## Références avant essai

- Karakanta et al., *Point Break* (2020),
  https://aclanthology.org/2020.clicit-1.27/ : segmentation apprise avec données
  de qualité hétérogène, pas un algorithme directement validé pour nos frontières
  indivisibles ni un modèle français immédiatement qualifié. Motive de traiter
  la segmentation comme tâche distincte de la traduction.
- Karakanta et al., évaluation (2022),
  https://aclanthology.org/2022.lrec-1.328/ : séparer qualité du texte et qualité
  de segmentation ; plusieurs métriques peuvent classer différemment des sorties
  proches. Pas de score Sigma revendiqué sans segmentation humaine de référence.
- ICU, https://unicode-org.github.io/icu/userguide/boundaryanalysis/ : frontières
  de phrases et filtrage standard des abréviations ; pas d'analyse sémantique.
- Unicode UAX29, https://www.unicode.org/reports/tr29/#Sentence_Boundaries :
  ambiguïtés des points, citations, abréviations ; erreurs possibles malgré les
  règles standard. Aucun parseur grammatical complet ajouté par cette expérience.
- Les limites visuelles et temporelles restent celles documentées dans
  `docs/SUBTITLE_CONFERENCE_RESEARCH_20260929.md` (TED, Netflix, DCMP).

Cette proposition est une adaptation explicite de ces principes, pas une règle
scientifiquement démontrée optimale. Les nouveaux critères répondent au besoin
précisé par le propriétaire avant les essais, pas à une observation de la réserve.
