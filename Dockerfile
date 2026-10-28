# One image: Node builds the UI, then Python serves the UI and the API from one origin.
#
#   docker build -t gb-wind-forecast .
#   docker run --rm -p 8000:8000 gb-wind-forecast      # http://localhost:8000
#
# Hosts that set $PORT (Render, Railway, Fly, Cloud Run) are supported.

FROM node:24-slim AS ui
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app/backend
# Dependencies first, so code changes don't reinstall them.
COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install -e .
COPY backend/data ./data
COPY --from=ui /app/frontend/dist /app/frontend/dist

RUN useradd --create-home --uid 10001 app && chown -R app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:' + __import__('os').environ.get('PORT', '8000') + '/api/health')"
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
