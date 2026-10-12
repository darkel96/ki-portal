import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { KoerberLogo } from "./KoerberLogo";
import { anmeldenWeiterleitung, anmeldungStart } from "@/lib/ki/auth";
import { copilotVerbindung } from "@/lib/ki/config";
import { copilotVorwaermen } from "@/lib/ki/copilot";

/** Merkt sich je Browsersitzung, dass die automatische Weiterleitung schon einmal versucht wurde (keine Schleife). */
const VERSUCHT = "kihub-sso-versucht";

type Stand = { art: "prueft" } | { art: "weiterleiten" } | { art: "angemeldet" } | { art: "maske"; fehler: string | null };

/**
 * Anmeldetor: Mit Copilot-Anbindung ist der Hub erst nach der Anmeldung mit dem Firmenkonto nutzbar.
 * Ablauf: still (Zwischenspeicher, Single Sign-on) → einmal automatisch zu Microsoft weiterleiten →
 * erst wenn das nicht reicht, eine Maske mit einem Knopf. Ohne Copilot-Anbindung (Simulation, Testmodus) kein Tor.
 */
export function Anmeldung({ aktiv, onAngemeldet, children }: { aktiv: boolean; onAngemeldet: () => void; children: ReactNode }) {
  const [stand, setStand] = useState<Stand>(aktiv ? { art: "prueft" } : { art: "angemeldet" });

  useEffect(() => {
    if (!aktiv) { setStand({ art: "angemeldet" }); return; }
    let aktuell = true;
    setStand({ art: "prueft" });
    (async () => {
      const { konto, fehler } = await anmeldungStart();
      if (!aktuell) return;
      if (konto) {
        sessionStorage.removeItem(VERSUCHT);
        setStand({ art: "angemeldet" });
        onAngemeldet();
        void copilotVorwaermen().catch(() => undefined);
        return;
      }
      // Fest eingerichtete Verbindung: einmal automatisch zu Microsoft, meist ohne jede Eingabe.
      // Eine im KI-Menü eingetragene Testverbindung leitet nie von selbst weiter.
      const automatisch = copilotVerbindung()?.quelle === "build" && !fehler && !sessionStorage.getItem(VERSUCHT);
      if (automatisch) {
        sessionStorage.setItem(VERSUCHT, "1");
        setStand({ art: "weiterleiten" });
        try { await anmeldenWeiterleitung(); return; } catch (e) { if (aktuell) setStand({ art: "maske", fehler: e instanceof Error ? e.message : String(e) }); return; }
      }
      setStand({ art: "maske", fehler });
    })().catch((e) => { if (aktuell) setStand({ art: "maske", fehler: e instanceof Error ? e.message : String(e) }); });
    return () => { aktuell = false; };
  }, [aktiv]); // eslint-disable-line react-hooks/exhaustive-deps

  if (stand.art === "angemeldet") return <>{children}</>;

  const anmelden = async () => {
    setStand({ art: "weiterleiten" });
    try { await anmeldenWeiterleitung(); }
    catch (e) { setStand({ art: "maske", fehler: e instanceof Error ? e.message : String(e) }); }
  };
  const v = copilotVerbindung();
  const technisch = stand.art === "maske" && stand.fehler && v?.quelle === "build";
  const code = stand.art === "maske" && stand.fehler ? /AADSTS\d+/.exec(stand.fehler)?.[0] : null;

  return (
    <section className="anmelden" aria-labelledby="anmelden-titel" aria-busy={stand.art !== "maske"}>
      <div className="anmelden-karte">
        <KoerberLogo className="anmelden-logo" />
        <p className="eyebrow">KI-Hub · KSCA</p>
        <h1 id="anmelden-titel">{stand.art === "maske" ? "Anmelden" : "Anmeldung läuft …"}</h1>
        {stand.art === "maske" ? (
          <>
            <p className="lede">Der KI-Hub nutzt Microsoft 365 Copilot mit deinem Firmenkonto. Melde dich einmal an, danach geht es automatisch.</p>
            {stand.fehler && (
              <p className="anmelden-fehler" role="alert">
                {technisch ? `Die Anmeldung hat nicht geklappt. Versuch es noch einmal; bleibt es dabei, wende dich an die IT${code ? ` (Code ${code})` : ""}.` : stand.fehler}
              </p>
            )}
            <div className="anmelden-aktionen">
              <Button className="rounded-full" size="lg" onClick={() => void anmelden()}>Mit Firmenkonto anmelden</Button>
              {technisch && <Button variant="ghost" className="rounded-full" onClick={() => navigator.clipboard.writeText(stand.fehler!).then(() => toast.success("Details kopiert. Schick sie an die IT."), () => toast.error("Kopieren nicht möglich."))}>Details für die IT kopieren</Button>}
            </div>
            <p className="hint">Du wirst zu Microsoft weitergeleitet und kommst danach hierher zurück. Kein Pop-up, kein zusätzliches Passwort, wenn du am Firmenrechner schon angemeldet bist.</p>
          </>
        ) : (
          <p className="lede" role="status">{stand.art === "weiterleiten" ? "Du wirst zu Microsoft weitergeleitet …" : "Dein Firmenkonto wird geprüft …"}</p>
        )}
      </div>
    </section>
  );
}
