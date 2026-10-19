/**
 * Sprechende Adresse je Applikation: „CRA-Experte“ ist unter „/cra-experte“ erreichbar. Die Adresse entsteht aus dem
 * Namen, die ID bleibt intern unverändert – gespeicherte Apps, Läufe und Aufträge hängen an ihr. Gibt der Name keine
 * eindeutige Adresse her (leer, gleich einem Bereich des Hubs oder einer anderen App), steht die ID in der Adresse.
 * Wer eine App umbenennt, ändert damit ihre Adresse; „/app/<id>“ führt weiter zur App.
 */

/** Erste Pfadteile, die der Hub selbst belegt (Seiten, Dienst, Dateien) */
export const RESERVIERT = new Set(["app", "mein", "neu", "baukasten", "agenten", "verwaltung", "api", "assets", "hub-daten"]);

type Kennung = { id: string | null; name: string };

/** „Mail-Antwort für Kunden (v2)“ → „mail-antwort-fuer-kunden-v2“ */
export function adressTeil(name: string): string {
  return String(name).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}

/** Adresse der App ohne führenden Schrägstrich, eindeutig unter allen Apps */
export function pfadTeil(a: Kennung, alle: Kennung[]): string {
  const t = adressTeil(a.name);
  const eindeutig = !!t && !RESERVIERT.has(t) && !alle.some((b) => b.id !== a.id && (b.id === t || adressTeil(b.name) === t));
  return eindeutig ? t : a.id ?? "";
}

/** App zu einem Pfadteil: zuerst die ID (ältere Links, „/app/<id>“), dann die Adresse aus dem Namen */
export function appZuPfad<T extends Kennung>(teil: string | undefined, alle: T[]): T | undefined {
  if (!teil) return undefined;
  return alle.find((a) => a.id === teil) ?? alle.find((a) => pfadTeil(a, alle) === teil);
}

/** Zeigt der Pfad auf eine App? „/app/<id>“ oder ein einzelner Teil, den der Hub nicht selbst belegt */
export function istAppPfad(pathname: string): boolean {
  if (pathname.startsWith("/app/")) return true;
  const m = /^\/([^/]+)$/.exec(pathname);
  return !!m && !RESERVIERT.has(m[1]);
}
