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

# Install the backend and its dependencies into the environment, but keep the
# source tree in place: the app resolves data/ and frontend/dist via paths
# relative to the dryrun package source, so it must run from the repo layout.
COPY backend/ /app/backend/
RUN pip install --no-cache-dir -e /app/backend

# Built frontend, served by FastAPI from frontend/dist with SPA fallback.
COPY --from=frontend /app/frontend/dist /app/frontend/dist

# The synthetic population CSV is generated on startup if missing, so the
# image stays small and the data is reproducible from the fixed seed.

EXPOSE 8000
WORKDIR /app/backend
CMD ["uvicorn", "dryrun.api:app", "--host", "0.0.0.0", "--port", "8000"]
