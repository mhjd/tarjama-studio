.PHONY: cli tui whisper-benchmark dev-api dev-api-reload dev-ui build-ui electron-build desktop-tools desktop-build desktop-package desktop-dist desktop-win-portable desktop-linux-appimage desktop-security-test desktop-windows-release desktop-linux-release desktop-release-checksums desktop-release desktop-dev npm-audit correction-skill-test

cli:
	.venv-asr/bin/python scripts/tarjama_cli.py $(ARGS)

tui:
	.venv-asr/bin/python scripts/tarjama_cli.py tui

whisper-benchmark:
	cd windows-whisper-benchmark && ../.venv-asr/bin/python benchmark_whisper_windows.py $(ARGS)

dev-api:
	.venv-app/bin/python scripts/serve_mvp.py

dev-api-reload:
	.venv-app/bin/uvicorn server.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir server

dev-ui:
	cd ui && npm run dev

build-ui:
	cd ui && npm run build

electron-build:
	cd ui && npm run electron:build

desktop-tools:
	cd ui && npm run desktop:tools

desktop-build:
	cd ui && npm run desktop:build

desktop-package:
	cd ui && HOME=../.electron-home ELECTRON_CACHE=../.electron-cache ELECTRON_GET_CACHE=../.electron-cache ELECTRON_BUILDER_CACHE=../.electron-builder-cache npm run desktop:package

desktop-dist:
	cd ui && HOME=../.electron-home ELECTRON_CACHE=../.electron-cache ELECTRON_GET_CACHE=../.electron-cache ELECTRON_BUILDER_CACHE=../.electron-builder-cache npm run desktop:dist

desktop-win-portable:
	cd ui && export HOME=$(CURDIR)/.electron-home ELECTRON_CACHE=$(CURDIR)/.electron-cache ELECTRON_GET_CACHE=$(CURDIR)/.electron-cache ELECTRON_BUILDER_CACHE=$(CURDIR)/.electron-builder-cache; npm run desktop:tools && npm run desktop:build && npx electron-builder --win portable --x64 --publish never

desktop-linux-appimage:
	cd ui && export HOME=$(CURDIR)/.electron-home ELECTRON_CACHE=$(CURDIR)/.electron-cache ELECTRON_GET_CACHE=$(CURDIR)/.electron-cache ELECTRON_BUILDER_CACHE=$(CURDIR)/.electron-builder-cache; npm run desktop:linux-appimage

desktop-security-test:
	cd ui && npm run security:test

desktop-windows-release:
	python3 scripts/publish_windows_release.py $(ARGS)

desktop-linux-release:
	python3 scripts/publish_linux_release.py $(ARGS)

desktop-release-checksums:
	python3 scripts/update_release_checksums.py

desktop-release:
	$(MAKE) desktop-security-test
	$(MAKE) desktop-windows-release
	$(MAKE) desktop-linux-release
	$(MAKE) desktop-release-checksums

desktop-dev:
	cd ui && npm run desktop:dev

npm-audit:
	cd ui && npm audit --audit-level=high

correction-skill-test:
	python3 -B -m unittest discover -s codex-skills/correct-tarjama-project/scripts -p 'test_*.py' -v

# Hosted app only. These do not invoke the obsolete FastAPI/desktop workflows.
.PHONY: web-tools web-deps web-test web-build web-dev web-dev-down web-config web-up web-down web-migrate web-backup web-import web-gc
web-tools:
	docker build -f web/deploy/Dockerfile.tools -t tarjama-web-tools:test web

web-deps:
	web/scripts/tools.sh go mod download
	web/scripts/tools.sh sh -c 'cd /work/web/frontend && npm ci && PLAYWRIGHT_BROWSERS_PATH=/work/web/.cache/playwright npx playwright install ffmpeg'

web-test: web-prompts-check
	web/scripts/test.sh

web-build: web-prompts-check
	web/scripts/tools.sh sh -c 'go build -o /work/web/.cache/tarjama ./cmd/tarjama && cd /work/web/frontend && npm run build'

.PHONY: references-import references-build references-test references-query
REFERENCE_CORPUS ?= data/reference_corpus/20260925-v2
references-import:
	python3 web/scripts/import_references.py --output "$(REFERENCE_CORPUS)"
references-build:
	web/scripts/tools.sh go build -o /work/web/.cache/references ./cmd/references
references-test:
	web/scripts/tools.sh go test ./internal/references ./internal/research
references-query: references-build
	web/.cache/references --corpus "$(REFERENCE_CORPUS)" $(ARGS)

.PHONY: quality-campaign quality-budget-test quality-arbitrate quality-prepare quality-sentence
quality-campaign:
	python3 web/review/quality-campaign-20260925/run.py $(ARGS)
quality-budget-test:
	python3 -m unittest discover -s web/review/quality-campaign-20260925 -p 'test_*.py'
quality-arbitrate:
	python3 web/review/quality-campaign-20260925/arbitrate.py $(ARGS)
quality-prepare:
	python3 web/review/quality-campaign-20260925/prepare.py $(ARGS)
quality-sentence:
	python3 web/review/quality-campaign-20260925/sentence.py $(ARGS)
.PHONY: quality-capability
quality-capability:
	python3 web/review/quality-campaign-20260925/capability.py $(ARGS)

WEB_ENV ?= web/deploy/.env
web-config:
	docker compose --env-file $(WEB_ENV) -f web/deploy/compose.yml config --quiet

web-dev:
	docker compose -f web/deploy/compose.dev.yml up --build -d

web-dev-down:
	docker compose -f web/deploy/compose.dev.yml down

# Prepared for a separate, explicitly authorized deployment. Never part of web-test.
web-up:
	@test "$(DEPLOY_AUTHORIZED)" = "yes" || (echo 'Mise en service non autorisée : fournir DEPLOY_AUTHORIZED=yes après instruction séparée.'; exit 1)
	docker compose --env-file web/deploy/.env -f web/deploy/compose.yml up --build -d

web-down:
	@test "$(DEPLOY_AUTHORIZED)" = "yes"
	docker compose --env-file web/deploy/.env -f web/deploy/compose.yml down

web-migrate:
	@test "$(DEPLOY_AUTHORIZED)" = "yes"
	docker compose --env-file web/deploy/.env -f web/deploy/compose.yml run --rm api migrate

web-backup:
	web/scripts/backup.sh "$(BACKUP_DIR)"

web-import:
	@test "$(DEPLOY_AUTHORIZED)" = "yes"
	docker compose --env-file web/deploy/.env -f web/deploy/compose.yml -f web/deploy/compose.import.yml run --rm api import $(ARGS)

web-gc:
	@test "$(DEPLOY_AUTHORIZED)" = "yes"
	docker compose --env-file web/deploy/.env -f web/deploy/compose.yml run --rm api gc

.PHONY: web-images web-api-image web-audit
.PHONY: web-mobile-player-review
web-mobile-player-review:
	sh web/scripts/mobile-player-review.sh

.PHONY: web-preopening-check
web-preopening-check:
	sh web/scripts/preopening-check.sh $(ARGS)

.PHONY: web-llm-reliability-audit
web-llm-reliability-audit:
	sh web/scripts/llm-reliability-audit.sh

web-api-image: web-prompts-check
	docker build --platform linux/amd64 --label org.opencontainers.image.revision=$$(git rev-parse HEAD) -f web/deploy/Dockerfile --target api -t tarjama-web:review web

.PHONY: web-worker-image
WORKER_IMAGE_TARGET ?= worker
WORKER_IMAGE_TAG ?= tarjama-worker:review
web-worker-image: web-prompts-check
	@set -eu; mkdir -p web/.cache; corpus_context=$$(mktemp -d web/.cache/reference-image.XXXXXX); \
	trap 'rm -rf "$$corpus_context"' EXIT; \
	cp "$(REFERENCE_CORPUS)/manifest.json" "$(REFERENCE_CORPUS)/entries.jsonl" "$(REFERENCE_CORPUS)/NOTICE.txt" "$(REFERENCE_CORPUS)/provenance.json" "$$corpus_context/"; \
	mkdir "$$corpus_context/originals"; cp "$(REFERENCE_CORPUS)/originals/HADITH_LICENSE" "$$corpus_context/originals/"; \
	chmod 755 "$$corpus_context"; chmod 444 "$$corpus_context"/*; \
	chmod 755 "$$corpus_context/originals"; chmod 444 "$$corpus_context/originals/HADITH_LICENSE"; \
	docker build --platform linux/amd64 --label org.opencontainers.image.revision=$$(git rev-parse HEAD) \
	  --build-context reference-corpus="$$corpus_context" -f web/deploy/Dockerfile --target "$(WORKER_IMAGE_TARGET)" -t "$(WORKER_IMAGE_TAG)" web

web-images: web-api-image
	docker build --platform linux/amd64 --label org.opencontainers.image.revision=$$(git rev-parse HEAD) -f web/deploy/Dockerfile --target media -t tarjama-media:review web

web-audit:
	web/scripts/tools.sh go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...
	web/scripts/tools.sh sh -c 'cd /work/web/frontend && npm audit --audit-level=high'

# Generic VPS broker. Rendering/validation/planning do not activate any service.
PREVIEW_INPUTS ?= web/deploy/preview/inputs.json
PREVIEW_FILE ?= deploy.preview.yml
PREVIEW_OUTPUT ?= web/deploy/preview/resolved.yml
PREVIEW_PHASE ?= stopped
.PHONY: web-preview-render web-preview-validate web-preview-plan web-preview-status web-preview-test
web-preview-render:
	python3 web/scripts/preview-render.py --inputs "$(PREVIEW_INPUTS)" --output "$(PREVIEW_OUTPUT)" --phase "$(PREVIEW_PHASE)"

web-preview-validate:
	vps-preview validate atelier --file "$(PREVIEW_FILE)"

web-preview-plan:
	vps-preview plan atelier --file "$(PREVIEW_FILE)"

web-preview-status:
	vps-preview status atelier

# Activation is explicit; use the reviewed active recipe, never the stopped default.
.PHONY: web-preview-deploy web-preview-run web-preview-check-image
web-preview-deploy:
	vps-preview deploy atelier --file "$(PREVIEW_FILE)"

PREVIEW_JOB ?= preview-check
web-preview-run:
	vps-preview run atelier "$(PREVIEW_JOB)"

web-preview-check-image: web-prompts-check
	docker build --platform linux/amd64 --target preview-check -f web/deploy/Dockerfile -t tarjama-preview-check:review web
	vps-preview image-import atelier --name web --image tarjama-preview-check:review

web-preview-test:
	python3 -B -m unittest discover -s web/scripts -p 'test_preview.py' -v

.PHONY: web-preview-db-test
web-preview-db-test:
	web/scripts/preview-db-test.sh

.PHONY: web-ghcr-test
web-ghcr-test:
	python3 -B -m unittest discover -s web/scripts -p 'test_ghcr.py' -v

# Imports register node-local images only; they do not start services or jobs.
.PHONY: web-preview-import
web-preview-import:
	vps-preview image-import atelier --name web --image tarjama-web:review
	vps-preview image-import atelier --name media --image tarjama-media:review

.PHONY: web-isolated-image-test
web-isolated-image-test:
	sh web/scripts/isolated-image-test.sh

# Dedicated private UI qualification images; never deploy them as the public web service.
.PHONY: web-review-images
web-review-images: web-prompts-check
	$(MAKE) web-worker-image WORKER_IMAGE_TARGET=ui-review WORKER_IMAGE_TAG=tarjama-ui-review:review
	docker build --platform linux/amd64 -f web/deploy/Dockerfile --target ui-recorder -t tarjama-ui-recorder:review web

.PHONY: web-text-benchmark-image
web-text-benchmark-image: web-prompts-check
	docker build --platform linux/amd64 -f web/deploy/Dockerfile --target text-benchmark -t tarjama-text-benchmark:review web

# Explicit inputs prevent reapplying historical production digests by accident.
.PHONY: web-review-prepare web-text-benchmark-prepare
web-review-prepare:
	python3 web/review/prepare.py --campaign "$(REVIEW_CAMPAIGN)" --base "$(REVIEW_BASE)" --review-image "$(REVIEW_IMAGE)" --recorder-image "$(RECORDER_IMAGE)" --run "$(REVIEW_RUN)" --output "$(REVIEW_RECIPE)" --video "$(REVIEW_VIDEO)" $(if $(REVIEW_DEVICE),--device "$(REVIEW_DEVICE)") $(if $(filter 1,$(REVIEW_RESUME)),--resume,) $(if $(filter 1,$(REVIEW_RETRY_FAILED)),--retry-failed,) $(if $(REVIEW_ARTIFACT_PREFIX),--artifact-prefix "$(REVIEW_ARTIFACT_PREFIX)") $(if $(REVIEW_WAIT_MINUTES),--wait-minutes "$(REVIEW_WAIT_MINUTES)")
web-text-benchmark-prepare:
	python3 web/review/translation-lite/prepare.py --base "$(REVIEW_BASE)" --image "$(BENCHMARK_IMAGE)" --run "$(REVIEW_RUN)" --output "$(REVIEW_RECIPE)"

# Six real paid calls maximum; requires the registered native OpenRouter key.
.PHONY: web-model-compare
web-model-compare:
	@test -n "$(BENCHMARK_OUTPUT)" || (echo 'Set a new BENCHMARK_OUTPUT directory'; exit 1)
	python3 -B web/review/model-comparison/run.py --output "$(BENCHMARK_OUTPUT)"

.PHONY: web-prompts-sync web-prompts-check
web-prompts-sync:
	python3 -B web/scripts/sync_translation_prompt.py
web-prompts-check:
	python3 -B web/scripts/sync_translation_prompt.py --check
	python3 -B -m unittest discover -s web/scripts -p test_translation_prompt.py -v

.PHONY: web-ui-release-build
# Keep the qualified runtime while the research backend remains a candidate.
web-ui-release-build:
	web/scripts/build-ui-release.sh

.PHONY: web-upload-release-build
# Qualified backend + the reviewed upload API fix, without activating research.
web-upload-release-build:
	python3 web/scripts/prepare-upload-release.py
	docker build --platform linux/amd64 --target upload-release -f "$$(cat web/.cache/upload-release-path)/web/Dockerfile" -t tarjama-web:upload-review "$$(cat web/.cache/upload-release-path)/web"

.PHONY: web-research-check-image web-research-check
web-research-check-image:
	docker build --platform linux/amd64 -f web/deploy/Dockerfile --target research-check -t tarjama-research-check:review web

# Explicit opt-in. Required environment variables name files, never secret values.
web-research-check:
	web/scripts/run-research-check.sh

# Paid, bounded comparison; no production model or deployment changes.
.PHONY: web-luna-compare web-luna-compare-test
web-luna-compare: web-prompts-check
	@test -n "$(BENCHMARK_OUTPUT)" || { echo 'Set BENCHMARK_OUTPUT to a new directory.' >&2; exit 1; }
	python3 -B web/review/luna-comparison/run.py --output "$(BENCHMARK_OUTPUT)" $(if $(filter 1,$(BENCHMARK_SPLIT)),--split-corpus,) $(if $(BENCHMARK_MODEL),--model "$(BENCHMARK_MODEL)",) $(if $(BENCHMARK_API),--api "$(BENCHMARK_API)",) $(if $(BENCHMARK_REASONING),--reasoning "$(BENCHMARK_REASONING)",) $(if $(BENCHMARK_CASE),--case "$(BENCHMARK_CASE)",) $(if $(BENCHMARK_CHUNK_MINUTES),--chunk-minutes "$(BENCHMARK_CHUNK_MINUTES)",) $(if $(BENCHMARK_TIMEOUT_SECONDS),--timeout-seconds "$(BENCHMARK_TIMEOUT_SECONDS)",) $(if $(filter 1,$(BENCHMARK_CONTINUITY)),--continuity,) $(if $(BENCHMARK_PROVIDER),--provider "$(BENCHMARK_PROVIDER)",) $(if $(filter 1,$(BENCHMARK_JSON_OBJECT)),--json-object,) $(if $(BENCHMARK_MAX_COMPLETION_PRICE),--max-completion-price "$(BENCHMARK_MAX_COMPLETION_PRICE)",) $(if $(filter 1,$(BENCHMARK_NO_OUTPUT_LIMIT)),--no-output-limit,)

web-luna-compare-test: web-prompts-check
	python3 -B -m unittest discover -s web/review/luna-comparison -p 'test_*.py'

.PHONY: web-media-diagnostic-image
web-media-diagnostic-image:
	docker build --platform linux/amd64 -f web/deploy/Dockerfile --target media-diagnostic -t tarjama-media-diagnostic:review web

BENCHMARK_PART ?= 2
.PHONY: web-luna-recover
web-luna-recover:
	@test -n "$(BENCHMARK_OUTPUT)" || (echo 'Set a new BENCHMARK_OUTPUT directory'; exit 1)
	python3 -B web/review/luna-comparison/recover.py --part "$(BENCHMARK_PART)" --output "$(BENCHMARK_OUTPUT)"

.PHONY: web-luna-review
web-luna-review:
	@test -n "$(BENCHMARK_OUTPUT)" || (echo 'BENCHMARK_OUTPUT is required'; exit 1)
	python3 -B web/review/luna-comparison/review.py --output "$(BENCHMARK_OUTPUT)" $(if $(BENCHMARK_MODEL),--model "$(BENCHMARK_MODEL)",) $(if $(filter 1,$(BENCHMARK_NO_OUTPUT_LIMIT)),--no-output-limit,) $(if $(BENCHMARK_REASONING),--reasoning "$(BENCHMARK_REASONING)",) $(if $(BENCHMARK_PROMPT_VERSION),--prompt-version "$(BENCHMARK_PROMPT_VERSION)",)

.PHONY: web-gemini-lite-benchmark web-gemini-lite-benchmark-check
web-gemini-lite-benchmark: web-prompts-check
	python3 -B web/review/luna-comparison/gemini_lite.py

web-gemini-lite-benchmark-check: web-luna-compare-test
	python3 -B web/review/luna-comparison/gemini_lite.py --dry-run

.PHONY: web-lite-vs-luna
web-lite-vs-luna: web-prompts-check
	@test -n "$(BENCHMARK_OUTPUT)" || { echo 'Set BENCHMARK_OUTPUT to a new directory.' >&2; exit 1; }
	python3 -B web/review/luna-comparison/lite_vs_luna.py --output "$(BENCHMARK_OUTPUT)" $(if $(BENCHMARK_CANDIDATE),--candidate "$(BENCHMARK_CANDIDATE)",)

.PHONY: web-media-performance
# Offline, bounded FFmpeg measurements; optional authorized local MP4 sample.
web-media-performance:
	python3 web/scripts/media-performance.py $(if $(MEDIA_BENCH_SOURCE),--source "$(MEDIA_BENCH_SOURCE)")

.PHONY: web-keycloak-image web-keycloak-test web-keycloak-recipe web-identity-link
web-keycloak-image:
	docker build --platform linux/amd64 --label org.opencontainers.image.revision=$$(git rev-parse HEAD) -f web/deploy/keycloak/Dockerfile -t tarjama-keycloak:review web/deploy/keycloak
web-keycloak-test: web-keycloak-image
	sh web/scripts/keycloak-test.sh
web-keycloak-recipe:
	python3 web/scripts/keycloak-recipe.py $(ARGS)
# Dry run by default. Explicit --apply is required in ARGS for an authorized mapping.
web-identity-link:
	web/.cache/tarjama identity-link $(ARGS)

.PHONY: web-keycloak-source-test web-keycloak-recipe-test
# No build/import: current entrypoint mounted into the previously cached runtime.
web-keycloak-source-test:
	KEYCLOAK_SOURCE_TEST=1 sh web/scripts/keycloak-test.sh
web-keycloak-recipe-test:
	python3 -m unittest discover -s web/keycloak-tests -p 'test_*.py'

.PHONY: web-keycloak-transition web-keycloak-transition-test
web-keycloak-transition:
	python3 web/scripts/keycloak-transition.py $(ARGS)
web-keycloak-transition-test:
	python3 -m unittest discover -s web/keycloak-tests -p 'test_transition.py'

.PHONY: web-keycloak-theme-test
# Real Keycloak/OIDC with disposable accounts; no public ports or provider calls.
web-keycloak-theme-test: web-keycloak-image
	KEYCLOAK_THEME_TEST=1 sh web/scripts/keycloak-test.sh
.PHONY: web-keycloak-theme-gallery
web-keycloak-theme-gallery:
	python3 web/scripts/keycloak-theme-gallery.py web/.cache/keycloak-test/preview

.PHONY: web-keycloak-profile-prepare
# Offline only: make web-keycloak-profile-prepare < profile-before.json > profile-after.json
web-keycloak-profile-prepare:
	@python3 web/scripts/keycloak-user-profile.py
