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
