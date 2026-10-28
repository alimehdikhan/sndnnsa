# Backend needs Python 3.11 or newer. Override the interpreter with e.g. `make install PYTHON=python3.12`.
ifeq ($(OS),Windows_NT)
PYTHON ?= py -3
VENV_BIN := .venv/Scripts
else
PYTHON ?= python3
VENV_BIN := .venv/bin
endif

# Relative to backend/, since every backend recipe cd's there first.
VENV_PY := $(VENV_BIN)/python

.PHONY: install install-backend install-frontend \
        dev dev-backend dev-frontend \
        test test-backend test-frontend lint-backend e2e \
        refresh-data build serve up bench size lighthouse parity engine-fixture

install: install-backend install-frontend

install-backend:
	cd backend && $(PYTHON) -m venv .venv
	cd backend && $(VENV_PY) -m pip install --upgrade pip
	cd backend && $(VENV_PY) -m pip install -e ".[dev]"

install-frontend:
	cd frontend && npm install

# API on :8000, Vite on :5173. Vite proxies /api to the API.
dev:
	$(MAKE) -j2 dev-backend dev-frontend

dev-backend:
	cd backend && $(VENV_PY) -m uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

test: test-backend test-frontend

test-backend: lint-backend
	cd backend && $(VENV_PY) -m pytest

# ruff (lint + formatting) and mypy over the backend and the Vercel entry point.
lint-backend:
	cd backend && $(VENV_PY) -m ruff check . ../api && $(VENV_PY) -m ruff format --check . ../api && $(VENV_PY) -m mypy

# Type-check, lint, and the engine tests (the browser's selections and metrics
# against the backend's own answers, tests/fixtures/engine.json).
test-frontend:
	cd frontend && npm run typecheck && npm run lint && npm test

# The engine against every view the running API serves for the real data (make serve first).
parity:
	cd frontend && npm run parity

# Regenerate the engine fixture after changing selection, metrics or views.
engine-fixture:
	cd backend && $(VENV_PY) scripts/export_engine_fixture.py

# Playwright end-to-end tests in Chrome, against the production build (starts the API if needed).
e2e: build
	cd frontend && PYTHON=../backend/$(VENV_PY) npm run e2e

# Re-fetch wind actuals and forecasts from Elexon into backend/data/*.parquet.
refresh-data:
	cd backend && $(VENV_PY) -m app.ingest && $(VENV_PY) scripts/export_snapshot.py

# Production: build the frontend, then serve it and the API from one origin on :8000.
build:
	cd frontend && npm run build

serve: build
	cd backend && $(VENV_PY) -m uvicorn app.main:app --port 8000

# The whole app from the Docker image, on http://localhost:8000.
up:
	docker compose up --build

# p50/p95 response time per API route (50 requests each) against a running server.
bench:
	cd backend && $(VENV_PY) scripts/bench_api.py http://127.0.0.1:8000

# Fail if the initial JS exceeds the 180 KB gzipped budget (run after `make build`).
size:
	cd frontend && npm run size

# Lighthouse CI against a running `make serve`, with the same assertions as CI.
lighthouse:
	npx --yes @lhci/cli@0.15.x autorun --config=lighthouserc.json
