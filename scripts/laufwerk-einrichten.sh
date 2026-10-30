#!/usr/bin/env bash
# Bindet ein Netzlaufwerk (Windows-Freigabe, z. B. Laufwerk Y:) schreibgeschützt auf dem Linux-Server ein und gibt es
# dem Hub-Dienst als Wissensquelle. Aufruf im Hauptverzeichnis des Repositories, mit Root-Rechten:
#   sudo bash scripts/laufwerk-einrichten.sh
# Was passiert: cifs-utils installieren (falls nötig), Anmeldedaten des Lesekontos in /etc/ki-hub/laufwerk.cred
# (nur für root lesbar), Eintrag in /etc/fstab (schreibgeschützt, bleibt nach Neustart), einbinden und prüfen,
# server/.env ergänzen (HUB_LAUFWERK, HUB_LAUFWERK_HOST, HUB_LAUFWERK_UNC, HUB_LAUFWERK_NAME), Dienst neu starten.
# Welche Ordner der Hub nutzt, legt danach die Verwaltung im Hub fest (Verwaltung → Netzlaufwerk).
# Werte lassen sich vorab mitgeben: LW_UNC='\\fs01\daten' LW_BENUTZER=svc-kihub LW_DOMAENE=KOERBER sudo -E bash …
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(id -u)" = "0" ] || { echo "Bitte mit sudo ausführen (Einbinden und /etc/fstab brauchen Root-Rechte)."; exit 1; }
ENV_DATEI=server/.env
[ -f "$ENV_DATEI" ] || { echo "$ENV_DATEI fehlt. Erst den Dienst einrichten: bash scripts/dienst-einrichten.sh"; exit 1; }

fragen() { # Variable, Frage, Vorgabe
  local var=$1 frage=$2 vorgabe=${3:-} wert=${!1:-}
  if [ -z "$wert" ]; then read -r -p "  $frage${vorgabe:+ [$vorgabe]}: " wert; wert=${wert:-$vorgabe}; fi
  printf -v "$var" '%s' "$wert"
}
echo "== Angaben zum Netzlaufwerk"
echo "  Den Pfad zeigt Windows im Explorer: Rechtsklick auf das Laufwerk → Eigenschaften (z. B. \\\\fs01\\daten)."
fragen LW_UNC "UNC-Pfad der Freigabe"
fragen LW_NAME "Anzeigename im Hub" "Laufwerk Y"
fragen LW_DOMAENE "Domäne des Lesekontos (z. B. KOERBER)"
fragen LW_BENUTZER "Benutzername des Lesekontos (ohne Domäne)"
if [ -z "${LW_PASSWORT:-}" ]; then read -rs -p "  Passwort des Lesekontos: " LW_PASSWORT; echo; fi
fragen LW_ZIEL "Einbindepunkt auf dem Server" "/mnt/laufwerk-y"
[ -n "$LW_UNC" ] && [ -n "$LW_BENUTZER" ] && [ -n "$LW_PASSWORT" ] || { echo "UNC-Pfad, Benutzer und Passwort sind nötig. Abbruch."; exit 1; }
# \\fs01\daten → //fs01/daten (Schreibweise von mount.cifs)
QUELLE=$(printf '%s' "$LW_UNC" | sed -e 's#\\#/#g' -e 's#^/*#//#')

echo "== cifs-utils"
if ! command -v mount.cifs >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then apt-get update -qq && apt-get install -y -qq cifs-utils
  elif command -v dnf >/dev/null 2>&1; then dnf install -y -q cifs-utils
  elif command -v yum >/dev/null 2>&1; then yum install -y -q cifs-utils
  else echo "Bitte cifs-utils installieren und das Skript erneut starten."; exit 1; fi
fi

echo "== Anmeldedaten und /etc/fstab"
mkdir -p /etc/ki-hub "$LW_ZIEL"
umask 077
printf 'username=%s\npassword=%s\ndomain=%s\n' "$LW_BENUTZER" "$LW_PASSWORT" "$LW_DOMAENE" > /etc/ki-hub/laufwerk.cred
chmod 600 /etc/ki-hub/laufwerk.cred
# uid/gid 1000 = Benutzer „node“ im Container; schreibgeschützt (ro, nur Lesen für Dateien und Ordner)
OPTIONEN="credentials=/etc/ki-hub/laufwerk.cred,ro,uid=1000,gid=1000,file_mode=0444,dir_mode=0555,iocharset=utf8,vers=3.0,_netdev,nofail"
ZEILE="$QUELLE $LW_ZIEL cifs $OPTIONEN 0 0"
grep -vE "[[:space:]]$(printf '%s' "$LW_ZIEL" | sed 's#/#\\/#g')[[:space:]]+cifs[[:space:]]" /etc/fstab > /etc/fstab.kihub || true
echo "$ZEILE" >> /etc/fstab.kihub
cp /etc/fstab /etc/fstab.vor-ki-hub
mv /etc/fstab.kihub /etc/fstab
echo "  Eintrag: $QUELLE → $LW_ZIEL (schreibgeschützt); Sicherung: /etc/fstab.vor-ki-hub"

echo "== Einbinden und prüfen"
mountpoint -q "$LW_ZIEL" && umount "$LW_ZIEL" || true
mount "$LW_ZIEL" || { echo "Einbinden fehlgeschlagen. Häufig: falsches Passwort, Domäne, Freigabename oder die Firewall (Port 445). Abbruch."; exit 1; }
ANZAHL=$(find "$LW_ZIEL" -maxdepth 1 -mindepth 1 2>/dev/null | wc -l)
echo "  eingebunden, $ANZAHL Einträge in der obersten Ebene"

echo "== $ENV_DATEI"
setzen() {
  local name=$1 neu=$2
  if grep -qE "^[[:space:]]*$name[[:space:]]*=" "$ENV_DATEI"; then
    python3 - "$ENV_DATEI" "$name" "$neu" <<'PY'
import re, sys
p, name, neu = sys.argv[1:]
zeilen = open(p, encoding="utf-8").read().split("\n")
treffer = [i for i, z in enumerate(zeilen) if re.match(r"^\s*" + re.escape(name) + r"\s*=", z)]
zeilen[treffer[-1]] = f"{name}={neu}"
open(p, "w", encoding="utf-8").write("\n".join(zeilen))
PY
  else printf '%s=%s\n' "$name" "$neu" >> "$ENV_DATEI"; fi
  echo "  $name gesetzt"
}
setzen HUB_LAUFWERK /laufwerk
setzen HUB_LAUFWERK_HOST "$LW_ZIEL"
setzen HUB_LAUFWERK_UNC "'$LW_UNC'"
setzen HUB_LAUFWERK_NAME "'$LW_NAME'"

echo "== Dienst neu starten"
bash scripts/dienst-einrichten.sh
echo
echo "Fertig. Im Hub unter Verwaltung → Netzlaufwerk die Ordner freigeben, die als Wissen dienen sollen."
