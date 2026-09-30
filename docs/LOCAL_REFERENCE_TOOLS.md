> Décision du 30 septembre 2026 : seul `quran_fr`
> reste accessible au modèle. `sahih_ar` et `hadith_ar` sont désactivés ;
> leur corpus et la consultation hors ligne sont conservés.
> Voir [la politique actuelle](HADITH_REFERENCE_POLICY_20260930.md).

# Outils locaux de références — 25 septembre 2026

Les trois outils sont implémentés en Go, consultables hors réseau et raccordés à
la boucle OpenRouter. Le propriétaire a autorisé leur activation le 25 septembre :
le worker d'atelier charge désormais le corpus `20260925-v2` depuis son image
en lecture seule. Voir le [rapport de déploiement](DEPLOY_LUNA_REFERENCES_20260925.md).
Le travail reste sur `web-vps` ; aucune migration de base n'est nécessaire.

## Contrats

- `quran_fr({surah, verse, end_verse?})` : verset exact ou plage de dix versets
  maximum. Ou `quran_fr({arabic_query})` avec au moins trois mots arabes.
  Arabe et français de l'édition locale, références, provenance et liens.
- `sahih_ar({collection, reference})`, ou `arabic_query` à la place de `reference` :
  Bukhari/Muslim, texte arabe uniquement. Les suffixes de variante restent intacts.
  Une référence sans suffixe, si seules des variantes existent, renvoie celles-ci
  comme ambiguës et ne choisit pas silencieusement une version.
- `hadith_ar` : même contrat pour les autres recueils installés, ici Abu Dawud
  et Riyad as-Salihin. Ajouter une collection exige un nouvel import versionné.

`found` signifie référence exacte trouvée dans cette édition. Un fragment,
même unique après normalisation, renvoie `ambiguous`/`text_candidates` : sa
ressemblance ne certifie ni l'attribution ni l'identité avec les mots prononcés.
`not_found`, `corpus_unavailable` et `invalid_query` sont distincts.
Cinq candidats textuels maximum, indication de résultats supplémentaires.
La recherche est lexicale : pas d'embeddings, pas de recherche sémantique cachée.
Elle ignore les diacritiques et certaines variantes orthographiques dans l'index
seulement ; les textes restitués ne sont jamais normalisés ou réécrits.

L'appelant n'a accès ni à SQL, ni à des chemins, ni au réseau. Les contenus retournés
sont des données non fiables pour les instructions du modèle. Un mauvais argument
produit un retour explicite à corriger dans la boucle bornée. Un outil inconnu est
refusé. Cinq requêtes modèle maximum, huit appels locaux maximum, délai global
cinq minutes ; le budget serveur Parallel n'est pas réinitialisé à chaque tour.
L'audit conserve les arguments, résultats et version de corpus, séparément des
sous-titres. Le modèle ne peut pas fabriquer cet audit.

## Corpus effectivement importé

`data/reference_corpus/20260925-v2/` contient 23 745 entrées :

| Collection | Entrées | Couverture |
| --- | ---: | --- |
| Coran arabe + français | 6 236 | Versets de l'édition complète |
| Bukhari | 7 252 | Collection importée, exhaustivité des variantes non certifiée |
| Muslim | 3 087 | Idem ; certains numéros comportent un suffixe |
| Abu Dawud | 5 274 | Idem |
| Riyad as-Salihin | 1 896 | Idem |

Coran : Tanzil Simple 1.1, français `fr.hamidullah`, édition du 18 juillet 2011.
Le texte arabe est copié tel quel, y compris la basmala que cette exportation
préfixe à certains premiers versets ; elle ne correspond pas toujours au français
du premier verset. Ne pas compléter une citation partielle. Quran.com identifie
le verset, mais ne sélectionne pas automatiquement cette édition française.
Attribution Tanzil, notice originale et originaux conservés. La traduction est
proposée par Tanzil pour un usage **non commercial** : ne pas conclure que la
licence du texte arabe autorise sa réutilisation commerciale.

Hadiths : [open-hadith-data v1.1.0](https://github.com/Jaguar16/open-hadith-data),
commit `1d6365b2d7e97b56627bfdca2c41052877d8a5dd`. Données structurées CC0 et
textes arabes classiques ; aucune traduction anglaise n'entre dans l'index ou
les résultats. Le ZIP brut de provenance contient aussi les champs anglais du
producteur ; il reste privé et n'est pas incorporé au dépôt/image. Archive figée
par SHA256 `13ffb061ea3afbfb009c015d76daf4a5c131fa966574f77ab8c2841a019972d2`.
Les `url_source` du producteur sont conservées, contrôlées structurellement,
jamais reconstruites depuis un numéro interne. Vérification de contenu ponctuelle
sur Bukhari 1, Abu Dawud 1 et Riyad 1 ; **pas** vérification humaine de 17 509 pages.
L'extraction amont peut avoir des lacunes ; `complete=false` le signale.

Le premier import `20260925-v1`, conservé pour audit, utilisait hadith-api et une
numérotation interne `api:N`. Il n'est plus le corpus conseillé : Riyad absent,
entrées arabes vides et liens Sunnah non établis pour la plupart des références.
Les expériences nomment le corpus utilisé ; ne pas mélanger leurs provenances.

## Commandes reproductibles

```sh
make references-import REFERENCE_CORPUS=data/reference_corpus/NOUVELLE-VERSION
make references-test
make references-build
printf '%s\n' '{"tool":"quran_fr","arguments":{"surah":2,"verse":255}}' | make references-query
printf '%s\n' '{"tool":"sahih_ar","arguments":{"collection":"muslim","reference":"1907a"}}' | make references-query
printf '%s\n' '{"tool":"hadith_ar","arguments":{"collection":"riyadussalihin","reference":"1"}}' | make references-query
```

Sur ce VPS, `make` est disponible sous `web/.cache/make`. Aucun secret requis.
L'import refuse un dossier existant. `manifest.json` et `provenance.json` tracent
versions, sommes de contrôle, couverture, licences et sources. Le chargement
vérifie SHA256 et cardinalités avant de servir la moindre référence.

La recette active embarque le dossier dans l'image privée du **worker texte**
et définit `REFERENCE_CORPUS_DIR=/app/references`. La racine du conteneur est
en lecture seule. `make web-worker-image` prépare un contexte limité aux fichiers
du corpus, à leur provenance et aux notices ; les archives brutes et les données
utilisateur sont exclues. Le chargement est vérifié pendant le build puis au
démarrage. Aucun
secret supplémentaire, aucun port réseau, aucun accès accordé au composant média.
Un dossier configuré mais invalide empêche le démarrage du worker ; une absence
de configuration conserve les capacités actuelles. Le prompt commun décrit les
outils conditionnellement selon les définitions réellement exposées. Le desktop
n'est pas prétendu raccordé simplement parce qu'il partage le prompt : son
adaptateur de tools reste à préparer lors d'une évolution desktop distincte.

Les URL sont retournées et auditées. Aucun nouveau panneau de remarques/liens
n'est ajouté dans cette tâche ; leur présentation aux utilisateurs et leur
association précise aux timecodes restent une évolution UI distincte.

## Qualification

Tests Go : hash altéré, plage partielle, requêtes contradictoires, URL non admise,
texte original intact, variantes, corpus absent, recherche avec diacritiques,
continuation modèle, conservation des détails de raisonnement et budget des tools.
Contrôles sur les vrais corpus : Coran 112:1–4, Muslim 1907/1907a, Abu Dawud 1,
Riyad 1 ; rapport `web/review/quality-campaign-20260925/local-qualification.json`.
Qualification réelle OpenRouter : Luna a exécuté les trois outils (Coran 112:1,
Bukhari 1, Riyad 1), reçu les réponses du vrai corpus et terminé en deux requêtes,
pour 0,0004249 USD. Le diagnostic explicite et les réponses sont conservés dans
`data/model_outputs/quality-20260925/local-tools-real-provider/`. Cela prouve la
capacité de continuation, pas l'adoption spontanée ni la fidélité de toute une
traduction générée. Chargement du corpus mesuré : environ 1,51 s et 98 MiB RSS ;
le worker charge une seule fois, le CLI de diagnostic à chaque processus.

Sources : [Tanzil arabe](https://tanzil.net/docs/Text_License),
[Tanzil traductions](https://tanzil.net/trans/),
[licence des données hadith](https://github.com/Jaguar16/open-hadith-data/blob/main/DATA_LICENSE.md),
[composition outils serveur/client OpenRouter](https://openrouter.ai/docs/guides/features/server-tools).

## Anomalie éditoriale constatée

La version Tanzil française importée contient littéralement « n'y ne soit » en
58:7. Le modèle a recopié cette coquille lors du test réel ; ce n'est pas une
invention du modèle. Le texte de référence est conservé intact, originaux et
hash inclus. Une édition locale complète n'est donc pas automatiquement une
édition française relue/certifiée. Toute correction future doit provenir d'une
édition qualifiée ou d'un erratum explicite et versionné, jamais d'une réécriture
silencieuse du corpus canonique. Cette limite doit être prise en compte avant
une utilisation exigeant des sous-titres publiables sans relecture.
