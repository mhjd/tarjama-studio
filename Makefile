.PHONY: cli dev-api dev-api-reload dev-ui build-ui

cli:
	.venv-asr/bin/python scripts/ashrafent_cli.py $(ARGS)

dev-api:
	.venv-app/bin/python scripts/serve_mvp.py

dev-api-reload:
	.venv-app/bin/uvicorn server.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir server

dev-ui:
	cd ui && npm run dev

build-ui:
	cd ui && npm run build
