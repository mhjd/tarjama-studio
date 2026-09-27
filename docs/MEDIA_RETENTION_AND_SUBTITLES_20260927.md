# Vidéos temporaires, SRT et corrections indépendantes — 27 septembre 2026

## Décisions utilisateur

- Les textes corrigés restent conservés dans le projet, même lorsque les vidéos
  sont supprimées. Pas de suppression de transcription, traduction, projet ou
  sauvegarde d'exploitation par cette politique.
- Vidéo source YouTube : 24 h ; récupération avant un nouvel export, sans refaire
  la transcription ni la traduction. Une action permet aussi la récupération
  pour écouter pendant la relecture.
- Vidéo importée depuis l'appareil : **une semaine**, puis réimportation obligatoire
  pour un nouvel export vidéo. Avertissement dès le choix d'import et lors d'un
  import de secours. Cette décision remplace la proposition de 24 h pour l'upload.
- Vidéos de sortie : 24 h après leur création. Les formats Low/High restent inchangés.
- Export texte : SubRip `.srt` UTF-8, arabe ou français, horodatages à la milliseconde,
  nom dérivé du titre et suffixe `_ar`/`_fr`, sans style ASS imposé.
- Modifier l'arabe après traduction conserve tous les textes français et ne crée
  aucun job IA. La relecture/validation permet d'exporter sans retraduire. Une
  nouvelle traduction IA reste une action distincte avec confirmation explicite.

## Rétention exacte

Le worker effectue un passage toutes les cinq minutes. Il sélectionne au plus
100 projets éligibles, sous verrou de projet, et recontrôle l'absence de jobs
queued/running/waiting_provider avant toute suppression. Un traitement ou une
attente fournisseur protège donc les fichiers nécessaires, même au-delà de la
durée nominale. Les étapes de préparation/transcription/nettoyage ne sont pas
purgées : les candidats sont les textes accessibles à la correction/relecture
(`arabic`, `review`, `ready`), projets archivés inclus.

La préparation, la fin du nettoyage/traduction et la création d'un export renouvellent
la disponibilité de la source pour 24 h (YouTube) ou 7 jours (import). Les éditions
textuelles, le polling et la simple ouverture de page ne prolongent pas ce délai.
Le nettoyage retire seulement les fichiers explicitement référencés : source
courante, originaux d'upload connus et MP4 d'export. Les caches d'opérations média
restent gérés par la réconciliation existante, après fin/ACK des opérations.
Aucun parcours récursif du disque, aucune suppression de backups, du corpus,
de fichiers desktop ou des résultats textuels/audits.

Les sources existantes sans échéance bénéficient d'un délai entier au premier
passage. Leur origine est déduite de la dernière préparation/récupération réussie
si disponible. Les exports déjà âgés de plus de 24 h deviennent immédiatement
éligibles, sous les mêmes protections. Une expiration d'export utilise l'état
`expired`, sans effacer sa trace en base ; une nouvelle demande réutilise la tâche
avec une nouvelle tentative média, sans collision avec les opérations acquittées.

L'effacement de fichier et PostgreSQL ne forment pas une transaction atomique.
Une suppression absente est rejouable ; si le commit échoue après effacement,
un passage suivant réconcilie l'état. L'export contrôle aussi l'existence réelle
de la source et peut la récupérer à nouveau. Aucun texte n'est dans les fichiers
supprimés. Ne pas promettre une révocation de fichiers déjà ouverts par le système
ou une suppression à la milliseconde exacte de l'échéance.

## Récupération et réimportation

L'export garde son instantané de textes. Si la source est absente, il la récupère
via le moteur existant, ses profils isolés et son proxy WARP, puis l'exporte.
La récupération utilise une unité d'opération distincte du rendu : ni clés de cache
ni profils ne sont mélangés. Aucun appel Groq/LLM. Les barrières de génération,
lease, tentative et publication atomique restent applicables.

YouTube doit rester accessible. Une source retirée ou bloquée produit une erreur
réessayable par l'utilisateur, sans perte des textes ni repli réseau direct.
La récupération refuse une différence de durée supérieure à 1 seconde ou une
source finissant avant le dernier sous-titre. Les plateformes peuvent modifier
une vidéo à durée identique : la durée seule ne prouve pas l'identité de contenu.

Les nouveaux fichiers importés ont une empreinte SHA-256 mémorisée. Une
réimportation doit utiliser le même fichier, sous peine de refus avant préparation.
Les anciens imports dépourvus d'empreinte sont contrôlés sur leur durée ;
l'utilisateur doit sélectionner l'original. L'empreinte d'une récupération
historique n'est adoptée qu'après validation média, afin qu'un mauvais essai ne
bloque pas le bon fichier. La récupération peut terminer après une édition de
texte : elle ne publie que les propriétés média, sans remplacer les segments.

## SRT et workflow

Les exports SRT sont privés, contrôlés par propriétaire et version. Le frontend
attend le flush des modifications avant téléchargement. Ils ne demandent ni
vidéo présente, ni rendu FFmpeg, ni appel IA. L'arabe brut n'est pas exposé avant
le nettoyage ; le français n'est pas exporté pendant une traduction inachevée.
Les segments conservent identifiants, ordre et horodatages. Les lignes vides internes
sont retirées pour ne pas créer de faux blocs SRT ; heures supérieures à une heure
et caractères français/arabe sont testés.

Une retouche arabe invalide la confirmation de relecture et les anciens rendus,
pas la traduction. Le projet revient à `review`, les deux langues restent modifiables.
La filiation `translation_source` reste celle de la traduction réellement produite ;
elle n'est pas falsifiée pour simuler une retraduction. L'utilisateur peut valider
les textes actuels même après leur modification indépendante.

`Retraduire avec l'IA` explique le remplacement des corrections françaises et
exige une confirmation. Une nouvelle version distingue les passes volontaires
successives. Pendant cette passe, `Arrêter et conserver la traduction précédente`
invalide les résultats retardataires et revient à la relecture des textes conservés.

## Validation et exploitation

Tests avec PostgreSQL isolé : délais 24 h/7 j simulés, grâce initiale, conservation
des textes et backups, protection des jobs actifs, expiration/régénération
idempotente, récupération sans fournisseur IA, réimportation avec édition pendant
la préparation, refus d'une durée ou empreinte différente, accès SRT privé et
versionné, correction arabe sans retraduction et arrêt d'une passe volontaire.
Le moteur de récupération de ces tests est simulé ; ne pas les présenter comme
un téléchargement réel YouTube après une attente réelle de 24 h.

Tests Playwright : téléchargement SRT depuis l'éditeur avec la correction courante,
états source expirée YouTube/upload, conservation de la traduction après retouche,
parcours complets existants sur ordinateur et formats iPhone/Pixel.

Aucune migration SQL : champs JSON additionnels et état de job `expired`.
Un retour au code ancien n'est pas transparent pour les projets dont la source a
été purgée : il ne sait pas les restaurer et peut perdre les métadonnées de rétention
lors d'une réécriture. Conserver cette version ou corriger en avant ; ne pas annoncer
qu'un rollback de l'image restituerait les vidéos supprimées.

### Résultats vérifiés

- Suite Go complète avec détection de courses et `go vet` : réussie.
- Build frontend et 51 tests Playwright : réussis.
- Vérification des prompts desktop/web : réussie (aucun changement de prompt).
- Complément FFmpeg : création d'un MP4 réel, expiration simulée, récupération
  depuis un fichier fixture, rendu sous-titré et téléchargement HTTP privé réussis.
  Seul le téléchargement distant est simulé ; aucun appel YouTube/LLM réel.
- Sauvegarde PostgreSQL après un parcours UI, puis restauration dans une base
  isolée : réussies, projets et traitements terminés retrouvés.
- Cache isolé d'un export expiré : acquittement et retrait vérifiés avec courtier
  synthétique. Les profils administrés ne changent pas.

Les journaux locaux sont dans `web/.cache/retention-tests-final.log`,
`retention-go-final.log` et `retention-focused.log` (répertoire ignoré par Git).

### Préparation de livraison

Cette livraison n'est pas activée. L'API et le worker doivent être remplacés
ensemble ; aucune migration SQL nouvelle n'est nécessaire. Effectuer une sauvegarde
PostgreSQL réussie avant activation, puis vérifier les services et lancer la
qualification HTTP/OIDC/TLS. Les règles de suppression deviennent actives dès le
premier démarrage du nouveau worker.

Le contrôle préalable a observé `ErrImageNeverPull` sur l'egress de la révision
existante `b8884e644b5593ec` : image enregistrée mais absente du runtime, et copie
Docker exacte absente aussi. La nouvelle recette utilise l'image API construite
pour la commande `egress` (même exécutable, aucun changement de proxy/protection).
Cette correction sera appliquée avec la recette, pas par une modification directe
du runtime. Les autres services étaient prêts au contrôle.

Code testé : `f9f589b`. Aucun déploiement ni migration de données réelles effectués.


Recette : `web/deploy/preview/candidate-media-retention-20260927.yml`.
`validate` et `plan` réussis, révision candidate `40f81dc19215d885`,
`applied: false`. Images importées :

- API / egress : `preview.local/atelier/web@sha256:5c837dace66297e0c8f141f960fff22d253bed30e454c830675e8e2df7d66727`.
- Worker avec corpus : `preview.local/atelier/web@sha256:c73446f965560e0607c1f38fcb9d318ea32b34353f5c60f8afd8b08b2c93777c`.

Preuves sans secrets dans `web/deploy/preview/evidence/media-retention-20260927/`.
Une validation de recette ne prouve pas le fonctionnement après déploiement.
L'import des images n'a démarré aucun service et aucun job.

Commandes préparées pour la livraison autorisée séparément, depuis la racine :

```sh
make web-preview-status
make web-preview-run PREVIEW_JOB=backup
# Attendre et vérifier Succeeded pour cette nouvelle sauvegarde avant de poursuivre.
make web-preview-deploy PREVIEW_FILE=web/deploy/preview/candidate-media-retention-20260927.yml
make web-preview-status
# Vérifier web, worker, db et egress prêts, puis :
make web-preview-run PREVIEW_JOB=preview-check
# Vérifier le résultat de cette nouvelle qualification.
```

Aucun besoin de modifier les secrets, la politique réseau ou les profils média.
Aucun benchmark fournisseur facturé lancé pour cette livraison. Les tests de
rétention utilisent une horloge simulée ; une attente réelle de sept jours et
le retéléchargement YouTube en production restent des observations ultérieures.
