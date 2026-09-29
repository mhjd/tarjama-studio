# Regroupement pour les conférences : recherche et proposition

Date : 29 septembre 2026. **Proposition non intégrée à l'application, aucun
déploiement ni appel IA.** Le propriétaire a ensuite autorisé un
[export d'essai hors application](../web/review/conference-grouping-20260929/README.md)
sur une copie administrateur. La règle active
reste celle de [EXPORT_PAIR_GROUPING_20260929.md](EXPORT_PAIR_GROUPING_20260929.md).

## Besoin et contraintes

Le propriétaire préfère une méthode fondée sur les conventions professionnelles
et les travaux scientifiques plutôt que des seuils ajustés après chaque exemple.
Le contenu est une conférence arabe traduite en français. Les segments ont un
début et une fin ; les mots français n'ont pas d'horodatage individuel fiable.
L'export doit conserver intégralement les textes corrigés et la taille Gros.

Précision du propriétaire après la recherche : le but n'est pas seulement de
supprimer les fragments très brefs. Il faut aussi éviter de laisser quelques
mots seuls pendant une pause au milieu d'une phrase. Une limite temporelle et
un plafond de vitesse ne détectent pas cette faible densité. Une pause ne doit
donc pas être assimilée automatiquement à une frontière de sens.

Il faut distinguer trois objets : le regroupement temporel de plusieurs segments,
la coupure typographique entre deux lignes d'un même sous-titre et la traduction.
Une étude de coupure entre lignes ne prouve pas directement qu'une fusion
temporelle particulière améliorera la compréhension.

## Sources primaires consultées

### TED : conférences traduites

[Subtitling Tips](https://www.ted.com/participate/translate/subtitling-tips)
demande de passer sur deux lignes au-delà de 42 caractères, de ne pas dépasser
deux lignes, de conserver les unités linguistiques et de respecter un plafond
de 21 caractères/seconde. C'est la référence de genre la plus directe parmi les
guides consultés. Aucun objectif de 20 mots n'y est prescrit. La condensation
éditoriale proposée par TED pour les passages trop rapides ne sera pas appliquée
automatiquement aux textes validés de Tarjama.

### Netflix : spécificité française et durée

[French (France), sections I.4, I.9, I.14, I.19](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217351577-French-France-Timed-Text-Style-Guide)
fixe 42 caractères par ligne, deux lignes et 17 caractères/seconde pour les
sous-titres traduits de programmes adultes. Le plafond SDH, différent, ne doit
pas être confondu avec celui-ci. La taille doit aussi permettre l'affichage dans
la largeur disponible.

[General Requirements](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617-Timed-Text-Style-Guide-General-Requirements)
donne une durée de 5/6 seconde à 7 secondes et des principes de coupure entre
lignes respectant les groupes grammaticaux. Ce sont des spécifications de
livraison, pas la démonstration d'un optimum universel pour nos conférences.

### DCMP : médias pédagogiques et accessibilité

[Captioning Key](https://dcmp.org/captioningkey/print), rubriques Text et
Presentation Rate : préférence pour deux lignes, durée maximale de 6 secondes,
et jusqu'à 160 mots/minute pour les contenus éducatifs de niveau supérieur.
Le guide insiste sur la préservation du sens et du vocabulaire essentiel,
particulièrement lorsque les notions sont nouvelles. Ce contexte principalement
anglophone et d'accessibilité ne permet pas de convertir 160 mots/minute en une
limite universelle de caractères français. Il confirme surtout qu'une conférence
ne justifie pas de remplir davantage chaque écran. À ce débit, 20 mots demandent
7,5 secondes (calcul), déjà plus que les durées maximales des deux guides.

### Études : résultats et portée

- [Karakanta, Negri et Turchi, IWSLT 2020, Is 42 the Answer to Everything in
  Subtitling-oriented Speech Translation?](https://aclanthology.org/2020.iwslt-1.26/)
  étudie la traduction pour le sous-titrage à partir de conférences TED. Les
  résultats soulignent l'apport des informations acoustiques, notamment les
  pauses, pour la segmentation. La longueur seule ne suffit pas. Ce travail ne
  valide pas notre futur algorithme de fusion à horaires fixes.
- [Gerber-Morón, Szarkowska et Woll, The impact of text segmentation on subtitle
  reading](https://pmc.ncbi.nlm.nih.gov/articles/PMC7901653/) compare les coupures
  syntaxiques et non syntaxiques **dans un même sous-titre**. L'effort subjectif
  est plus élevé avec les coupures non syntaxiques ; il ne faut pas présenter
  cela comme une amélioration systématique démontrée des scores de compréhension,
  ni comme une preuve sur la fusion de sous-titres successifs.
- [Chan, Kruger et Doherty, 2022](https://www.jostrans.org/article/view/7984)
  étudie 70 étudiants chinois et cinq extraits de cours de microéconomie. Les
  sous-titres en langue première améliorent la performance dans cette étude.
  Les stimuli anglais sont sous 16 caractères/seconde, en moyenne autour de 10,
  avec un orateur lent. Le protocole compare des conditions linguistiques, pas
  plusieurs tailles de groupes : ces chiffres ne prouvent pas un seuil optimal.
- [The Impact of Lecture Style, Language and Subtitles on the Processing and
  Effectiveness of EMI Lectures, 2026](https://link.springer.com/article/10.1007/s10758-026-10000-z)
  porte sur des conférences de philosophie avec un orateur à l'écran ou des
  diapositives commentées. Il montre l'importance du contexte et du niveau
  linguistique ; aucun nombre optimal de mots pour nos vidéos ne peut en être
  déduit. Les résultats de compréhension ne sont pas uniformes entre études.

## Vérification du code actuel et du cas signalé

`automaticExportCues` ne fusionne que deux voisins originaux, chacun de moins de
10 mots. La limite de 84 caractères porte sur le total et ne contrôle pas
réellement deux lignes. L'ASS confie les retours à la ligne au moteur de rendu.
La vitesse maximale de fusion est de 17 caractères/seconde, la durée de 7 secondes
et l'écart maximal de 500 ms. Le seuil d'écart est un choix technique existant,
pas une constante scientifique établie.

Transcription manuelle de la capture, sans lecture du projet en production :

| Groupe | Mots | Caractères, espaces et ponctuation inclus |
| --- | ---: | ---: |
| il le choyait et le gardait à la maison. Un | 10 | 43 |
| même texte suivi de « jour, » | 11 | 49 |
| même texte suivi de « jour, son père fut occupé » | 15 | 69 |

Le premier segment est donc exclu de toute fusion par le seuil strict de 10 mots.
Les trois réunis demandent au moins 4,06 s à 17 caractères/s, ou 3,29 s à 21.
Le début du premier n'est pas visible : la capture seule ne permet pas de
confirmer leur admissibilité temporelle ou leur rendu en deux lignes.

## Proposition adaptée, à distinguer des normes citées

1. Retirer les seuils de mots et la limitation à deux segments. Énumérer les
   groupes de segments entiers contigus permis par les horaires et la longueur.
2. Choisir la partition en considérant les groupes suivants, plutôt que remplir
   un premier groupe au maximum au risque de laisser un mot isolé ensuite.
   Une recherche de partition par programmation dynamique est une technique
   algorithmique classique ; elle ne constitue pas à elle seule une validation
   scientifique des critères de confort utilisés.
3. Utiliser les conventions TED pour les conférences et le repère français :
   deux lignes au maximum, au plus 42 caractères par ligne, préférence pour
   17 caractères/seconde ou moins. Le plafond TED de 21 peut servir de tolérance
   documentée pour les passages rapides sans solution à 17, pas de vitesse à
   atteindre. Retenir 7 secondes comme plafond issu du guide général Netflix ;
   ce choix est une adaptation, pas une exigence TED ni DCMP.
4. Favoriser les fins de phrases et groupes de sens aux frontières déjà connues.
   Une phrase courte complète n'a pas à être remplie. Un fragment inachevé et
   peu dense doit inciter à examiner une fusion, y compris à travers une pause
   interne à la phrase, sous réserve des limites du groupe complet. Ne pas
   conserver automatiquement le veto actuel de 500 ms comme s'il s'agissait
   d'une norme : il peut justement empêcher cette amélioration. La pause est
   un indice de frontière et un coût d'anticipation, pas toujours une interdiction.
   Un changement d'orateur identifié reste une séparation. Un écart entre
   segments n'est pas la preuve d'un silence acoustique : aucune détection de
   silence, de fin d'idée ou de locuteur n'est garantie ici. La détermination
   automatique d'une frontière linguistique reste une partie à qualifier.
5. Conserver le début du premier segment et la fin du dernier, sans déplacer,
   supprimer ou réécrire les mots validés. Cela conserve les bornes externes,
   mais rend les mots des segments suivants visibles plus tôt dans le groupe :
   ne pas appeler cela une synchronisation mot à mot inchangée.
6. Vérifier les deux lignes avec la police effective, la taille Gros et la
   largeur de la vidéo. 84 caractères ne garantissent pas deux lignes. Un SRT
   lu dans un logiciel tiers reste dépendant de sa police et de sa mise en page.

La vitesse est évaluée sur le **groupe complet** : ne pas arrêter l'examen des
candidats au premier préfixe trop rapide, car un groupe plus long peut redevenir
admissible. À l'inverse, longueur et durée maximales bornent la recherche.
Le regroupement ne réduit pas magiquement le débit d'un discours : sans pause,
le nombre de caractères par seconde reste essentiellement le même.

Inversement, ne pas instaurer de vitesse minimale obligatoire : une phrase
courte achevée ou un long silence peuvent légitimement produire un faible débit.
Lutter contre les fragments peu denses suppose d'évaluer les possibilités de
fusion et leur cohérence, pas de remplir systématiquement 20 mots. Si une pause
interne est longue, fusionner affiche la suite avant qu'elle soit prononcée ;
garder une synchronisation stricte impose alors d'attendre. Aucun regroupement
ne supprime simultanément cette attente et cette anticipation. Le compromis
doit être explicite et ne peut être présenté comme résolu par une norme.

Si un segment d'entrée est déjà trop long ou trop rapide et qu'aucune fusion
n'aide, le conserver intégralement et le compter comme exception dans le rapport
de contrôle. Ne pas bloquer l'export, inventer des horaires, cacher ou tronquer
le texte pour afficher artificiellement une conformité de 100 %.

## Fiabilité à établir avant mise en service

La littérature permet de choisir des critères défendables. Elle ne garantit pas
qu'un regroupement avec nos frontières imparfaites aura partout une coupure
naturelle. Un alignement forcé pourrait améliorer les horaires arabes, mais
n'établirait pas directement ceux d'une traduction française qui change l'ordre
des mots ; ce serait un chantier distinct.

La qualification doit être faite par l'agent, pas transférée au propriétaire :
conservation de tous les textes dans l'ordre, bornes temporelles, pauses et
exceptions ; mesure des durées, vitesses et lignes ; inspection de rendus courts
en Low et High avec la police de production sur plusieurs passages (pas seulement
la capture utilisée pour concevoir la règle). Ne pas prétendre qu'un test logiciel
mesure la compréhension humaine. Aucun besoin de relancer la traduction pour
qualifier le regroupement. Les cartes d'édition restent distinctes des sous-titres
regroupés des exports vidéo et SRT.
