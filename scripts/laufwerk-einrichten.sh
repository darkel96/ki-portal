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
echo "  Lesekonto: so wie bei der Windows-Anmeldung, z. B. aberle-it\\dario.keller (cmd: whoami)"
fragen LW_BENUTZER "Benutzer (DOMÄNE\\name oder name@domäne)"
# Domäne aus „DOMÄNE\name“ oder „name@domäne“ abtrennen; sonst nachfragen
case "$LW_BENUTZER" in
  *\\*) LW_DOMAENE=${LW_DOMAENE:-${LW_BENUTZER%%\\*}}; LW_BENUTZER=${LW_BENUTZER#*\\} ;;
  *@*) LW_DOMAENE=${LW_DOMAENE:-${LW_BENUTZER#*@}}; LW_BENUTZER=${LW_BENUTZER%%@*} ;;
  *) fragen LW_DOMAENE "Domäne (z. B. aberle-it)" ;;
esac
echo "  Anmeldung als: ${LW_DOMAENE:+$LW_DOMAENE\\}$LW_BENUTZER"
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
{ printf 'username=%s\npassword=%s\n' "$LW_BENUTZER" "$LW_PASSWORT"; [ -n "$LW_DOMAENE" ] && printf 'domain=%s\n' "$LW_DOMAENE"; } > /etc/ki-hub/laufwerk.cred
chmod 600 /etc/ki-hub/laufwerk.cred
# uid/gid 1000 = Benutzer „node“ im Container; schreibgeschützt (ro, nur Lesen für Dateien und Ordner)
# Leerzeichen im Freigabenamen stehen in /etc/fstab als \040
QUELLE_FSTAB=$(printf '%s' "$QUELLE" | sed 's/ /\\040/g')
eintragen() { # SMB-Version → Eintrag in /etc/fstab
  local opt="credentials=/etc/ki-hub/laufwerk.cred,ro,uid=1000,gid=1000,file_mode=0444,dir_mode=0555,iocharset=utf8,vers=$1,_netdev,nofail"
  grep -vE "[[:space:]]$(printf '%s' "$LW_ZIEL" | sed 's#/#\\/#g')[[:space:]]+cifs[[:space:]]" /etc/fstab > /etc/fstab.kihub || true
  echo "$QUELLE_FSTAB $LW_ZIEL cifs $opt 0 0" >> /etc/fstab.kihub
  mv /etc/fstab.kihub /etc/fstab
  systemctl daemon-reload 2>/dev/null || true
}
[ -f /etc/fstab.vor-ki-hub ] || cp /etc/fstab /etc/fstab.vor-ki-hub
echo "  Sicherung der alten Datei: /etc/fstab.vor-ki-hub"

echo "== Einbinden und prüfen"
mountpoint -q "$LW_ZIEL" && umount "$LW_ZIEL" || true
OK=""
for v in 3.1.1 3.0 2.1; do
  eintragen "$v"
  if mount "$LW_ZIEL" 2>/tmp/ki-hub-mount.err; then OK=$v; break; fi
  # Anmeldung abgelehnt: eine andere SMB-Version hilft nicht
  grep -q "error(13)" /tmp/ki-hub-mount.err && break
done
if [ -z "$OK" ]; then
  cat /tmp/ki-hub-mount.err
  echo "  Letzte Meldungen des Systems:"; dmesg 2>/dev/null | grep -i cifs | tail -5 | sed 's/^/    /'
  if grep -q "error(13)" /tmp/ki-hub-mount.err; then
    echo "Anmeldung abgelehnt (Permission denied): Benutzer, Domäne oder Passwort prüfen. Angemeldet wurde als ${LW_DOMAENE:+$LW_DOMAENE\\}$LW_BENUTZER."
  else
    echo "Einbinden fehlgeschlagen: Server oder Freigabename prüfen ($QUELLE), und ob der Server Port 445 erreicht."
  fi
  echo "Skript einfach erneut starten; /etc/fstab wird dabei wieder richtig eingetragen."
  exit 1
fi
echo "  Eintrag in /etc/fstab: $QUELLE → $LW_ZIEL (schreibgeschützt, SMB $OK)"
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
