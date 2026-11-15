FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/app ./app
COPY data /app/data
COPY --from=web /web/dist /app/frontend/dist
# The Chrome add-on as a download, zipped from this build's own extension/ files.
COPY extension/manifest.json /tmp/kurt-extension/manifest.json
COPY extension/icons /tmp/kurt-extension/icons
COPY extension/src /tmp/kurt-extension/src
RUN python -c "import shutil; shutil.make_archive('/app/frontend/dist/kurt-extension', 'zip', '/tmp/kurt-extension')" && rm -r /tmp/kurt-extension
RUN useradd --system --uid 10001 app && mkdir /data && chown app /data
USER app
ENV PATH=/app/backend/.venv/bin:$PATH \
    SPAETKAUF_DB_PATH=/data/app.sqlite \
    SPAETKAUF_ODDS_PATH=/app/data/odds.sqlite \
    SPAETKAUF_HISTORY_PATH=/history/history.duckdb
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
