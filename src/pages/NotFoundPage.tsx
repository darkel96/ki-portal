import { useEffect } from "react";
import { Link, useRouteError } from "react-router";
import { istVersionsFehler, neuLadenFuerNeueVersion } from "@/lib/neueVersion";

export function NotFoundPage() {
  useEffect(() => { document.title = "Seite nicht gefunden – KI-Hub"; }, []);
  return (
    <section className="hero hero-meldung">
      <div className="hero-text">
        <p className="eyebrow">Seite nicht gefunden</p>
        <h1>Diese Adresse gibt es im KI-Hub nicht.</h1>
        <p className="lede">Vielleicht wurde die Applikation gelöscht oder umbenannt. In der Übersicht findest du alle Applikationen.</p>
        <p className="hero-links"><Link className="link-back" to="/" viewTransition>Zur Übersicht</Link></p>
      </div>
    </section>
  );
}

/** Unerwarteter Fehler in einer Seite: verständlich erklären statt Entwickler-Meldung. */
export function FehlerPage() {
  const err = useRouteError();
  const text = err instanceof Error ? err.message : String(err ?? "");
  const neu = istVersionsFehler(err);
  useEffect(() => { if (neu) neuLadenFuerNeueVersion(); }, [neu]);
  if (neu) return (
    <main className="wrap page">
      <section className="hero hero-meldung">
        <div className="hero-text">
          <p className="eyebrow">Neue Version</p>
          <h1>Der KI-Hub wurde aktualisiert.</h1>
          <p className="lede">Dieser Tab war noch mit der vorigen Version geöffnet. Lade die Seite einmal neu, dann geht es weiter.</p>
          <p className="hero-links"><button type="button" className="link-back" onClick={() => location.reload()}>Neu laden</button></p>
        </div>
      </section>
    </main>
  );
  return (
    <main className="wrap page">
      <section className="hero hero-meldung">
        <div className="hero-text">
          <p className="eyebrow">Unerwarteter Fehler</p>
          <h1>Diese Seite konnte nicht angezeigt werden.</h1>
          <p className="lede">Deine gespeicherten Applikationen und Ergebnisse sind davon nicht betroffen. Lade die Seite neu oder geh zurück zur Übersicht.</p>
          {text && <p className="hint" style={{ margin: 0 }}>Technischer Hinweis: {text}</p>}
          <p className="hero-links">
            <button type="button" className="link-back" onClick={() => location.reload()}>Neu laden</button>
            <Link className="link-back" to="/">Zur Übersicht</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
