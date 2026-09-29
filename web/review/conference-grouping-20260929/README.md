# Essai hors application : Sirat, regroupement progressif

Le propriétaire demande un MP4 complet pour jugement visuel, **sans refonte ni
déploiement applicatif**. Les fichiers d'entrée sont des copies en lecture seule
préparées par l'administrateur dans `/home/codex/.tarjama-sirat-grouping-input/`.
Leur manifeste identifie la version 6 et 966 segments. Les SHA256 sont vérifiés.
Aucun accès au stockage de production, aucune session fabriquée, aucun appel IA.

## Exécution reproductible

Depuis la racine, avec l'image outils existante contenant FFmpeg, libass et Noto :

```sh
make web-sirat-grouping-preview ARGS=prepare
make web-sirat-grouping-preview ARGS=samples
make web-sirat-grouping-preview ARGS=render
make web-sirat-grouping-preview ARGS=verify
```

`render` et `samples` refusent d'écraser un fichier déjà présent. Ne pas relancer
le rendu pour livrer à nouveau un artefact terminé. Le lanceur monte uniquement
les copies, le script et son répertoire de sortie, sans réseau, secrets, socket
Docker, privilèges ni volume applicatif. Limites : 4 CPU, 1536 Mio, 128 processus,
échéance interne de deux heures. Au moins 17 Gio libres requis au lancement.

Sorties privées : `web/.cache/conference-grouping-20260929/`. Le MP4 est encodé
en H.264 1920×1080, CRF 23, preset superfast ; l'audio AAC est copié sans
réencodage. Taille Gros identique au calcul applicatif : 83 à cette résolution,
marges 96/63. Arial résout vers Noto Sans dans l'image VPS, comme actuellement.

## Méthode réellement appliquée

Voir [la recherche et ses limites](../../../docs/SUBTITLE_CONFERENCE_RESEARCH_20260929.md).
Un graphe des frontières de segments permet de comparer les partitions complètes.
Les nouveaux groupes n'excèdent pas 7 secondes, 21 caractères/seconde ou deux
lignes de 42 caractères ; leur largeur est mesurée par libass avec la police
effective. Une pause interne n'est plus un veto fixe à 500 ms. Les bornes externes
et tous les mots sont préservés ; aucun mot n'est déplacé isolément.

Les priorités de choix sont explicites dans `partition` : exceptions, coupures
après un mot grammatical inachevé, coupures sans ponctuation, groupes au-dessus
de 17 caractères/s, fins de phrases traversées, nombre de groupes, puis espaces
temporels internes. C'est une proposition algorithmique conventionnelle avec
des heuristiques françaises simples, **pas un parseur grammatical ni un optimum
scientifiquement démontré**. Une phrase courte complète peut rester seule.

Les segments d'entrée qui violent déjà les limites restent intacts. Leur rendu
ASS conserve le retour automatique à la ligne de production ; le SRT offre des
retours explicites. Ils sont comptés comme exceptions, jamais tronqués ou
réhorodatés pour améliorer artificiellement les chiffres. Les retours entre
lignes ne changent pas les mots, mais les espaces de mise en page sont normalisés.

## Constats avant livraison

- 966 segments d'entrée → 826 sous-titres ; 119 groupes fusionnés, au plus trois
  segments par groupe sur ce contenu.
- La règle déployée par paires donnerait 827 sous-titres sur cette même copie
  (calcul hors ligne). Ce prototype change la répartition ; il ne diminue donc
  presque pas le nombre total. Ne pas le présenter comme une amélioration
  systématique démontrée.
- Les affichages d'un mot (hors ponctuation) passent de 5 à 11 : la préférence
  pour les fins de phrase conserve notamment des réponses « D'accord ? » et
  une énumération de noms ponctués. La petite heuristique ne distingue pas tous
  les fragments des phrases autonomes. Ce constat est une limite du prototype,
  pas un motif pour ajuster les règles spécifiquement à chaque ligne de Sirat.
- Une fusion traverse un intervalle supérieur à 500 ms (720 ms).
- 230 sous-titres conservent au moins une exception de l'entrée : 131 ne tiennent
  pas dans les deux lignes prévues, 114 dépassent 21 caractères/s, 35 dépassent
  7 secondes. Les catégories se recouvrent. Un simple regroupement ne corrige pas
  un segment trop long ou rapide sans possibilité de le découper.
- À 24:10.920–24:14.980, la citation « Sans la difficulté… » est réunie.
- À 46:16.820–46:21.100, « jour, son père fut occupé par une affaire, » est réuni.
  « Un » reste dans le précédent : le réunir à « jour » ferait 7,100 secondes,
  donc dépasserait la limite retenue. Cette limite concrète doit être montrée.

Sept tests locaux couvrent conservation, fusions triples, pause interne, ancien
seuil de dix mots, préfixe trop rapide récupérable, exception indivisible et
horaires réels du cas « Un jour ». `verify_layout.py` vérifie avec libass tous
les sous-titres : rectangles dans l'image et au plus deux bandes de lignes pour
les nouveaux groupes. Images inspectées sur les passages signalés et un segment
long. Ces contrôles ne mesurent pas la compréhension humaine ni la fidélité de
la traduction ; la traduction n'a pas été refaite.

La commande `verify` décode intégralement la vidéo/audio, contrôle résolution et
durée et compare les SHA256 des paquets AAC source/sortie. Les journaux et le
SHA256 final restent avec les artefacts. Seuls les fichiers terminés sont copiés
vers `vps-share`, jamais le répertoire actif de rendu.

## Résultat final

Rendu complet terminé avec succès, 708 844 057 octets, durée 1:00:12,829,
1920×1080. Encodage : 706,95 secondes. Décodage intégral avec `-xerror` réussi ;
empreintes des paquets AAC source/sortie identiques. Entrées administrateur
revérifiées avec `sha256sum -c SHA256SUMS`, intactes. Image extraite du MP4 final
à 46:18 inspectée : le groupe prévu est bien incrusté. Il ne s'agit pas d'une
écoute ou d'une revue humaine complète d'une heure.

Livraison préparée par `vps-share` sous `tarjama-sirat-regroupement-progressif/`,
avec MP4, SRT, note de lecture et empreintes. Le propriétaire lance `vps pull`
sur son Mac ; aucune réception sur le Mac n'est affirmée avant ce transfert.
