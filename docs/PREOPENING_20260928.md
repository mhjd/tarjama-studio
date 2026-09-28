# Fin de qualification applicative avant ouverture — 28 septembre 2026

L’application reste **privée**, sur la phase 06 `00305da3b4b44e06`. L’ouverture
sera une action administrateur distincte, après autorisation du propriétaire.
Aucun nouveau déploiement ni appel fournisseur dans cette vérification finale.

## Ce que l’on sait maintenant

Le banc Mac a déjà réalisé le parcours réel complet sur un projet distinct :
import YouTube, transcription, correction, édition et rechargement, traduction,
export High et téléchargements. Connexion, isolation entre comptes et révocation
ont aussi été qualifiées sur la pile réelle. Les 21 preuves sont conservées et
leurs empreintes ont été vérifiées par l’agent projet. Voir
[le résultat, les temps et les coûts](KEYCLOAK_BUSINESS_QUALIFICATION_20260928.md).

Le seul point de flux non enregistré de façon concluante par ce runner était le
verrouillage de la transcription pendant la correction. Le nouveau scénario
`web/frontend/tests/correction-lock.spec.ts` maintient cet état assez longtemps
pour le contrôler de manière déterministe, sans consommer de crédits IA :

- texte brut et texte partiellement corrigé non affichés/éditables ;
- transcription, correction en file, active, en attente fournisseur, échouée,
  annulée et reprise automatique sans message technique ;
- saisie impossible après rechargement ou accès direct à l’URL d’une étape future ;
- boutons Corriger/Traduire/Exporter bloqués pendant la préparation ;
- apparition de l’arabe éditable uniquement après achèvement, via le polling ;
- traduction encore inaccessible avant validation humaine de l’arabe ;
- aucune mutation envoyée pendant ces contrôles de navigation.

Les tests API avec PostgreSQL vérifient séparément que des requêtes forgées ne
peuvent ni écrire les champs, ni avancer, ni exporter avant l’étape autorisée,
et que les textes restent intacts. Les contrôles de routes, sauvegarde avant
navigation et attente de traduction restent inclus dans la cible reproductible.

**Portée exacte :** navigateur Chromium, tailles ordinateur 1440×932, Pixel 6
412×915 et iPhone 15 393×852 ; réponses de progression simulées dans le navigateur,
base et API locales pour les tests serveur. Ce n’est pas un nouveau traitement IA
live, ni un test Safari/Firefox sur téléphone physique. Le code frontend/backend
métier est inchangé depuis les images qualifiées issues de `aebc87f` ; seuls tests,
recettes futures et documentation ont changé. La réserve du runner live reste
visible dans les preuves historiques, complétée par cette qualification isolée.

## Résultats finaux

- **6 tests backend réussis** avec détecteur de courses et PostgreSQL synthétique.
- **14 scénarios navigateur réussis** : 11 scénarios existants au premier passage,
  puis les 3 nouveaux scénarios de verrouillage après correction du sélecteur.
- Build TypeScript/Vite réussi ; **8 tests de contrat des recettes réussis**.
- Candidate, sept phases et copie active : **9 validate/plan réussis**, sans deploy.
- Contrôle final : révision privée inchangée, **six services prêts**. Les seuls
  conteneurs/réseau créés pour les tests ont été retirés ; aucun volume réel touché.

## Rendu et SRT

Le regroupement des petits sous-titres du desktop est déjà porté pour le rendu
vidéo. Les tests vérifient la parité des seuils, les limites de durée/lecture,
les caractères Unicode, la non-mutation des segments et la conservation du SRT.
Les SRT gardent volontairement les cues originales pour le montage externe.
La séparation de « 45 » et « 000 euros » observée dans l’extrait reste une limite
de segmentation, sans changement automatique des textes/horodatages pour cet essai.
Le recouvrement de l’habillage d’origine en bas de vidéo reste également possible.
Ces limites sont distinctes d’un échec du pipeline ou d’une fuite entre comptes.
Aucun regroupement plus agressif ni promesse de traduction parfaite ajouté.

## Recette active et prévention d’une régression de déploiement

La copie suivie `web/deploy/preview/active-keycloak-private-20260928.yml` correspond
sémantiquement à `/var/lib/vps-keycloak-transition/06-private-worker.yml`.
`validate` et `plan` donnent la révision réelle `00305da3b4b44e06`, sans application.
La candidate et les sept phases reprennent maintenant la seule adaptation admin :
`KC_HOSTNAME_ADMIN=https://tarjama.runagen.com:9443`. Le contrat master est aligné.
Les sept comparaisons avec les overlays administrés réussissent ; images, volumes,
egress, secrets référencés et issuer de l’application n’ont pas changé.

Le générateur de transition refuse l’ancienne origine localhost. Il ne faut pas
rejouer une transition déjà réalisée, recréer le bootstrap, ou déployer la candidate
arrêtée sur l’application active. Les anciens reçus de validation restent conservés
comme historique ; les nouveaux reçus sont dans le dossier de preuve final.
La confidentialité du routage relève de l’Ansible administré, pas de ces recettes.

## Reproduction et preuves

```sh
make web-preopening-check
make web-keycloak-recipe-test
```

La cible métier utilise un projet Compose dédié `tarjama-preopening-check`, un
réseau interne, une base synthétique temporaire, aucune clé fournisseur ni volume
vivant. Elle supprime ses seuls conteneurs/réseau en sortie. Pour un contrôle ciblé :
`make web-preopening-check ARGS=correction-lock.spec.ts`.
Les commandes de test n’activent aucune recette VPS.

Journaux et captures : `web/.cache/preopening-check/` ; synthèse et preuves finales
versionnées dans `web/review/preopening-20260928/`. Le premier passage a détecté
une erreur du nouveau test, qui comptait le champ du titre parmi les sous-titres.
Sélecteur corrigé pour viser uniquement les champs Arabe/Français ; l’échec initial
et les captures/traces sont conservés. Aucun correctif métier n’était nécessaire.

## Suite à autoriser séparément

Pour une première ouverture limitée, les contrôles applicatifs ci-dessus complètent
le parcours réel déjà réussi. Pas besoin d’une nouvelle image pour ces tests.
L’administrateur doit réaliser les contrôles d’exposition décrits dans
[la passation actuelle](KEYCLOAK_ADMIN_HANDOFF.md) au moment de l’ouverture.
Les décisions sans SMTP/récupération automatique et sans sauvegarde hors VPS restent
inchangées. Ces choix et la qualification sur vidéo courte ne promettent ni une
capacité illimitée ni l’absence de toute erreur sur des contenus futurs.
