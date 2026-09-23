# Qualification de l’aperçu privé — 23 septembre 2026

**État livré : aperçu actif, quatre services prêts, révision `1bf643edbce36753`.**
Pour l’essai utilisateur, ouvrir l’URL ci-dessous, se connecter avec son compte
habituel et son MFA, puis importer une petite vidéo ou coller un lien YouTube.
Le parcours authentifié dans le navigateur personnel est la prochaine vérification
humaine ; aucun second compte ni action administrateur n’est nécessaire à cet essai.

L’utilisateur a donné son autorisation distincte d’activation après la préparation
arrêtée. Le déploiement se fait exclusivement avec `vps-preview`, sur `atelier`,
à `https://atelier.preview.runagen.com`. Aucun changement de DNS, SSO, pare-feu,
seccomp/AppArmor, profil média administré ou publication GHCR.

## Déploiement

La branche `web-vps` a été vérifiée propre, récupérée et avancée uniquement en
fast-forward ; elle contient `183cf9b`. `main` reste inchangée. Les services et
les outils média utilisent les images applicatives de `f897ac6`, déjà importées
et testées ; leurs références restent dans `images.lock.json`. Le binaire API
et le frontend produits lors du build de qualification sont restés identiques
(couches Docker en cache).

1. Recette `bootstrap-20260923.yml`, DB seule : révision `3ddec7ef875f0a36`.
2. Job `bootstrap-db` : succès, rôle applicatif non superuser créé.
3. Job `migrate` : succès, schémas 001/002 appliqués explicitement.
4. Recette `active-20260923.yml` : révision `1bf643edbce36753`, quatre services
   prêts (API, worker, filtre egress, PostgreSQL).
5. Recettes de qualification : même code applicatif, ajout d’un job explicite.
   Les tâches ne partent jamais automatiquement. La base et ses migrations ont
   persisté après les remplacements de pods déclenchés par ces recettes.

La recette racine `deploy.preview.yml` reste volontairement **désactivée** : elle
constitue le rendu de préparation, pas la description de l’état actif.

## Essais réels

| Vérification | Résultat et portée |
| --- | --- |
| HTTP applicatif | `/readyz`204, interface200, API privée anonyme401, callback sans état400 |
| Début OIDC | Redirection vers l’issuer attendu, callback exact, PKCE S256, cookie Secure/HttpOnly/SameSite=Lax |
| Passerelle privée | HTTPS vérifié depuis le job K3s et chaîne de redirections vers Authelia réussie ; requête anonyme à la racine redirigée vers la connexion |
| Média isolé | Préparation et vérification d’une vidéo synthétique320 × 480, via HTTPS K3s→broker→outils `network none` |
| Résultats durables | Cache écrit/synchronisé sur PVC, empreintes vérifiées, ACK, relecture par une nouvelle instance de l’orchestrateur sans réexécution |
| Audio | Extraction FLAC de 1,234 s à partir de 123 ms ; limites temporelles conservées |
| Groq | Vrai appel `whisper-large-v3` accepté sur le signal synthétique ; aucune évaluation de qualité arabe à partir d’un son pur |
| Exports | Arabe/français × Low/High : les quatre combinaisons réussissent, avec vérification du média produit |
| YouTube/WARP | Vidéo publique courte `jNQXAC9IVRw` : téléchargement vidéo/audio, assemblage hors réseau, normalisation et vérification réussis |
| Nettoyage | Opérations acquittées/retirées, fichiers de test supprimés ; schéma SQL privé du test supprimé ; aucune donnée utilisateur utilisée |
| Gemini traduction | Vrai appel `gemini-3.8-flash` réussi, réponse structurée validée et identifiants de segments conservés |
| Gemini correction | Vrai appel réussi après un HTTP 503 et une reprise bornée ; aucun changement de modèle ou de clé |

Les logs bruts bornés et sans secrets sont dans
[`../deploy/preview/evidence/`](../deploy/preview/evidence/). Les premiers essais
ne sont pas maquillés en succès : le contrôle HTTP immédiat du premier job a échoué ; le contrôle de readiness
avec attente bornée a ensuite réussi après une seconde. Le
premier contrôle de passerelle attendait une redirection directe vers Authelia,
alors que la passerelle peut d’abord utiliser son propre chemin OAuth. La
qualification suit désormais au maximum cinq redirections HTTPS, limitées aux
deux domaines autorisés, sans afficher états ni cookies. Gemini a renvoyé des
erreurs temporaires, dont un HTTP 503 ; les essais suivants distinguent les
statuts et bornent les reprises en respectant `Retry-After`.

Le dernier job `pv-job-preview-check-e46f25a5` réussit ses contrôles ciblés
passerelle/correction. Les contrôles déjà réussis ne sont pas relancés inutilement :
les preuves médias/Groq/YouTube viennent du premier job, celles HTTP/OIDC et
traduction du second. Les échecs initiaux restent visibles dans les logs.
La recette active sans job de qualification a été réappliquée après ces essais ;
ni bootstrap ni migration n’ont été relancés. Les cinq tests du générateur de
recettes, la compilation de qualification et `go vet -tags preview_live ./...`
passent également. La suite applicative précédente (Go, build frontend et six
parcours Playwright mobiles) concernait le même code applicatif ; elle n’est pas
présentée comme relancée dans cette intervention.

## Reproduire les contrôles

L’image de qualification est distincte de celles des services et des profils
média. Elle ajoute un binaire de tests explicite, compilé avec le
tag `preview_live`, et une vidéo synthétique de trois secondes. Elle est
enregistrée sous un digest local ; voir `check-image.lock.json` et les empreintes
des sources. Ce code n’ajoute aucune route HTTP ni moyen de connexion à l’app.

```sh
make web-preview-check-image
# Reporter le digest réel dans preview-check.job.yml et une recette active
# de qualification ; conserver les images des services/profils déjà qualifiées.
make web-preview-validate PREVIEW_FILE=web/deploy/preview/qualification-20260923.yml
make web-preview-plan PREVIEW_FILE=web/deploy/preview/qualification-20260923.yml
make web-preview-deploy PREVIEW_FILE=web/deploy/preview/qualification-20260923.yml
make web-preview-run PREVIEW_JOB=preview-check
make web-preview-status
```

Le job ne reçoit ni secret OIDC, ni clé de chiffrement, ni credential Kubernetes
ou Docker. Il reçoit les références DB applicative, Gemini/Groq et broker
nécessaires à ses contrôles ; aucun secret ne va aux outils isolés. Il crée un
schéma SQL aléatoire indépendant de `public`, des fichiers synthétiques sous un
répertoire privé dédié du PVC, puis les retire. Le worker de production ne
consomme pas cette file de test. Les délais sont bornés, les empreintes contrôlées,
et le nettoyage attend l’état terminal des opérations avant suppression locale.
Un réessai de ce job consomme des appels fournisseurs et des identifiants broker :
ne pas l’exécuter en boucle.

## Limites de cette livraison

- Le parcours navigateur jusqu’à la session authentifiée nécessite le compte et
  le MFA du propriétaire. Il ne se déduit ni des redirections ni de la readiness.
  Le second compte reste volontairement désactivé ; la séparation entre deux
  identités OIDC réelles reste à vérifier. Les tests locaux avec deux identités
  de fixture ne constituent pas cette qualification réelle.
- Les six tests Playwright mobiles précédemment passés portent sur le même
  frontend, à 390 px. Le comportement dans le navigateur personnel, après MFA,
  reste à confirmer ; aucun résultat mobile réel n’est inventé.
- La préparation/export et la reprise utilisent le vrai broker et le vrai PVC,
  mais le test ne tue pas un worker de production en plein travail. Les tests
  automatisés de pertes de transfert, annulation et concurrence restent des
  preuves distinctes. Aucune garantie de publication métier « exactement une
  fois » n’est ajoutée.
- Une courte vidéo YouTube réussie ne garantit pas toutes les vidéos, les médias
  de 3 h/1 Gi ou l’acceptation future par YouTube. SSRF, TLS et WARP sans repli direct
  sont conservés ; la limite NetworkPolicy au démarrage du VPS n’est pas déclarée
  corrigée. Les outils restent isolés sans interface réseau externe.
- PVC 14 Gi + 2 Gi ne signifie pas 16 Gi physiquement réservés. Le disque avait environ
  16Gi disponibles après builds ; le broker conserve son seuil minimal de 8 Gi.
  Commencer avec de petites vidéos ; la capacité maximale n’est pas qualifiée.
- La restauration cohérente PostgreSQL+bibliothèque/cache+clé de chiffrement
  reste à qualifier sur le VPS. Le choix de sauvegarde OVH est conservé et sa
  fraîcheur n’a pas été vérifiée ici. Ne pas assimiler la persistance après
  remplacement des pods à une sauvegarde restaurable.
