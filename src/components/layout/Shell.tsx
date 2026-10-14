import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router";
import { KoerberLogo } from "./KoerberLogo";
import { KiSchluessel, useKiModus } from "./KiSchluessel";
import { KiCopilotEinrichten, KiCopilotStatus } from "./KiCopilot";
import { useRechte } from "@/state/rechte";
import { aktuellesKonto } from "@/lib/ki/auth";
import { Anmeldung } from "./Anmeldung";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Initialen aus dem Anzeigenamen („Dario Keller“ → „DK“) */
const initialen = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((t) => t[0]!.toUpperCase()).join("");

export function Shell() {
  const loc = useLocation();
  const modus = useKiModus();
  const [konto, setKonto] = useState<string | null>(null);
  const rechte = useRechte();
  const kontoLaden = () => { aktuellesKonto().then((k) => setKonto(k?.name ?? null)).catch(() => setKonto(null)); void rechte.neuLaden(); };
  useEffect(kontoLaden, [loc.pathname, modus]);
  // Fenstertitel je Bereich; App-Seiten setzen ihren eigenen
  useEffect(() => {
    if (loc.pathname.startsWith("/app/")) return;
    const t = loc.pathname === "/" ? "Applikationen" : loc.pathname.startsWith("/mein") ? "Mein Hub" : loc.pathname.startsWith("/baukasten") ? "Baukasten" : loc.pathname === "/neu" ? "Neue Applikation" : loc.pathname === "/verwaltung" ? "Verwaltung" : "Seite nicht gefunden";
    document.title = `${t} – KI-Hub`;
  }, [loc.pathname]);
  const imBaukasten = loc.pathname.startsWith("/baukasten") || loc.pathname === "/neu";
  // Eine geöffnete Applikation gehört zur Übersicht: der Menüpunkt bleibt dort markiert
  const inUebersicht = loc.pathname === "/" || loc.pathname.startsWith("/app/");

  return (
    <div className="shell">
      <a href="#inhalt" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:px-3 focus:py-2">Zum Inhalt springen</a>
      <header className="top">
        <div className={`wrap top-in ${imBaukasten ? "wide" : ""}`}>
          <Link to="/" className="brand" viewTransition aria-label="KI-Hub, zur Übersicht">
            <KoerberLogo className="brand-logo" />
            <span className="brand-org" translate="no">KSCA</span>
          </Link>
          <nav className="nav" aria-label="Hauptnavigation">
            <Link to="/" viewTransition aria-current={inUebersicht ? "page" : undefined}>Applikationen</Link>
            <NavLink to="/mein" viewTransition>Mein Hub</NavLink>
            {rechte.darf("bauen") && <NavLink to="/baukasten" viewTransition>Baukasten</NavLink>}
            {rechte.istAdmin && rechte.ich && <NavLink to="/verwaltung" viewTransition>Verwaltung</NavLink>}
          </nav>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="ki-pill" data-modus={modus} data-angemeldet={modus === "copilot" && !konto ? "nein" : undefined}>
                {modus === "copilot" && konto ? <span className="ki-avatar" aria-hidden="true">{initialen(konto)}</span> : <i aria-hidden="true" />}
                <span className="ki-pill-text">{modus === "copilot" ? (konto ? `Copilot · ${konto}` : "Copilot · nicht angemeldet") : modus === "claude-test" ? "Testmodus mit Claude" : modus === "claude-api" ? "Claude (eigener Schlüssel)" : "KI-Simulation"}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-[80vh] w-80 overflow-y-auto text-sm leading-relaxed">
              {modus === "claude-test" ? (
                <>
                  <p className="font-semibold">Testmodus mit Claude</p>
                  <p className="mt-1.5 text-muted-foreground">Diese Testfassung läuft auf claude.ai. Statt Microsoft 365 Copilot beantwortet Claude die Anfragen, über dein Claude-Konto. Beim ersten KI-Aufruf fragt claude.ai einmal nach deiner Erlaubnis. Im Betrieb geht alles über die zentrale Azure-Anwendung an Copilot.</p>
                </>
              ) : modus === "claude-api" ? (
                <>
                  <p className="font-semibold">Testmodus mit Claude</p>
                  <p className="mt-1.5 text-muted-foreground">Statt Microsoft 365 Copilot beantwortet Claude (Opus 5.5) die Anfragen. Im Betrieb geht alles über die zentrale Azure-Anwendung an Copilot.</p>
                  <KiSchluessel />
                  <KiCopilotEinrichten />
                </>
              ) : modus === "copilot" ? (
                <>
                  <p className="font-semibold">Microsoft 365 Copilot</p>
                  <p className="mt-1.5 text-muted-foreground">Die Applikationen nutzen Copilot mit deinem Firmenkonto. Du siehst nur Ergebnisse aus Daten, auf die du ohnehin Zugriff hast.</p>
                  <KiCopilotStatus konto={konto} onKonto={kontoLaden} />
                </>
              ) : (
                <>
                  <p className="font-semibold">Keine KI angebunden</p>
                  <p className="mt-1.5 text-muted-foreground">Die zentrale KI-Anbindung ist in dieser Umgebung nicht eingerichtet. Applikationen zeigen deshalb die Anfrage, die sie an Microsoft 365 Copilot senden würden, statt einer Antwort.</p>
                  <KiSchluessel />
                  <KiCopilotEinrichten />
                </>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </header>
      <main id="inhalt" tabIndex={-1} className={`wrap page ${imBaukasten ? "wide" : ""}`}>
        <Anmeldung aktiv={modus === "copilot"} onAngemeldet={kontoLaden}>
          <Outlet />
        </Anmeldung>
      </main>
      <footer className="fuss">
        <div className={`wrap fuss-in ${imBaukasten ? "wide" : ""}`}>
          <span>{modus === "copilot" ? "Alle Applikationen laufen über Microsoft 365 Copilot." : modus === "simulation" ? "KI-Simulation: Anfragen werden angezeigt, nicht gesendet." : "Testmodus: Claude beantwortet die Anfragen."}</span>
          <span>KI-Hub · Pilot KSCA · Fragen an Dario Keller</span>
        </div>
      </footer>
    </div>
  );
}
