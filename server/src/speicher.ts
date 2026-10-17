/** Ablage als JSON-Dateien unter HUB_DATEN; jede Datei wird vollständig geschrieben (erst temporär, dann umbenannt). */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class DateiSpeicher {
  constructor(private readonly wurzel: string) {}

  pfad(rel: string) { return join(this.wurzel, rel); }

  async lesen<T>(rel: string): Promise<T | null> {
    try { return JSON.parse(await readFile(this.pfad(rel), "utf8")) as T; } catch { return null; }
  }

  async schreiben(rel: string, wert: unknown): Promise<void> {
    const ziel = this.pfad(rel);
    await mkdir(dirname(ziel), { recursive: true });
    const tmp = `${ziel}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(wert), "utf8");
    await rename(tmp, ziel);
  }

  async loeschen(rel: string): Promise<void> {
    try { await unlink(this.pfad(rel)); } catch { /* gab es nicht */ }
  }

  /** Dateinamen (ohne Pfad) in einem Verzeichnis; leer, wenn es das Verzeichnis nicht gibt */
  async liste(relDir: string): Promise<string[]> {
    try { return (await readdir(this.pfad(relDir), { withFileTypes: true })).filter((e) => e.isFile() && !e.name.endsWith(".tmp")).map((e) => e.name); } catch { return []; }
  }

  async verzeichnisse(relDir: string): Promise<string[]> {
    try { return (await readdir(this.pfad(relDir), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  }
}

/** Nur Zeichen, die in einem Dateinamen sicher sind (Nutzer-IDs, Lauf-IDs) */
export const sicherName = (s: string) => s.replace(/[^A-Za-z0-9_.@-]/g, "_").slice(0, 120) || "_";
