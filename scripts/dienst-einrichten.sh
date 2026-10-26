#!/usr/bin/env bash
# Richtet den Hub-Dienst auf dem Linux-Server ein oder bringt ihn auf den neuesten Stand. Aufruf im Hauptverzeichnis
# des Repositories:
#   bash scripts/dienst-einrichten.sh
# Was passiert: git pull, server/.env anlegen oder ergänzen (vorhandene Werte bleiben; der Clientschlüssel wird abgefragt,
# HUB_SCHLUESSEL erzeugt), Container bauen und starten, /api/dienst abwarten, letzte Protokollzeilen zeigen.
# Werte lassen sich vorab als Umgebungsvariablen mitgeben, z. B.  HUB_CLIENT_SECRET=… bash scripts/dienst-einrichten.sh
# Nur die Datei vorbereiten, ohne Docker:  DIENST_NUR_ENV=1 bash scripts/dienst-einrichten.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_DATEI=server/.env
BASIS=(docker compose)
command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || BASIS=(docker-compose)
COMPOSE=("${BASIS[@]}" -f server/docker-compose.yml)
# Läuft der Dienst schon, dann mit genau dem Projektnamen und den Compose-Dateien weiterarbeiten, mit denen er gestartet
# wurde (z. B. eigener Name, Override-Datei für den Proxy). Sonst entstünde ein zweiter Container mit leerem Datenvolume.
ORDNER="$(pwd)/server"
if command -v docker >/dev/null 2>&1; then
  BESTAND=$(docker ps -a --filter "label=com.docker.compose.project.working_dir=$ORDNER" \
    --format '{{.CreatedAt}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.project.config_files"}}' 2>/dev/null | sort | head -1 || true)
  if [ -n "$BESTAND" ]; then
    REST=${BESTAND#*|}; PROJEKT=${REST%%|*}; DATEIEN=${REST#*|}
    DATEI_ARGS=(); FEHLT=""
    IFS=',' read -ra LISTE <<< "$DATEIEN"
    for d in "${LISTE[@]}"; do [ -n "$d" ] || continue; [ -f "$d" ] || FEHLT="$d"; DATEI_ARGS+=(-f "$d"); done
    if [ -n "$PROJEKT" ] && [ -z "$FEHLT" ] && [ ${#DATEI_ARGS[@]} -gt 0 ]; then
      COMPOSE=("${BASIS[@]}" -p "$PROJEKT" "${DATEI_ARGS[@]}")
      echo "Laufender Dienst gefunden: Projekt „$PROJEKT“, Dateien ${DATEIEN//,/, }"
    elif [ -n "$FEHLT" ]; then
      echo "Der laufende Dienst wurde mit $FEHLT gestartet, die Datei gibt es nicht mehr. Abbruch, damit kein zweiter Container entsteht."
      exit 1
    fi
    ANDERE=$(docker ps -a --filter "label=com.docker.compose.project.working_dir=$ORDNER" --format '{{.Label "com.docker.compose.project"}}' | sort -u | grep -vx "$PROJEKT" || true)
    for a in $ANDERE; do
      echo "Hinweis: Projekt „$a“ läuft zusätzlich aus diesem Ordner. Entfernen mit:  ${BASIS[*]} -p $a -f server/docker-compose.yml down"
    done
  fi
fi

# Voreinstellungen für den KSCA-Hub; andere Tenants geben die Werte als Umgebungsvariablen mit
STANDARD_TENANT_ID=dca04e92-b0c8-46b4-9d33-f893be36d972
STANDARD_CLIENT_ID=b5904c66-6076-4b41-a5f4-be466e202eb2
STANDARD_URSPRUNG=https://darkel96.github.io
STANDARD_GIT_REPO=darkel96/ki-portal

wert() { # Wert eines Schlüssels aus der .env (ohne umschließende Anführungszeichen)
  [ -f "$ENV_DATEI" ] || return 0
  { grep -E "^[[:space:]]*$1[[:space:]]*=" "$ENV_DATEI" || true; } | tail -1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
setzen() { # Schlüssel setzen, wenn er fehlt oder leer ist; vorhandene Werte bleiben (drittes Argument "immer": überschreiben)
  local name=$1 neu=$2 alt
  alt=$(wert "$name")
  if [ -n "$alt" ] && [ "${3:-}" != "immer" ]; then echo "  $name bleibt wie in $ENV_DATEI"; return; fi
  [ -n "$neu" ] || return 0
  if grep -qE "^[[:space:]]*$name[[:space:]]*=" "$ENV_DATEI"; then
    # Die letzte Zeile mit dem Schlüssel zählt (so liest es auch Docker Compose); sie wird ersetzt
    python3 - "$ENV_DATEI" "$name" "$neu" <<'PY'
import re, sys
p, name, neu = sys.argv[1:]
zeilen = open(p, encoding="utf-8").read().split("\n")
treffer = [i for i, z in enumerate(zeilen) if re.match(r"^\s*" + re.escape(name) + r"\s*=", z)]
zeilen[treffer[-1]] = f"{name}={neu}"
open(p, "w", encoding="utf-8").write("\n".join(zeilen))
PY
  else
    printf '%s=%s\n' "$name" "$neu" >> "$ENV_DATEI"
  fi
  echo "  $name gesetzt"
}

echo "== Repository aktualisieren"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git pull --ff-only || echo "  git pull hat nicht geklappt (lokale Änderungen?), weiter mit dem vorhandenen Stand"
fi

echo "== $ENV_DATEI"
if [ ! -f "$ENV_DATEI" ]; then cp server/.env.example "$ENV_DATEI"; echo "  aus server/.env.example angelegt"; fi
chmod 600 "$ENV_DATEI"
TENANT=${HUB_TENANT_ID:-$STANDARD_TENANT_ID}
CLIENT=${HUB_CLIENT_ID:-$STANDARD_CLIENT_ID}
setzen HUB_TENANT_ID "$TENANT"
setzen HUB_CLIENT_ID "$CLIENT"
setzen HUB_URSPRUNG "${HUB_URSPRUNG:-$STANDARD_URSPRUNG}"
setzen HUB_GIT_REPO "${HUB_GIT_REPO:-$STANDARD_GIT_REPO}"
setzen VITE_ENTRA_CLIENT_ID "${VITE_ENTRA_CLIENT_ID:-$(wert HUB_CLIENT_ID)}"
setzen VITE_ENTRA_TENANT_ID "${VITE_ENTRA_TENANT_ID:-$(wert HUB_TENANT_ID)}"
setzen HUB_VERSION "$(git log -1 --format=%cd-%h --date=short 2>/dev/null || date +%F)" immer
if [ -z "$(wert HUB_SCHLUESSEL)" ]; then
  setzen HUB_SCHLUESSEL "${HUB_SCHLUESSEL:-$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
fi
if [ -z "$(wert HUB_CLIENT_SECRET)" ]; then
  if [ -n "${HUB_CLIENT_SECRET:-}" ]; then setzen HUB_CLIENT_SECRET "$HUB_CLIENT_SECRET"
  elif [ -t 0 ]; then
    echo "  Clientschlüssel der App-Registrierung (Azure: Zertifikate & Geheimnisse, oder Ausgabe von entra-einrichten.ps1 -Dienst):"
    read -rs -p "  HUB_CLIENT_SECRET: " GEHEIM; echo
    [ -n "$GEHEIM" ] || { echo "Ohne Clientschlüssel kann der Dienst sich nicht bei Microsoft anmelden. Abbruch."; exit 1; }
    setzen HUB_CLIENT_SECRET "$GEHEIM"
  else
    echo "HUB_CLIENT_SECRET fehlt in $ENV_DATEI. Eintragen oder als Umgebungsvariable mitgeben. Abbruch."; exit 1
  fi
fi
[ "${DIENST_NUR_ENV:-}" = "1" ] && { echo "Fertig (nur $ENV_DATEI vorbereitet)."; exit 0; }

echo "== Container bauen und starten"
"${COMPOSE[@]}" up -d --build

echo "== Warten auf den Dienst"
for i in $(seq 1 60); do
  # Im Container selbst fragen: Port 8787 auf dem Server kann zu einem anderen Container gehören oder gar nicht freigegeben sein
  if ANTWORT=$("${COMPOSE[@]}" exec -T ki-hub wget -qO- http://127.0.0.1:8787/api/dienst 2>/dev/null); then
    echo "  $ANTWORT"
    echo
    echo "Der Hub-Dienst läuft. Im Browser: Mein Hub öffnen, einen Auftrag mit „Jetzt ausführen“ starten, Tab schließen."
    echo "Protokoll mitlesen:  ${COMPOSE[*]} logs -f"
    exit 0
  fi
  sleep 2
done
echo "Der Dienst antwortet nach 2 Minuten nicht auf /api/dienst. Letzte Protokollzeilen:"
"${COMPOSE[@]}" logs --tail 40
exit 1
