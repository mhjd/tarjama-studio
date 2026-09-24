# Correction automatique — 24 septembre 2026

## Constat et protection de la relecture

Le job de correction `83672008b6c9f6d9b536f1130386c1d6` du projet concerné était
`failed` à 49%, après la transcription réussie du 23 septembre. Les morceaux
corrigés sont persistés, mais le projet reste `cleaning` : aucun résultat partiel
n'est publié. Les journaux du processus qui a échoué ne sont plus disponibles ;
la cause exacte de cet échec historique n'est donc pas établie.

L'API refusait déjà l'édition pendant `transcribing`/`cleaning`, et les champs
étaient désactivés, mais leur présence pouvait faire croire que le texte était
prêt à relire. La transcription brute, les champs et le suivi ne sont désormais
pas affichés avant la fin du nettoyage. Un message indique quand la relecture
sera disponible. Le lecteur vidéo reste accessible.

## Reprise et intégrité

Les réponses IA invalides (JSON, cardinalité, alignement, marqueurs interdits)
et les sorties tronquées par `MAX_TOKENS` déclenchent au plus deux reprises
supplémentaires avec une attente persistante de 10 secondes. Le morceau courant
est raccourci aux frontières de segments. Les IDs, timestamps et morceaux déjà
validés sont conservés ; seul le suffixe inachevé est recalculé. Les refus de
sécurité, clés refusées et erreurs inconnues ne deviennent pas des retries de
format. Une limite persistante produit une erreur explicite après les tentatives,
jamais un succès partiel ni une boucle illimitée.

Des catégories fixes sont journalisées, sans transcription, payload fournisseur,
URL privée ou clé. La progression du traitement texte repose désormais sur les
segments validés, pour rester cohérente lorsque le nombre de morceaux change.

## Vérification

- Backend exact de livraison : `go test -race -count=1 ./...` et `go vet ./...`
  réussis. Tests des reprises bornées, de la distinction troncature/refus, des
  frontières persistées après redémarrage, de la publication atomique, et du refus
  API d'éditer l'arabe brut.
- 12 tests Playwright éditeur réussis, dont l'absence de champs avant nettoyage
  et leur réapparition éditable une fois le projet prêt. Tests avec fixtures,
  pas avec une transcription réelle dans le navigateur.
- TypeScript/Vite et build Docker réussis. Les vitesses/raccourcis ajoutés juste
  avant restent présents ; leurs 21 tests sont documentés séparément.
- Backend recherche candidat exclu de l'image, prompts qualifiés conservés.

Image : `preview.local/atelier/web@sha256:72c9bedff3f58f373cc6a32a1acc064ec75254b0ecfb2a12eecdb0bd29fec256`.
Recette : `web/deploy/preview/active-cleanup-20260924.yml`.
Validate/plan/déploiement réussis ; révision `f9ee8afa66d2d522`, quatre services prêts.

La reprise explicite ne cible que le job en échec, avec verrou du projet et
contrôles de génération, version, état et compteur de tentative. Elle conserve
les morceaux déjà réussis et ne relance ni téléchargement ni transcription.

Résultat réel vérifié à 08:21:19 UTC : correction `succeeded`, 100%, projet
`arabic`, 970 segments. Les morceaux 0/1 (312 et 344 segments) ont été conservés ;
les nouveaux morceaux 2/3 contiennent 153 et 161 segments. Aucun téléchargement
ni appel ASR supplémentaire. Cette reprise réussie sur des morceaux réduits ne
permet pas d'affirmer la cause exacte de l'échec historique dont le log a disparu.
Aucune nouvelle erreur n'est apparue dans le journal du worker durant la reprise.
