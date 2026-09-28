# Qualification métier privée après Keycloak — 28 septembre 2026

## Résultat actualisé : parcours réel réussi depuis le banc Mac

Cette section remplace le statut bloqué ci-dessous pour le **résultat métier**.
Le blocage réseau de codex reste en place ; le parcours a été réalisé par
l’administrateur depuis le Mac, puis les preuves existantes ont été examinées
sans relancer aucun traitement. Passation :
`/home/codex/.keycloak-business-admin-20260928/README.md` et `qualification.json`.
Le projet de test distinct et son compte sont conservés ; aucune donnée du
propriétaire modifiée par cette revue, aucune recette/protection modifiée.

| Contrôle | Résultat et portée |
| --- | --- |
| Import, transcription, correction, traduction, export High | Cinq jobs `succeeded` selon les preuves administrateur ; zéro retry manuel |
| Édition arabe puis rechargement | PASS du runner réel |
| Traduction conservée après rechargement | PASS du runner réel |
| MP4 téléchargé | 114,96 s, 1920 × 1080, H.264/AAC stéréo, 24 997 914 octets |
| Décodage complet / audio non silencieux | PASS administrateur, non répété par cette revue ; ne remplace pas une écoute humaine |
| Sous-titres français incrustés | Trois captures à 10, 57 et 105 s relues par l’agent projet ; textes visibles dans le cadre |
| Fichiers de preuve | 21 tailles et SHA256 revérifiés et conformes au manifeste |
| SRT arabe et français | 25 segments chacun, non vides, ordre chronologique sans chevauchement, mêmes timestamps, contenus dans la durée du MP4 |
| Verrouillage de saisie pendant correction | **Non confirmé** par le runner ; ne pas présenter ce critère comme validé |

Le premier runner a signalé FAIL **après** le téléchargement MP4 : son URL de
collecte SRT omettait `.srt?version=...`. La collecte seule a ensuite réussi
avec le contrat du frontend, sans nouveau job ni appel fournisseur. Conserver
ce FAIL historique avec le résultat consolidé ; ce n’est pas un échec du pipeline
IA ou de l’export vidéo.

Durées mesurées par le runner : attente jusqu’à correction disponible **132,219 s**,
traduction **12,522 s**, export **86,57 s**. La première mesure ne doit pas être
confondue avec la latence de l’appel LLM de correction (**19,191 s** dans le journal).

### Consommation observée

- Correction : **0,001236675 USD**, 4 434 tokens, un appel modèle.
- Traduction : **0,0010208 USD**, 4 684 tokens, un appel modèle.
- Total texte rapporté : **0,002257475 USD**, 9 118 tokens, deux appels.
- Transcription : coût non disponible. Solde global fournisseurs : inconnu.
- `billing_may_be_incomplete=false` pour les deux tentatives texte ;
  `web_calls=0` mais `web_usage_unknown=true` : conserver ces deux informations,
  ne pas convertir cette absence d’appels enregistrés en garantie de coût web nul.
- Revue des preuves par l’agent projet : aucun appel fournisseur supplémentaire.

### Réserves de qualité et portée

Le SRT français sépare « 45 » et « 000 euros. » entre les segments 16 et 17, à
01:12,200. La valeur totale correspond au texte arabe mais la lecture isolée de
ces sous-titres est mauvaise ; le découpage du montant reste à améliorer. Cette
observation porte sur le SRT, pas sur une inspection vidéo de cet instant.
À 105 s, les sous-titres incrustés recouvrent une partie du graphisme/texte original
en bas de l’image. Leur lisibilité est préservée, mais pas celle de tout l’habillage.

La comparaison textuelle de cet extrait d’actualité ne constitue pas une
certification linguistique ni une vérification de la transcription par écoute.
Le banc ne qualifie pas les téléphones, les vidéos longues, la recherche web
ou les outils de références religieuses. Aucun nouveau traitement lancé pour
compléter ces points dans cette revue.

Les fichiers sont déjà copiés hors du stockage soumis à l’expiration des exports
après 24 h, dans le dossier administrateur ci-dessus. Manifeste, qualification
consolidée et revue versionnés dans `web/review/keycloak-business-admin-20260928/`.
Les originaux, y compris `result.json`, sont conservés sans modification.
L’application reste privée ; ce PASS ne vaut pas autorisation d’ouverture publique.

## Historique : blocage initial de l’agent VPS

**Résultat : bloquée avant tout essai métier.** L’autorisation du propriétaire
couvre un essai court correction/traduction/export avec les crédits configurés.
Elle ne couvre pas l’ouverture publique ni la modification des protections.

## État vérifié

`LIVE_HANDOFF.md` lu intégralement, dernière section phase 06 faisant foi.
`vps-preview status atelier` confirme la révision `00305da3b4b44e06`, six services
prêts dont worker, review arrêté. Le dépôt reste sur `web-vps` ; aucun déploiement,
redémarrage, job, projet ou appel fournisseur lancé par cette qualification.

Les contrôles de connexion, données, isolation, médias et révocation décrits par
l’administrateur sont acquis ; ils ne constituent pas un test correction/traduction/
export. Le test UI local `web/frontend/tests/journey-record.spec.ts` utilise des
fixtures IA et un login de test : le lancer ne qualifierait pas la pile privée réelle.

La comparaison YAML avec `/var/lib/vps-keycloak-transition/06-private-worker.yml`
confirme un seul changement sémantique : `services.keycloak.env.KC_HOSTNAME_ADMIN`
vaut `https://tarjama.runagen.com:9443`, contre localhost dans la recette du dépôt.
Les recettes historiques ne doivent pas être redéployées sans intégrer cette
adaptation et préserver le filtrage privé administré. Aucun YAML modifié ici.

## Blocage reproductible

Depuis le compte codex du VPS, requêtes anonymes sans cookie ni valeur secrète :

```sh
curl --noproxy '*' --connect-timeout 5 --max-time 10 \
  --resolve tarjama.runagen.com:443:127.0.0.1 \
  --output /dev/null --silent --show-error \
  --write-out 'private_http=%{http_code}\n' https://tarjama.runagen.com/
```

Résultat : curl 7, connexion refusée, HTTP 000. Même résultat sans `--resolve`
vers l’adresse publique. Ce ne sont ni un échec de correction/traduction ni un
refus de compte : aucune requête HTTP n’a atteint le parcours applicatif.
Le garde UID sur loopback443 est signalé dans la passation administrateur ;
le résultat observé est cohérent avec ce filtrage, sans inspection/modification
du pare-feu. Le PASS depuis le Mac n’implique pas un accès depuis codex.

La coordination `discussion --compact list` échoue également :
`invalid_work_trace_layout: unexpected file type: /home/codex/.discussions/.namespace.lock`.
Aucun fichier de cet outil modifié, aucun message prétendu envoyé.

Preuve horodatée : `web/review/keycloak-business-*/result.json`.
Consommation de **cet essai** : zéro appel fournisseur, 0 USD. Solde de crédits
fournisseurs non consulté et inconnu ; cela ne signifie pas un solde nul.
Aucun mot de passe, cookie personnel, MFA ou secret fournisseur lu.

## Reprise à coordonner avec l’administrateur

Le chemin déjà qualifié passe par le Mac, un navigateur sandboxé et un transport
SSH privé limité au domaine. Fournir un moyen administré d’exécuter le scénario
métier par ce chemin, ou reprendre ce scénario depuis le banc Mac existant
`tests/keycloak_admin/live-browser.cjs`. Ne pas relâcher le garde UID, ouvrir les
routes au public, utiliser un conteneur privilégié ou créer une session directement
en base pour éviter le login. Ne pas réutiliser le profil/cookies personnels.

Scénario attendu sur un compte de qualification dédié :

1. Créer un projet neuf, nommé `Qualification privée Keycloak — court`, avec la
   vidéo arabe courte déjà retenue `https://www.youtube.com/watch?v=b1MKJ5gHig0`
   (environ 1 min 54 s). Si le compte a déjà cette source, choisir un compte dédié
   neuf plutôt que modifier ou supprimer le projet existant.
2. Effectuer import/transcription, attendre la correction complète ; vérifier que
   la saisie arabe reste inaccessible pendant le traitement, puis sauvegarder
   une correction contrôlée sans modifier les données du propriétaire.
3. Valider et traduire ; attendre l’achèvement et vérifier les textes, timestamps,
   remarques/sources disponibles, conservation après rechargement et accès aux étapes.
4. Valider et exporter en high ; télécharger le MP4 depuis l’interface sous un
   nom distinct, ainsi que les sous-titres. Vérifier lecture, durée, son et rendu
   des sous-titres au début, milieu et fin. Aucun PASS sur simple job créé.
5. Conserver rapport, captures/vidéo UI et fichiers téléchargés **avant 24 h**,
   avec noms/empreintes explicites, hors stockage soumis à l’expiration des exports.
   Garder les comptes/projets existants et leurs données intacts.
6. Relever durées et usages réellement disponibles : tokens/coût OpenRouter dans
   le journal des tentatives, usage transcription et recherches s’il est exposé.
   Distinguer montants connus et non disponibles, et solde global de coût du test.

Ne lancer qu’un parcours court, sans duplication ni retries manuels en boucle.
L’attente doit être bornée ; une interruption du runner ne doit pas déclencher
un autre projet ou de nouveaux appels. En cas d’échec, relever état/job/diagnostic
privé et signaler l’absence de résultat au lieu de conclure à une réussite.
L’application demeure privée pendant et après les essais.
