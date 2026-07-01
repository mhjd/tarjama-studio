.PHONY: cli tui dev-api dev-api-reload dev-ui build-ui electron-build desktop-build desktop-dev npm-audit

cli:
	.venv-asr/bin/python scripts/ashrafent_cli.py $(ARGS)

tui:
	.venv-asr/bin/python scripts/ashrafent_cli.py tui

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

desktop-build:
	cd ui && npm run desktop:build

desktop-dev:
	cd ui && npm run desktop:dev

npm-audit:
	cd ui && npm audit --audit-level=high
