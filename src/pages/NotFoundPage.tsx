import { Link, useRouteError } from "react-router";

export function NotFoundPage() {
  return (
    <section className="intro" style={{ gridTemplateColumns: "1fr" }}>
      <div>
        <span className="rubrik">Seite nicht gefunden</span>
        <h1>Diese Adresse gibt es im KI-Hub nicht.</h1>
        <p className="lede" style={{ marginTop: 16 }}>Vielleicht wurde die Applikation gelöscht oder umbenannt. In der Übersicht findest du alle Applikationen.</p>
        <p style={{ marginTop: 20 }}><Link className="link-back" to="/" viewTransition>Zur Übersicht</Link></p>
      </div>
    </section>
  );
}

/** Unerwarteter Fehler in einer Seite: verständlich erklären statt Entwickler-Meldung. */
export function FehlerPage() {
  const err = useRouteError();
  const text = err instanceof Error ? err.message : String(err ?? "");
  return (
    <main className="wrap page">
      <section className="intro" style={{ gridTemplateColumns: "1fr" }}>
        <div>
          <span className="rubrik">Unerwarteter Fehler</span>
          <h1>Diese Seite konnte nicht angezeigt werden.</h1>
          <p className="lede" style={{ marginTop: 16 }}>Deine gespeicherten Applikationen und Ergebnisse sind davon nicht betroffen. Lade die Seite neu oder geh zurück zur Übersicht.</p>
          {text && <p className="hint" style={{ marginTop: 12 }}>Technischer Hinweis: {text}</p>}
          <p style={{ marginTop: 20, display: "flex", gap: 16 }}>
            <a className="link-back" href="/" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>Neu laden</a>
            <Link className="link-back" to="/">Zur Übersicht</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
