# Redéploiement du 26 septembre — noms de téléchargement

Sur instruction explicite « okay redéploie », la version API `d42189b` a été
construite localement, importée et déployée sur `atelier` à16:10UTC.

- URL : https://atelier.preview.runagen.com
- Révision : `34008606bc133fc5`.
- Recette : `web/deploy/preview/active-export-filename-20260926.yml`.
- Image API : `preview.local/atelier/web@sha256:6e4bc5fd94876c568ff58c5275830a9b9aa3ff35ef1aa54eac776db667af7efb`.
- Révision précédente compatible pour rollback : `5dcf2e33fbe5a269`.

Les exports prennent désormais le titre actuel du projet comme nom proposé au
navigateur, en conservant accents/arabe et en retirant les caractères incompatibles.
Cela vaut aussi pour les exports déjà générés : aucun nouveau rendu nécessaire.
Tests HTTP avec PostgreSQL isolé réussis sur titre Unicode, renommage, Range206,
accès interdit à un autre compte et export inachevé. Voir
[le changement et ses preuves](EXPORT_FILENAME_20260926.md).

Sauvegarde préalable réussie `pv-job-backup-ff87fec6` :
`/storage/backups/pre-reliability-20260926T160851Z.dump`, SHA256
`b662fe21977c604f9473621d0cb33b56f3ee753e9cc926907bd588bc088e69b1`.
Aucune migration nécessaire ni exécutée : schéma inchangé.

`validate` et `plan` réussis ; déploiement accepté puis quatre services prêts
(web, worker, PostgreSQL, egress). Service privé de revue toujours arrêté.
Qualification réelle `pv-job-preview-check-88dba1eb` réussie : HTTP/readiness,
démarrage OIDC/PKCE/cookies, limites d'en-têtes SSO, HTTPS/passerelle. Pas de test
MFA ou de téléchargement authentifié dans un navigateur propriétaire pendant
ce redéploiement. Pas de requête LLM ou de nouvelle génération de vidéo.

Les preuves sont sous `web/deploy/preview/evidence/export-filename-20260926/`.

## Optimisations média : activation séparée toujours nécessaire

Le binaire API contient le code du dépôt, mais il n'exécute pas FFmpeg. Les
profils du courtier `tarjama-normalize-v1` et `tarjama-export-v1` gardent leurs
images enregistrées indépendamment des déploiements de la recette. Le skill et
le catalogue consultés lors de cette intervention n'ajoutent aucun droit de
remplacement de ces profils ; aucun nouveau retour administrateur ne confirme
leur mise à jour. **Ne pas annoncer les optimisations ni 4CPU activés.**

Le [dossier administrateur](MEDIA_OPTIMIZATION_ADMIN_20260926.md) fournit l'image
Docker immuable, le commit testé, la proposition à2CPU puis4CPU, les limites et
le retour arrière. Il reste à faire appliquer/qualifier ce remplacement par
l'administrateur. L'image média candidate est déjà construite et testée ; rien
ne justifie un nouveau redéploiement applicatif pour ce seul remplacement.
