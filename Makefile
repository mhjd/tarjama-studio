.PHONY: cli tui dev-api dev-api-reload dev-ui build-ui electron-build desktop-tools desktop-build desktop-package desktop-dist desktop-win-portable windows-test-package desktop-dev npm-audit

cli:
	.venv-asr/bin/python scripts/tarjama_cli.py $(ARGS)

tui:
	.venv-asr/bin/python scripts/tarjama_cli.py tui

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

windows-test-package:
	python3 scripts/build_windows_test_package.py

desktop-dev:
	cd ui && npm run desktop:dev

npm-audit:
	cd ui && npm audit --audit-level=high
