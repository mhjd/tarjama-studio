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
	web/scripts/tools.sh sh -c 'cd /work/web/frontend && npm ci'

web-test:
	web/scripts/test.sh

web-build:
	web/scripts/tools.sh sh -c 'go build -o /work/web/.cache/tarjama ./cmd/tarjama && cd /work/web/frontend && npm run build'

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

.PHONY: web-images web-audit
web-images:
	docker build -f web/deploy/Dockerfile --target api -t tarjama-web:review web
	docker build -f web/deploy/Dockerfile --target media -t tarjama-media:review web

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

web-preview-test:
	python3 -B -m unittest discover -s web/scripts -p 'test_preview.py' -v

.PHONY: web-preview-db-test
web-preview-db-test:
	web/scripts/preview-db-test.sh

.PHONY: web-ghcr-test
web-ghcr-test:
	python3 -B -m unittest discover -s web/scripts -p 'test_ghcr.py' -v
