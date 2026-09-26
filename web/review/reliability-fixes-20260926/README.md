# Validation locale du 26 septembre 2026

- `make web-test` : succès, Go avec détection des courses, vet, build frontend,
  46 tests Playwright et sauvegarde/restauration PostgreSQL.
- `make web-llm-reliability-audit` : suites research/studio complètes relancées
  après les derniers ajustements, succès avec `-race`.
- `make web-build` : compilation finale Go et TypeScript/Vite réussie.
- `web/scripts/tools.sh go vet ./...` : succès sur le code final, aucune sortie.

Sur le VPS, make a été invoqué par `web/.cache/make`.
Fournisseurs simulés et base isolée ; aucun appel API payant ni déploiement.
Les IDs et projets visibles dans les journaux sont des fixtures éphémères.
Voir `docs/LLM_RELIABILITY_FIXES_20260926.md` pour les décisions et limites.
