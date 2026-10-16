FROM node:24.20.0-bookworm-slim AS frontend
WORKDIR /build
COPY norte/package.json norte/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY norte/ ./
RUN VITE_BASE_PATH=/ npm run build

FROM node:24.20.0-bookworm-slim AS production-dependencies
WORKDIR /build
COPY norte/package.json norte/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24.20.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY . ./
# The requested validation deployment includes Quetzal by default. Public
# manufacturer references are pinned and downloaded only into this image.
# An explicit build argument of 0 still disables corpus provisioning.
ARG NORTE_DEMO_ACCOUNT=1
RUN if [ "$NORTE_DEMO_ACCOUNT" = "1" ]; then python3 scripts/provision_quetzal_demo.py --optional; fi
COPY --from=production-dependencies /build/node_modules ./norte/node_modules
COPY --from=frontend /build/dist ./norte/dist
RUN mkdir -p /app/.runtime && chown node:node /app/.runtime
ENV PATH="/opt/venv/bin:$PATH" NODE_ENV=production NORTE_API_HOST=0.0.0.0 NORTE_DEMO_ACCOUNT=${NORTE_DEMO_ACCOUNT} PORT=8000
USER node
EXPOSE 8000
CMD ["python3", "scripts/service.py", "serve"]
