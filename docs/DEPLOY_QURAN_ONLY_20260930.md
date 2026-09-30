# Déploiement : outils religieux limités au Coran

Déploiement explicitement autorisé le 30 septembre 2026 après le changement
`0e46f0b`. URL publique : https://tarjama.runagen.com.
Recette : `web/deploy/preview/active-quran-only-20260930.yml`.
Révision : **4105dbd09a487ec3**.

## Périmètre

Seul `quran_fr` est annoncé et accepté par le worker. `sahih_ar` et `hadith_ar`
sont retirés de la liste et refusés à l'exécution. Corpus et consultation hors
ligne conservés. Prompt `translation-parallel-v5-quran-only`, commun desktop/web :
pas de nouvelles références de hadith ni de recherche web de remplacement ;
les indications prononcées restent traduites. Parallel reste actif pour les
recherches générales. Aucun retrait ni recalcul des traductions existantes.

Comparaison structurée avec `active-inline-references-20260930.yml` : seules les
images web/worker/qualification et la sélection des tests de qualification
changent. Frontend identique. Keycloak/thème, administration privée 9443, egress,
volumes, secrets référencés et protections conservés. Aucune migration ou tâche
`requested-export` lancée.

## Images importées en série

- API : `preview.local/atelier/web@sha256:5e23837ca9af93b8fcd1e50cd0f4181cd008315844b66a2efeaa1c00df3b6d3f`
- Worker : `preview.local/atelier/web@sha256:059b32d19961adcc76ddcfa8c65fea2990249b94fd56f5fae2f1fca4cac1466a`
- Qualification : `preview.local/atelier/web@sha256:5b16adc741cd8c43bdd80bd8d6feb03d689d277c1fc88a824f3fae49c3bc1466`

Environ 21 Gio libres sur 96 Gio après construction. Aucun nettoyage global.
Les services inchangés utilisaient déjà leurs images avant déploiement ; tous
les services sont revenus prêts après réconciliation.

## Vérifications

Tests Go references/research/studio et parité des prompts réussis avant build.
Liste des outils vérifiée dans l'image worker, en conteneur local sans réseau :
un seul outil `quran_fr`. `validate` et `plan` réussis.

Sauvegarde des bases application et Keycloak `pv-job-backup-47cd6f00` réussie,
avec lecture des catalogues des dumps et empreintes, avant déploiement. Aucune
nouvelle qualification de restauration ou copie hors VPS.

Six services prêts. Le démarrage web a rencontré une découverte OIDC indisponible
pendant le démarrage Keycloak, puis est reparti automatiquement ; l'API s'annonce
prête à 13:58:23 UTC. Le worker journalise `Local reference corpus loaded: tools=1`.

Le job `pv-job-preview-check-04d7b2c6` est terminé avec succès : six tests PASS.
Le contrôle après déploiement couvre les fichiers frontend attendus, le refus
d'accès anonyme aux projets, le rendu S1 et le nouveau prompt via un fournisseur
simulé. Aucun appel IA payant ni nouveau parcours navigateur réel depuis ce VPS.
Le test indépendant demandé au propriétaire couvre ce dernier volet, avec compte
neuf et parcours vidéo court. [Brief Mac](testing/INDEPENDENT_MAC_TEST.md).

Preuves d'exploitation : `web/.cache/quran-only-release-20260930/`.

## Retour arrière

Révision précédente : `39c36d771b5e1da9`. Vérifier les images avant
`vps-preview rollback atelier --revision 39c36d771b5e1da9`.
Aucune restauration SQL nécessaire pour ce changement ; un rollback ne réécrit
pas les traductions et réactive les anciennes consignes/outils de hadith.
