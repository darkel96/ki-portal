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
RUN npm run build:pages && npm run build:server

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HUB_PORT=8787 HUB_DATEN=/daten HUB_STATISCH=/app/dist
COPY --from=bauen /app/server/dist ./server/dist
COPY --from=bauen /app/dist ./dist
RUN mkdir -p /daten && chown node:node /daten
VOLUME /daten
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/dienst > /dev/null || exit 1
CMD ["node", "server/dist/index.mjs"]
