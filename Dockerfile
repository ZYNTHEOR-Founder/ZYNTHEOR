FROM node:22-bookworm-slim

ARG VITE_API_URL=
ENV NODE_ENV=production \
    PORT=8080 \
    VITE_API_URL=${VITE_API_URL} \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Reconcile the source lockfile in the image build; package-lock currently lacks the
# Capacitor packages declared in package.json. The regenerated lock is used in-image.
RUN npm install --include=dev --no-audit --no-fund

COPY requirements-native.txt requirements.txt ./
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
