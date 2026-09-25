# Campagne qualité et outils de références — bilan du 25 septembre 2026

## Résultat et décision

**Outils livrés et qualifiés ; objectif de traduction publiable non atteint.**
Aucun changement de modèle/pipeline de production, aucun déploiement. Les trois
outils et 23 745 entrées sont décrits dans [LOCAL_REFERENCE_TOOLS.md](LOCAL_REFERENCE_TOOLS.md).
Le corpus français comporte une restriction d'usage non commercial et une coquille
connue en 58:7 ; ne pas confondre texte récupéré et édition certifiée.

48 réservations d'appels : **0,074581275 USD de coût confirmé**, plus **0,03 USD de
borne conservatrice** pour l'ancien HTTP non instrumenté, soit **0,104581275 USD
comptabilisés au maximum** sur les 2 USD autorisés. Aucun appel en vol, bail retiré.
Le registre privé conserve chaque réservation et règlement, y compris les erreurs.
La borne0,03 n'est pas présentée comme une facture ; voir la réconciliation plus bas.

Le filtre demandé de forte confiance conduit à arrêter les variantes spéculatives :
les mécanismes généraux testés corrigent certains passages mais laissent ou créent
des contresens. Après ces résultats, je n'attribue pas honnêtement ≥80% de confiance
aux variantes restantes de raisonnement supplémentaire, pivot ou auto-révision
aveugle dans ce plafond. Le budget restant est conservé. Cela **ne prouve pas**
qu'une solution à 0,20 €/h soit impossible ; cela signifie qu'aucune n'est qualifiée
par cette campagne. Ne pas poursuivre par tirages jusqu'à obtenir une sortie chanceuse.

Le test réservé de 28 segments est intact, non utilisé : aucun candidat n'a passé
le seuil de développement permettant sa promotion. Aucune affirmation de
performance sur données inconnues. Les évaluations sémantiques ont été faites
par l'agent sur l'arabe/français affiché ; pas d'évaluation humaine indépendante,
ni nouvelle vérification audio de la transcription. Chaque échec peut être audité.

### Prix et décisions sur les sondes

Extrapolations de la consommation API, pas une mesure sur une heure entière.
Source principale : 90 segments / 237,12 s ; strate citations : 66 segments / 158,86 s.
Conversion du 25 septembre : 1 EUR = 1,1403 USD
([OeNB](https://www.oenb.at/en/Services/Interest-Rates-and-Exchange-Rates/Euro-Reference-and-Exchange-Rates.html)).
Transcription, rendu, infrastructure, TVA et frais de recharge exclus.

| Méthode | €/h de source | Décision observée |
| --- | ---: | --- |
| Petits lots + contexte, Luna medium | 0,225 | Faux référent et mauvaise relation causale ; une reprise incluse |
| Arabe recopié + sens + français, Luna medium | 0,070 | Ne résout pas les contresens |
| Exemples de domaine + Luna high | 0,063 | Amélioration locale, relation causale encore fausse |
| Exemples + Gemini 3.1 Lite medium | 0,110 | Certaines erreurs corrigées, inversion sujet/effet ailleurs |
| Deux jets + arbitre Luna avec réécriture¹ | ≈0,150 | L'arbitre introduit omissions et contresens |
| Deux jets + choix fermé par segment¹ | ≈0,124 | Mélange casse une restriction « ne… que » |
| Deux jets + choix fermé par phrase¹ | ≈0,116 | Dépendances protégées, mauvais choix sémantique persistant |
| Deux jets + choix par phrase, juge Lite¹ | ≈0,154 | Mauvaise alternative parfois sélectionnée |
| Traduire des phrases entières, Lite medium | 0,059² | Grammaire améliorée, motif de dispute toujours faux |
| Références locales à la demande | 0,058 | Citations effectivement récupérées ; reste du texte imparfait |
| Références locales préchargées | 0,055 | Moins d'appels, pas d'amélioration globale démontrée |

¹ Prix projetés incluant LunaH3a et le coût horaire du jet DeepSeek archivé. Les
sondes d'arbitrage réutilisent ces jets, elles ne constituent pas des pipelines
complets frais et ne prouvent pas un gain causal par rapport à un contrôle frais.
² Traduction seule : alignement non lancé après le contresens, donc **pas** le
prix validé d'un pipeline de sous-titrage complet.
La fiche de préparationH5 et le prompt simplifiéH9 ont été arrêtés après échec
sur une partie de la sonde ; aucun prix complet ni score universel ne leur est attribué.

Exemples qui motivent le refus de promotion :
- `فهي مستترة فيما سوى ذلك` : le passage parle de la femme couverte hormis son
  visage ; « Il est donc dissimulé sous tout le reste » change le référent.
- `يتضارب الناس على أن هذا من الأزهر وهذا من الزيتونة` : des gens se battent à
  cause de leurs appartenances respectives ; « se disputent pour savoir si quelqu'un
  vient d'Al-Azhar ou de la Zitouna » change le motif et les protagonistes.
- `اشتهر من مذاهبهم العقدية أربعة مذاهب` : quatre écoles sont connues ; la variante
  « quatre écoles doctrinales les ont rendus célèbres » inverse la relation.
Ces diagnostics ne sont jamais fournis comme corrections cibles aux modèles testés.

La pré-récupération a diminué les requêtes modèle 9 → 5 et le temps du banc 265 → 156 s
sur une paire. Le coût diminue de 5,6 % seulement ; le modèle redemande encore des
références déjà fournies. Pas de mesure statistique de vitesse ni promesse pour
le déploiement. Les GET de provenance et les rechargements CLI font partie du temps.
En 293, la variante préchargée anticipe « ont ainsi interprété ce passage » avant
les segments qui le disent : défaut d'alignement conservé dans le rapport.

Tests : tout `go test ./...` passe ; les deux binaires Go compilent ; six tests
Python du banc, deux tests de parité de prompt, vérification des originaux figés
et des corpus réels passent. Qualification API : trois outils réellement exécutés,
deux requêtes, 0,0004249 USD (inclus au total). Aucun secret publié.

Artefacts bruts privés : `data/model_outputs/quality-20260925/`.
Résumé machine : `web/review/quality-campaign-20260925/results.json`.
Corpus privés : `data/reference_corpus/20260925-v1/` et `20260925-v2/`.
Les anciennes sorties, échecs et corpus sont conservés, pas réécrits.

## Journal prospectif et preuves de développement

Autorisation utilisateur : construire quran_fr / sahih_ar / hadith_ar, puis
expérimenter sous un budget TOTAL de **2 USD**. Cible **< 0,20 EUR par heure de
source**, coût de toutes les étapes et reprises compris. Aucun déploiement.
Travail sur web-vps. État initial : **0 USD d’appels de génération dans cette
nouvelle campagne** ; les anciens benchmarks ne sont pas refacturés.

Procédure : recherche bibliographique et expériences de praticiens ; import de
corpus autorisés avec provenance ; outils locaux exacts/ambigus/non trouvés ;
tests hors API ; petites expériences discriminantes ; sélection sur corpus de
développement connu ; évaluation finale réservée et non utilisée pour ajuster
le candidat. Critère : pas d’erreur de sens ou d’alignement manifeste ; choix
stylistiques défendables acceptés. Pas de certification religieuse sans preuves.

Ne tester que des hypothèses à forte confiance motivée (seuil subjectif demandé
≥80 %, sans prétendre à une probabilité statistiquement calibrée). Pré-enregistrer
pour chacune mécanisme, prédiction, coût anticipé et critère d’abandon. Rejeter
les doubles passes globales déjà peu efficaces, l’escalade de modèle au-delà du
prix cible, le fine-tuning sans données et les ensembles coûteux par défaut.

Créer AVANT tout appel payant un registre persistant de réservations : appel
réservé avant envoi, coût réel après réponse, réservation non libérée en cas
d’incertitude/crash. Aucun processus ne doit auto-renouveler le bail de l’agent.
Conserver au moins 0,60 USD pour validation finale et incidents ; sondes courtes
avant campagne complète. Pas de relance illimitée. Les coûts inconnus ne valent
pas zéro. Les anciens résultats sont des comparateurs, pas des données neuves.

Sources initiales à approfondir :
- https://aclanthology.org/2025.knowledgenlp-1.7/ : démonstrations de domaine et
  récupération documentaire à l’inférence ; ne prouve pas notre cas arabe/français.
- https://aclanthology.org/2026.acl-long.268/ : raffinements souvent favorables
  à la fluidité plus qu’à l’adéquation ; cohérent avec nos doubles passes.
- https://aclanthology.org/2025.findings-naacl.218/ : retour d’erreurs explicites
  pour correction, à distinguer d’une révision aveugle globale.
- https://github.com/SubtitleEdit/subtitleedit/blob/main/docs/features/auto-translate-advanced.md :
  pratique avec lots courts, contexte, synopsis et glossaire.
- https://www.reddit.com/r/LocalLLaMA/comments/1kpyrrs/ : retour de praticien
  sur contexte précédent/suivant et conservation des petits fragments ; anecdotique.
- https://www.reddit.com/r/LocalLLaMA/comments/1lklzav/ : glossaires/contexte,
  avertissements sur leurs coûts et leurs erreurs ; anecdotique.

Corpus : Tanzil arabe avec attribution et texte canonique intact ; français
Hamidullah proposé par Tanzil pour usage non commercial (ne pas interpréter la
licence du texte arabe comme une licence commerciale des traductions). Hadiths :
examiner les éditions arabes fawazahmed0/hadith-api et leur licence ; ne pas
confondre numérotation interne et référence Sunnah. Aucun scrape massif autorisé
par défaut, ni ingestion de traduction anglaise comme source de traduction.

## Protocole gelé avant les appels (25 septembre)

État de l’art : les démonstrations de domaine et leur récupération peuvent aider
(Li et al., KnowledgeNLP 2025), mais ne prouvent rien pour nos sous-titres religieux.
TEaR (NAACL 2025) motive des retours d’erreurs explicites ; nos essais précédents
montrent toutefois que l’auto-détection est le maillon faible. Tan et al. (ACL 2026)
mesurent surtout des gains de fluidité, moins d’adéquation, lors des révisions.
Subtitle Edit documente les petits lots avec contexte précédent, synopsis et glossaire.
Le retour Reddit du 18 mai 2025 conseille dix lignes avant/après : piste pratique,
pas preuve contrôlée. Ne pas adopter les autres affirmations non sourcées du fil.

Développement : corpus connu de 384 segments / 940,7 s. Comparateurs archivés,
non considérés comme un contrôle causal frais. Sondes sur les 90 premiers segments
puis extension uniquement si absence de nouvelle erreur manifeste et prix estimé
< 0,20 €/h (1 EUR = 1,1367 USD, taux utilisé dans les comparaisons précédentes).
Le coût horaire porte sur la traduction, recherches et reprises, pas transcription,
rendu vidéo ou infrastructure. Aucun crédit de cache supposé pour une économie future.

Hypothèse H1, confiance forte dans le mécanisme (pas 80 % de probabilité mesurée
d’atteindre la perfection) : lots de 24 segments maximum, contexte arabe six lignes
avant/après, IDs stables. Moins de charge d’alignement et absence de coupure sans
contexte. Même prompt métier et outils. Contre-exemple : nouveau déplacement de
sens ou nombre d’erreurs au moins équivalent sur la sonde.

H2 conditionnelle : reprendre explicitement l’arabe de chaque ligne avant son français
dans la sortie structurée. Coût supplémentaire mesurable, validation exacte, contrainte
générale contre les décalages. Aucune liste des erreurs historiques n’est donnée au
modèle. Tester sur la même sonde seulement si H1 laisse des erreurs d’alignement.

H3 conditionnelle : récupérer les citations localement avant traduction, indépendamment
de la décision d’appel du modèle, et fournir uniquement quelques candidats pertinents.
Évite les citations de mémoire et les tours supplémentaires. Candidats ambigus explicites.
Ne promouvoir que si la référence est réellement utilisée et le sens mieux préservé.
Pas de grand glossaire inventé, vote majoritaire, reverse translation ou révision
globale supplémentaire sans mécanisme discriminant : confiance insuffisante.

Réserve finale : transcription gbrDbQVYDuQ déjà issue des tests UI du projet, mais
non inspectée pour développer ce candidat : 28 segments, 138867 ms, SHA256
`e9f4b418380f3636311711855397dfc198bf4154a3331778da161d77b92197f9`.
Fichier privé immuable `data/model_outputs/quality-20260925/heldout.json`.
Elle n’est pas inédite à l’échelle de tout l’historique du projet ; son contenu est
épargné dans cette campagne. Évaluer une fois après gel du candidat, avec une
répétition prédéclarée pour vérifier la stabilité, sans adaptation sur ces résultats.

Critère : inspection arabe/français de TOUS les segments traduits, zéro contresens
manifeste, omission sémantique importante, ajout non soutenu ou déplacement de contenu
qui change la compréhension à l’écran. Noter séparément style défendable et source
ambiguë/non vérifiée à l’audio. JSON valide ne signifie pas traduction correcte.
Un résultat final négatif reste négatif ; aucune boucle de sélection sur le test.

Budget : registre persistant avec verrou et réservation pessimiste avant chaque
requête HTTP, basée sur contexte et sortie maxima du catalogue + tours serveur
(maximum deux recherches/lectures) + frais outils. Les sorties ne sont pas
artificiellement plafonnées pour améliorer le prix. Aucun retry automatique,
aucun changement de modèle implicite. Maximum quatre continuations locales,
300 secondes par requête ; bail de supervision de 90 secondes renouvelé uniquement
par l’agent, vérifié avant chaque nouvel appel. Même si une requête distante termine
après interruption, son maximum reste réservé. Arrêt définitif à 2 USD engagé ;
phase développement limitée à 1,40 USD, donc réserve finale 0,60 USD.

### Diagnostic de la sonde H1

Premier appel : outil quran_fr avec paramètres vides/0, rejet validé ; coût
0,000372175 USD conservé. Ajout d’un retour invalid_query au modèle dans la boucle
déjà bornée, au lieu de traiter une simple erreur d’argument comme une panne.
La répétition a rendu 24 segments et deux recherches serveur, aucun appel local :
0,01512688 USD pour 78,38 s ; le coût est principalement le web. Les 66 segments
suivants : 0,00140165 USD, sans recherche. Total utile 90 segments : 0,01652853 USD,
soit environ 0,22 €/h sur cette seule sonde riche en recherche (à recalculer sur
la durée exacte). Ne pas conclure que chaque minute future répétera ces recherches.

Deux erreurs de sens persistent : ID9 change le référent féminin (la femme est
couverte hormis le visage) en « Il est dissimulé sous tout le reste » ; IDs56–57
transforment des gens qui se battent à cause de leur appartenance universitaire
en une dispute pour savoir d’où vient quelque chose. Le découpage seul n’a donc
pas résolu le problème. Pas de promotion de H1.

H2 ajustée AVANT nouvel essai, mécanisme distinct : génération en une seule passe
avec arabe recopié + sens français proche de la source + français final naturel.
Les consignes demandent de garder agents/actions, négations, modalités et référents
entre les deux formulations. Pas de liste d’erreurs, d’IDs cibles ou de corrections
attendues fournie au sujet. Cela matérialise l’étape de compréhension avant la
naturalisation, avec surcoût de sortie faible sur Luna, sans second appel de
révision ni réinjection du long contexte. Forte confiance dans la baisse du risque
de paraphrase libre ; le test décidera si le gain est suffisant. Sonde : mêmes
90 segments, quatre lots, abandon si les erreurs de sens ne diminuent pas ou
si de nouvelles erreurs majeures apparaissent. Le test réservé reste intact.

H2 résultat : 0,00524 USD, 90 segments valides, mais ID9 encore faux et ID56
atténue encore le fait de se battre ; une faute d'accord apparaît (66–67).
La matérialisation du sens en sortie ne suffit pas ; ne pas la promouvoir.

H3a, avant appel : piste des démonstrations de domaine étayée par Li et al.
Cinq exemples synthétiques hors corpus dans demonstrations.md, centrés sur portée,
référents, modalités et alignement. Aucun ID ni correction du benchmark.
Traitement groupé explicitement exploratoire : exemples + Luna high, sans double
sortie H2 inutile. Les petits lots rendent le raisonnement high abordable en principe ;
sonde de 90 segments avant extension. Objectif : réduire les deux erreurs de sens
sans introduire de nouveau contresens, puis mesurer le prix complet. Forte confiance
motivée dans l'utilité de consignes concrètes avec exemples et attention renforcée,
aucune prétention à une probabilité mesurée de réussite. H3b (références récupérées
avant génération) reste distincte et sera utilisée si les citations sont le problème.
Le corpus hadith V2 ajoute Riyad et les URL exactes stockées par le dataset CC0.
Aucun hadith n'a été invoqué dans les sondes H1/H2 ; le Coran reste la même édition.

H3a : 90/90, 0,004712065 USD ; ID9 devient correct (« Tout le reste demeure
voilé »), mais 56–57 restent faux. ID49 restreint les écoles aux seules écoles
juridiques alors que le contexte comprend aussi les écoles doctrinales. Variante
non suffisante ; le gain observé ne permet pas d'attribuer l'effet aux seuls exemples
plutôt qu'au raisonnement high, et ne vaut pas succès.

H3c, test prospectif : reprendre les mêmes petits lots + démonstrations avec
Gemini 3.1 Flash Lite medium. Motif : l'ancien essai high était notamment meilleur
sur les verbes arabes et quelques termes, mais proche du plafond de prix ; réduire
la longueur des sorties et garder le contexte/exemples peut préserver cette qualité
avec moins de raisonnement coûteux. Confiance forte en la faisabilité économique et
la pertinence linguistique, à vérifier ; aucune assurance de perfection. Sonde 90,
puis seulement extension si pas de contresens manifeste sur cette sonde et coût
horaire projeté < 0,20 €. Ce changement de modèle reste expérimental, pas applicatif.

H3c premier lot : rejet de l'enveloppe indiquant provider=OpenAI alors que le
modèle demandé est Gemini. Le GET de génération identifie Google AI Studio /
gemini-3.1-flash-lite-20260507. La qualification est ajoutée sans réécrire le rejet,
sans régénération payante. Usage facturé retenu (0,00230625 USD) ; metadata total_cost
=0 ne l'annule pas. Le banc vérifie désormais le GET de génération, comme les
anciens scripts. Il s'agit d'un défaut du nouveau contrôle de provenance, pas
d'un échec linguistique. Réserve terminologique observée : « juristes fondamentalistes »
pour الأصوليين ; les autres lots de la sonde permettront de juger la méthode.

H3c complet : 90/90 structurellement valides après qualification de provenance,
0,0082545 USD. 9 et 56 sont meilleurs ; 16 (« juristes fondamentalistes »),
41 (les écoles rendent les personnes célèbres au lieu d'être elles-mêmes connues)
et 79 (« interprétations juridiques » dans un propos sur la doctrine) sont des
réserves importantes. Pas de promotion comme traduction publiable.

H4, pré-enregistrée : **deux premiers jets indépendants et arbitrage des désaccords**.
La révision aveugle précédente demandait de trouver des erreurs sans alternative.
Ici, un arbitre reçoit arabe + deux propositions anonymisées, compare leur sens,
et ne renvoie que les remplacements nécessaires. Cette méthode est différente
d'une seconde traduction complète ou d'une correction générale. Forte confiance
motivée par les erreurs complémentaires déjà documentées : DeepSeek conserve
certaines relations que Luna perd, Luna évite certains contresens terminologiques
que DeepSeek produit. Le coût des deux modèles faibles laisse une marge très
supérieure à celui d'un raffineur fort. Aucun exemple fautif ciblé ni réponse du
réviseur n'est fourni à l'arbitre ; tous les segments de la sonde sont inclus.

Diagnostic économique avant tout nouveau premier jet : utiliser les 90 lignes
Luna H3a et les mêmes 90 lignes du DeepSeek intégral déjà archivé. Faire arbitrer
par Luna high une seule fois, avec positions A/B alternées. Ces données historiques
ne permettent pas d'attribuer causalement le gain à une différence de prompt ;
elle servent seulement à tester si l'arbitre exploite réellement les alternatives.
Si une erreur majeure persiste, ne pas prétendre l'avoir corrigée. Si le diagnostic
est positif, produire des premiers jets frais, aux paramètres figés, pour le
reste du développement puis le test réservé. Tous les coûts nouveaux restent
comptés, et le coût des premiers jets doit être inclus dans le prix du pipeline,
même lorsqu'un diagnostic réutilise un ancien résultat.

H4 diagnostic : 28 remplacements / 90, 0,00538505 USD. L'arbitre corrige notamment
l'inversion du segment1 et le fait de se battre en56, mais supprime la citation
de6 et réintroduit une fausse interprétation du pronom de9. **Échec net** : le
pouvoir de réécrire introduit des erreurs même lorsque les candidats sont corrects.

H4b, modification générale du mécanisme avant nouveau test : sélection A/B
strictement fermée, sans réécriture autorisée. Le programme copie littéralement
le texte sélectionné, vérifie tous les IDs et leur ordre. Cela empêche par
construction les inventions observées en6/9, sans fournir leurs IDs ni les bonnes
réponses au modèle. La sélection peut encore préférer une mauvaise proposition
ou échouer si les deux sont mauvaises ; ces limites restent dans l'évaluation.
Sonde unique sur les mêmes90, puis extension si zéro contresens ; pas de reprise
pour obtenir un tirage favorable. Confiance élevée dans ce garde-fou formel et
son prix faible ; sa capacité de sélection reste à mesurer.

Complément bibliographique : Farinhas et al., EMNLP2023, montrent l'intérêt de
petits ensembles et du MBR (https://arxiv.org/abs/2310.11430) ; cela ne prouve
pas notre sélecteur génératif. Dong et al., ACL2025, combinent deux traductions
avec fine-tuning (https://aclanthology.org/2025.acl-long.726/), non reproduit ici.

H4b : 0,003406175 USD. Répare les erreurs ciblées1/9/56 sans nouvelle phrase
inventée, mais la sélection segment par segment casse les dépendances : 84
« Dieu n'a exigé de lui » +85 « de croire… » supprime le « que » de la restriction
présent dans l'autre version. 34/35 produisent aussi « désigne pour ceux ».
C'est une régression réelle, pas seulement de la préférence stylistique.

H4c pré-enregistrée : choisir **une version par phrase entière**, dont les fragments
sont groupés déterministement par la ponctuation arabe forte. Les IDs/timestamps
restent inchangés, seul le choix A/B est commun à tous les fragments de la phrase.
Les positions A/B alternent par groupe, pas par fragment. Le programme ne réécrit
rien. C'est un correctif du mécanisme de mélange, pas une liste de patches des
exemples ratés. Les groupes sont établis sans lire les traductions ni les erreurs.
La qualité d'une phrase entière incorrecte dans les deux versions reste insoluble
par la seule sélection ; le critère d'arrêt ne change pas.

H4c : 0,00278655 USD. Les dépendances de phrase et la restriction « ne… que »
sont préservées, et1/9/56 restent corrects. Toutefois49 reprend « écoles juridiques »
alors que le propos vise aussi les écoles doctrinales ;77 présente un accord
pronominal bancal. Ce n'est donc toujours pas un succès au critère fixé.

H5, étape de préparation source-seule, pré-enregistrée avant appel : une fiche
courte du document entier (sujet, registre, terminologie contextualisée, ambiguïtés)
sera fournie aux deux traducteurs et au sélecteur de phrases. Aucune traduction
candidate, liste de défauts ou ID d'erreur n'entre dans sa génération. Objectif :
empêcher de réduire un terme à son acception habituelle quand le document en
précise une autre ; rendre visible le contexte global sans répéter tout le texte
à chaque lot. Pratique proche du synopsis/glossaire de Subtitle Edit, avec limites
signalées par la recherche sur les terminologies. Forte confiance en ce mécanisme
pour les erreurs de portée observées, et coût marginal anticipé <0,02 €/h.
La fiche est une hypothèse de lecture, pas une autorité supérieure à l'arabe.
Sonde identique90, deux jets frais ; continuer seulement si zéro contresens.

H5 fiche générée : 0,002666425 USD, uniquement à partir des384 segments arabes.
Elle contextualise correctement « école »/« ijtihad », mais présente un risque :
elle décrit comme large le champ sunnites/chiites et comme plus restreint le champ
doctrinal, alors que les qualificatifs explicites du locuteur sont خاص puis عام.
Cette analyse de portée ne doit PAS remplacer les mots particuliers/généraux de
la source. Le prompt dit déjà que la fiche ne fait pas autorité sur l'arabe ; le
risque fait partie de la qualification, la fiche n'est pas corrigée manuellement.
Deux jets frais de la sonde90 : DeepSeek sans raisonnement en un lot90 + Luna high
par24, même fiche et mêmes exemples, puis choix fermé par phrase. Ce protocole
composite est une recherche de pipeline, pas une ablation scientifique d'un seul facteur.

Incident H5 : le premier appel DeepSeek a renvoyé une erreur HTTP, dont le banc
ne conservait pas le statut. Défaut d'instrumentation corrigé : statut, identifiant
et corps expurgé sont désormais conservés. Aucun coût zéro n'est inventé.
L'API de lecture du compte, stable sur deux observations, indique 0,984764356 USD
pour la journée. 59 générations uniques archivées issues de cette même clé
représentent 0,95627578 USD. L'intégralité du solde non attribué (0,028488576 USD)
est imputée conservativement à cet incident, arrondie à **0,03 USD de borne**,
pas de coût exact. Les preuves privées sont billing-reconciliation.json et
daily-audit.json. La réservation initiale de 1,24 USD reste visible ; sa borne
réconciliée permet la suite sous le plafond total. L'API analytics exige une clé
de gestion absente, aucune permission supplémentaire demandée.

Le catalogue de l'endpoint DeepSeek épinglé annonce response_format mais pas
structured_outputs. Nouvelle sonde instrumentale H5 en json_object, validation
locale stricte identique ; aucune prétention au décodage contraint. Pas de retry
caché ni de changement de fournisseur. La cause exacte de l'ancien HTTP reste
inconnue faute de diagnostic, ce catalogue ne la prouve pas.

H5 json_object rejeté **avant tout fournisseur** : HTTP404, endpoint exclu pour
paid-model-training-violation-by-account. Aucun assouplissement des règles de
confidentialité. Aucun modèle/tool exécuté, coût zéro pour ce rejet explicite.
La sonde suivante garde DeepSeek V4.1 Flash, change explicitement l'hébergeur vers
DeepInfra FP8 (0,14/0,42 USD/M), sans fallback. Ce n'est pas une preuve comparative
sur le fournisseur. Les réponses conservent leur provenance. La première erreur
sans statut reste comptée à sa borne0,03 ; pas réattribuée rétrospectivement.

H5 DeepInfra : 0,00185556 USD, 90 IDs complets, mais enveloppe Markdown malgré
json_object. Le brut et l'échec restent intacts ; un artefact dérivé retire
uniquement l'enveloppe exacte puis valide le document JSON entier sans réécriture.
Erreurs nettes 1 (inversion), 9 (référent) et56 (atténuation de « se battre »).
H5 Luna premier lot : 0,00184605 USD, ID9 « Le reste le dissimule », également faux.
Le sélecteur fermé ne peut donc pas réussir : ses deux propositions pour cette
phrase sont fausses. Arrêt des nouveaux lots après l'appel déjà engagé, suppression
du bail sans tuer la requête en cours. Pas de dépense d'arbitrage vouée à l'échec.
La fiche source ne suffit pas et peut aggraver un référent ; hypothèse rejetée.

H6 pré-enregistrée : **traduire les phrases entières, puis les répartir sans les
réécrire**. La contrainte de produire immédiatement chaque petit fragment oblige
les modèles à combiner compréhension et alignement ; elle peut pousser à résoudre
un pronom avant sa phrase et à compléter localement. La recherche document-level
MT puis segment refinement motive cette séparation, sans en prouver le résultat ici.
Groupes définis par ponctuation arabe forte, avant lecture du français. Traduction
Gemini 3.1 Lite medium, contexte de la sonde complet, mêmes exemples génériques,
sans fiche H5 rejetée. Puis Luna medium répartit chaque traduction de groupe sur
ses IDs originaux ; concaténation française strictement identique modulo espaces,
aucune réécriture permise, tous les IDs conservés. Ce garde-fou est testable horsAPI.
Confiance forte dans la suppression de cette surcharge d'alignement et dans le prix
(sortie Lite réduite, alignement Luna bon marché) ; plafond estimé0,15€/h, à mesurer.
Sonde90, abandon si contresens manifeste ou répartition impossible ; pas de retries.
Le corpus réservé reste intact. Cette hypothèse ne présuppose aucun ID fautif ni
aucune correction cible dans le prompt soumis.

H6 sonde : 42 phrases couvrant90 segments, 0,0044215 USD. Sujet de41 réparé,
accords améliorés. Mais55–58 deviennent « se battent pour savoir si quelqu'un vient
d'Al-Azhar ou de la Zitouna », mauvais motif au lieu d'appartenances opposées.
Pas d'alignement payant, candidat rejeté. Le découpage en phrases aide la forme
mais ne garantit pas les relations sémantiques.

Diagnostic outils distinct pré-enregistré : demander explicitement Coran 112:1,
Bukhari 1 et Riyad 1 à Luna medium, trois outils exposés réellement, réponses vérifiées
par le code et provenance journalisée. Maximum5requêtes/8appels. Cela qualifiera
la capacité de continuation, pas l'adoption spontanée ni la qualité de traduction.

H8 pré-enregistrée : juge d'une autre famille pour le choix fermé par phrase.
Reprendre exactement les candidats anonymisés H4c et son regroupement ; seul
l'arbitre change : Gemini 3.1 Lite medium au lieu de Luna high. Motivation : Luna
peut reconduire ses propres lectures ; les sorties Lite préservent plusieurs
relations que Luna rate, tout en ayant d'autres erreurs. Tester la complémentarité
comme **capacité de discrimination**, sans lui demander une réécriture ni les IDs
fautifs. Confiance forte dans ce mécanisme de diversification et son coût prévu
(<0,20€/h avec jets économiques), pas probabilité calibrée de perfection. Diagnostic
avec les jets archivés, coûts des premiers jets inclus dans le pipeline. Une seule
sonde90 ; zéro contresens pour promotion, sinon abandon. Si positive, produire des
jets frais sur la suite avant tout test réservé. Aucun ajustement sur le test final.

H8 : 0,0056525 USD, 90 IDs. Le juge différent corrige le choix de49 mais
sélectionne le contresens de56–57 malgré une bonne alternative disponible.
Le changement de famille de l'arbitre n'est donc pas suffisant. Ne pas promouvoir,
ne pas conclure que le consensus ou le choix fermé certifie le sens.

H9 avant appel : ablation de la liberté de reformulation du prompt métier.
Plusieurs sorties changent des relations en les rendant plus fluides ; le prompt
actuel insiste sur l'oral naturel, les idiomes et la reformulation libre. Remplacer
uniquement ses paragraphes stylistiques par une priorité brève à la fidélité et
à l'absence d'explication ajoutée. Conserver tout le contrat des références,
Parallel, les IDs, contexte avant/après, Luna high par24, sans fiche ni exemples.
Motif de confiance forte : suppression directe d'une incitation liée au défaut
observé, sans donner les corrections du benchmark ; coût Luna connu très inférieur
au plafond. L'étude ACL2026 observe aussi un intérêt des prompts simples, mais en
révision, donc pas preuve causale pour ce premier jet. Une sonde90, pas de retry.
Le prompt commun applicatif n'est pas modifié par cette expérience.

Compléments de recherche : COLING2025/110 et AMTA2026/2 rapportent des gains de
raisonnement structuré sur d'autres langues ; EMNLP2025/1031 ne retrouve pas une
supériorité générale de cette décomposition. Ces résultats contradictoires et H2/H5
ne justifient pas une autre passe d'analyse grammaticale à forte confiance ici.
Sources : https://aclanthology.org/2025.coling-main.110/ ;
https://aclanthology.org/2026.amta-research.2/ ;
https://aclanthology.org/2025.emnlp-main.1031/ .

H9 : les premiers48segments restent structurés, mais9 redevient « Il est donc
dissimulé sous tout le reste », référent faux. Ablation insuffisante ; suppression
du bail pour arrêter après la requête en vol, pas de poursuite pour sélectionner
une variante heureuse. Le critère n'est pas assoupli.

H3b, strate distincte nécessaire à l'instrument : les premières90lignes ne
contiennent pas de récitation coranique, donc elles ne mesurent pas l'utilité des
références locales. Réserver prospectivement la plage de développement positions
240:306 (IDs241–306,66segments,158,86s), déjà connue historiquement, **pas** le test
final. Deux bras frais Luna medium par24, même prompt métier/contexte/outils :
contrôle outils disponibles à la demande, puis candidats locaux préchargés.
Récupération sans modèle : requête par segment (après ':' s'il existe), trois mots
minimum, conserver uniquement les candidats dont l'arabe contient le fragment
normalisé complet. Ne pas certifier l'attribution, ne pas compléter les citations.
Ce filtre conservateur peut manquer des correspondances ; pas de règle ajoutée
pour un ID particulier. Sept segments ont des candidats dans cinq versets locaux.
Confiance forte pour éviter la traduction mémorisée d'une citation explicitement
présente et réduire les tours d'outils ; coût d'entrée attendu très faible.
Évaluer chaque ligne, utilisation effective, ajouts de mots absents et prix complet.
Cette strate diagnostique ne peut pas sauver un pipeline raté sur les90premières
lignes ni remplacer le test réservé. Une paire seulement, sans répétition choisie.

H3b contrôle terminé :66/66 IDs, sept appels locaux dont une plage invalide corrigée,
neuf requêtes modèle, 0,002941975 USD,264,787s de banc bout en bout (inclut les GET
de provenance et les rechargements CLI ; ce n'est pas la latence du worker déployé).
Les citations249/250/252/253 et301–305 reprennent effectivement le corpus local.
Le français58:7 contient une coquille amont « n'y ne soit », recopiée fidèlement :
**défaut de source distinct d'une erreur générative**, conservé dans l'édition.
Le contrôle reste perfectible hors citations : « doctrine des salafites » pour
مذهب السلف peut induire une confusion avec un courant moderne au lieu des premières
générations ; en293 « ont rapporté » déplace l'attribution (« il est établi à leur
sujet »). La réussite de récupération n'est pas un certificat du reste du texte.


H3b préchargé terminé :66/66IDs, six appels locaux, cinq requêtes modèle,
0,002776025USD,155,974s. Le modèle redemande plusieurs références préchargées,
mais en groupe. Les citations restent issues du corpus. Régression d'alignement293
(anticipation d'« interpréter » depuis296), « Dieu a une personne » en256 maladroit
et imprécis. Aucun gain sémantique global qualifié ; résultat utile seulement pour
le mécanisme de récupération et le nombre d'appels, pas une promotion du pipeline.

Clôture : toutes les pistes prospectives exécutées conservent leur résultat,
positif ou négatif. H7 n'a pas été lancé : refaireH6 avec plus de raisonnement seul
n'avait pas une justification assez forte après les résultats antérieurs.
Le script d'alignementH6 reste testé horsAPI, son traitement payant n'a pas été lancé.
La réserve de validation finale reste inutilisée, conformément au filtre de promotion.

Réconciliation finale en lecture seule : le solde journalier non attribué reste
exactement 0,028488576 USD après tous les essais ; la provision de0,03USD le couvre.
Preuve privée : key-usage-final.json. Aucun processus payant restant.
