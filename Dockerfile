# syntax=docker/dockerfile:1

# ---- Stage 1: build the React/Vite frontend ----
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Python runtime serving API + built frontend ----
FROM python:3.11-slim AS runtime
WORKDIR /app

# Source tree stays in place: the app resolves data/ and frontend/dist via
# paths relative to the dryrun package source, so it must run from the repo
# layout. This also brings in backend/data/patients.csv (shipped with the
# image; startup generation is only a fallback) and the uv lockfile.
COPY backend/ /app/backend/

# Install exactly the locked dependencies, then the package itself with no deps.
RUN pip install --no-cache-dir uv \
    && (cd /app/backend && uv export --frozen --no-dev --no-emit-project -o /tmp/req.txt) \
    && pip install --no-cache-dir -r /tmp/req.txt \
    && pip install --no-cache-dir --no-deps -e /app/backend

# Built frontend, served by FastAPI from frontend/dist.
COPY --from=frontend /app/frontend/dist /app/frontend/dist

EXPOSE 8000
WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn dryrun.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
