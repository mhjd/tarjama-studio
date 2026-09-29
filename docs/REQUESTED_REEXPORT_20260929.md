# Export demandé par le propriétaire — 29 septembre 2026

Le propriétaire autorise le déploiement de `548fbf6`, puis un nouveau rendu de
son projet « Sirat un nabi episode 4 » afin d'évaluer le regroupement par paires.
Projet identifié par sa capture et le diagnostic historique d'export du
26 septembre : `2d15866edf3d955172ad22add35a7e91`.

## Tâche opérationnelle limitée

`web/deploy/maintenance/reexport.sql` et `reexport.sh` sont montés dans le job
explicite `requested-export`. Ils utilisent l'image PostgreSQL existante et le
rôle applicatif enregistré, avec connexion DB uniquement et lecture seule du
volume pour vérifier la présence du résultat. Ni session utilisateur forgée,
ni accès administrateur Keycloak, ni jeton Kubernetes, ni changement réseau.
Les opérations média restent exécutées par le worker et le courtier isolé.

Le job vérifie l'identifiant et l'URL source exacts, le projet non archivé,
la validation de la version courante, la traduction complète et l'absence de
tout traitement actif. Il reprend la dernière qualité française choisie sur
ce projet. Aucun changement du document projet ni approbation implicite.

Sous verrou de ligne du projet : une tâche d'export terminée de la version
courante est remise en file avec un nouvel essai média et les textes courants.
Si elle n'existe pas pour cette version, elle est créée. Les autres tâches restent
inchangées. L'incrément d'essai évite de réutiliser les sorties du courtier du
précédent rendu. Le worker garde sa publication atomique et ses contrôles de
version/génération. Aucun lancement transcription/correction/traduction.

**Commande ponctuelle : ne pas la relancer automatiquement.** Le moteur ne la
relance pas. Le script surveille pendant au plus 45 minutes ; à expiration de
ce délai, il laisse le traitement applicatif en cours. À réussite il vérifie
le MP4 non vide et l'empreinte des segments inchangée. Une modification manuelle
concurrente sera signalée, jamais écrasée.

Le job remplace temporairement la déclaration historique `reference-check`,
jamais un service ; backup, migrate et preview-check restent présents. Il ne
s'exécute pas au déploiement. L'ancienne déclaration reste versionnée dans la
recette précédente. Conserver l'authentification, le thème, l'egress et le routage
public de la recette courante.

## Qualification

```sh
make web-test-requested-reexport
```

PostgreSQL synthétique isolé sans réseau ni ports hôte. Vérifie la nouvelle
tentative, la qualité conservée, les documents inchangés (dont un autre compte),
le refus de source différente, de validation périmée, d'étape incorrecte et de
traitement actif, et la création d'une tâche pour une nouvelle version.
Preuves du déploiement et du traitement :
`web/review/deployment-export-pairs-20260929/`.

## Exécution en cours — ne pas relancer le job

Révision déployée `32eba7cc205e8816`, recette
`web/deploy/preview/active-export-pairs-20260929.yml`. Images :

- API `preview.local/atelier/web@sha256:a5b77b076cf175ed45e8df712320b8fdd23dd309fa3cd4d324d06e144a7cefd1`.
- Worker `preview.local/atelier/web@sha256:7b2f52d2d0e6eaba02fc08adbc02341ee045294a73a0e46107ea446810e4d4cd`.

Sauvegarde des deux bases `pv-job-backup-8da4d3c0` réussie avant déploiement.
Six services prêts et contrôle des assets/readiness/refus anonyme
`pv-job-preview-check-a84488db` réussi. Pas de migration ni changement de protection.

Job de supervision : **`pv-job-requested-export-b6eb3a0c`**.
Job applicatif : **`8be9cd4fb00f9880c7ad7011f1d46dd7`**.
Qualité réellement retrouvée : **High**, version des textes 6, génération 2.
Le traitement a quitté la file d'attente et est en cours. En cas d'interruption de
l'agent, reprendre uniquement `status` et `logs --component requested-export` ;
ne pas relancer la commande de création.

Le rendu sera disponible dans l'interface :
https://tarjama.runagen.com/projets/2d15866edf3d955172ad22add35a7e91/exporter
Authentification normale du propriétaire requise. Rétention export : 24 heures.

Retour arrière logiciel si nécessaire : `vps-preview rollback atelier --revision
2a740f0348a2bbab` après contrôle des images ; aucune restauration des bases.
Attendre la fin de l'export avant un redémarrage volontaire du worker.
