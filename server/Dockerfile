# KI-Hub mit Hub-Dienst als ein Container: baut den Hub (statisch) und den Dienst, liefert beides auf Port 8787 aus.
# Bauen aus dem Hauptverzeichnis des Repositories:  docker build -f server/Dockerfile -t ki-hub .
FROM node:24-alpine AS bauen
WORKDIR /app
COPY package.json package-lock.json .nvmrc ./
RUN npm ci
COPY . .
# Verbindungsdaten des Hubs (siehe .env.example); sie werden in die statischen Dateien gebaut
ARG VITE_ENTRA_CLIENT_ID=
ARG VITE_ENTRA_TENANT_ID=
ARG VITE_GRAPH_SCOPES=
ARG VITE_ADMINS=dario.keller@koerber.com
ARG VITE_SP_ORDNER_URL=
ENV VITE_ENTRA_CLIENT_ID=$VITE_ENTRA_CLIENT_ID VITE_ENTRA_TENANT_ID=$VITE_ENTRA_TENANT_ID VITE_GRAPH_SCOPES=$VITE_GRAPH_SCOPES VITE_ADMINS=$VITE_ADMINS VITE_SP_ORDNER_URL=$VITE_SP_ORDNER_URL
# Normaler Build, nicht build:pages: Der Dienst liefert jeden Pfad ohne Endung als App aus, deshalb gehen saubere
# Adressen ohne „#“ (z. B. /cra-experte) und feste Pfade ab „/“
RUN npm run build && npm run build:server
# Git-Speicher wie in .github/workflows/pages.yml: Hub-Daten aus dem Repository (lesen für alle, schreiben mit Token)
ARG HUB_GIT_REPO=
ARG HUB_GIT_BRANCH=main
RUN if [ -n "$HUB_GIT_REPO" ]; then node -e ' \
      const fs = require("fs"); \
      const p = "dist/hub-config.json"; \
      const k = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {}; \
      k.speicher = { ...(k.speicher || {}), git: { repo: process.env.HUB_GIT_REPO, branch: process.env.HUB_GIT_BRANCH || "main", pfad: "public/hub-daten" } }; \
      fs.writeFileSync(p, JSON.stringify(k, null, 2) + "\n"); \
    '; fi

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HUB_PORT=8787 HUB_DATEN=/daten HUB_STATISCH=/app/dist
COPY --from=bauen /app/server/dist ./server/dist
COPY --from=bauen /app/dist ./dist
# pdf.js für PDFs auf dem Netzlaufwerk (lädt seinen Worker aus dem eigenen Paket, deshalb nicht im Bündel)
COPY --from=bauen /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist
# Chromium zeichnet Diagramme (Mermaid, SVG) als Bild für Mail und Teams; ohne bleiben sie Quelltext (HUB_CHROMIUM=aus)
RUN apk add --no-cache chromium font-dejavu
RUN mkdir -p /daten && chown node:node /daten
VOLUME /daten
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/dienst > /dev/null || exit 1
CMD ["node", "server/dist/index.mjs"]
