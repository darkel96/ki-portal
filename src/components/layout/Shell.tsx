import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router";
import { KiSchluessel, useKiModus } from "./KiSchluessel";
import { aktuellesKonto } from "@/lib/ki/auth";
import { KI_ZENTRAL } from "@/lib/ki/config";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function useSystemTheme() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const set = () => document.documentElement.classList.toggle("dark", mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);
}

export function Shell() {
  useSystemTheme();
  const loc = useLocation();
  const modus = useKiModus();
  const [konto, setKonto] = useState<string | null>(null);
  useEffect(() => { aktuellesKonto().then((k) => setKonto(k?.name ?? null)).catch(() => setKonto(null)); }, [loc.pathname]);
  const imBaukasten = loc.pathname.startsWith("/baukasten") || loc.pathname === "/neu";

  return (
    <div className="shell">
      <a href="#inhalt" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:px-3 focus:py-2">Zum Inhalt springen</a>
      <header className="top">
        <div className={`wrap top-in ${imBaukasten ? "wide" : ""}`}>
          <Link to="/" className="brand" viewTransition aria-label="KI-Hub, zur Übersicht">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <rect x="1" y="1" width="11" height="11" fill="var(--brand)" />
              <rect x="14" y="1" width="11" height="11" fill="var(--ink)" opacity=".82" />
              <rect x="1" y="14" width="11" height="11" fill="var(--ink)" opacity=".82" />
              <rect x="14" y="14" width="11" height="11" fill="var(--signal)" />
            </svg>
            <span translate="no">KI-Hub</span>
          </Link>
          <nav className="nav" aria-label="Hauptnavigation">
            <NavLink to="/" end viewTransition>Applikationen</NavLink>
            <NavLink to="/mein" viewTransition>Mein Hub</NavLink>
            <NavLink to="/baukasten" viewTransition>Baukasten</NavLink>
          </nav>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="ki-pill" data-modus={modus}>
                <i aria-hidden="true" />
                <span className="ki-pill-text">{modus === "copilot" ? (konto ? `Copilot, angemeldet als ${konto}` : "Copilot verbunden") : modus === "claude-test" ? "Testmodus mit Claude" : modus === "claude-api" ? "Claude (eigener Schlüssel)" : "KI-Simulation"}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 rounded-none text-sm leading-relaxed">
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
                </>
              ) : modus === "copilot" ? (
                <p>Alle Applikationen senden ihre Anfragen über die zentrale Azure-Anwendung an {KI_ZENTRAL.ziel}.{konto ? ` Angemeldet als ${konto}.` : ""}</p>
              ) : (
                <>
                  <p className="font-semibold">Keine KI angebunden</p>
                  <p className="mt-1.5 text-muted-foreground">Die zentrale KI-Anbindung ist in dieser Umgebung nicht eingerichtet. Applikationen zeigen deshalb die Anfrage, die sie an Microsoft 365 Copilot senden würden, statt einer Antwort.</p>
                  <KiSchluessel />
                </>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </header>
      <main id="inhalt" className={`wrap page ${imBaukasten ? "wide" : ""}`}>
        <Outlet />
      </main>
    </div>
  );
}
