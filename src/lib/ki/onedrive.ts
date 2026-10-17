/**
 * Bilder für Copilot: Die Copilot-Chat-API nimmt keine Bilddaten an, nur Dateien in OneDrive/SharePoint. Deshalb legt
 * der Hub ein Chat-Bild im App-Ordner der angemeldeten Person in OneDrive ab („Apps/<Name der Azure-Anwendung>/Chat“)
 * und gibt die Adresse als Datei mit. Dafür braucht die Azure-Anwendung zusätzlich die delegierte Berechtigung
 * Files.ReadWrite.AppFolder (nur dieser Ordner, nicht die ganzen Dateien der Person).
 */
import { graphToken } from "./auth";
import { KI_CONFIG } from "./config";
import { copilotVerbindung } from "./config";

const GRAPH = `${KI_CONFIG.graph}/v1.0`;
export const ONEDRIVE_SCOPE = "https://graph.microsoft.com/Files.ReadWrite.AppFolder";
const ENDUNG: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg" };

/** Legt ein Bild (Daten-URL) in OneDrive ab und gibt seine Web-Adresse zurück */
export async function bildNachOneDrive(name: string, daten: string, signal?: AbortSignal): Promise<string> {
  const v = copilotVerbindung();
  let token: string;
  try {
    token = await graphToken([...(v?.scopes ?? []), ONEDRIVE_SCOPE]);
  } catch (e) {
    throw new Error(`Bilder kann Copilot nur als Datei aus OneDrive sehen. Dafür fehlt der Azure-Anwendung die Berechtigung Files.ReadWrite.AppFolder mit Administratorzustimmung (${e instanceof Error ? e.message : String(e)})`);
  }
  const blob = await (await fetch(daten)).blob();
  const endung = ENDUNG[blob.type] ?? "png";
  const basis = name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|#%]/g, "_").slice(0, 80) || "bild";
  const pfad = `Chat/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}_${basis}.${endung}`;
  const r = await fetch(`${GRAPH}/me/drive/special/approot:/${encodeURI(pfad)}:/content`, {
    method: "PUT", signal, body: blob,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type || "application/octet-stream" },
  });
  if (!r.ok) throw new Error(r.status === 403 ? "Das Bild konnte nicht in OneDrive abgelegt werden: Die Berechtigung Files.ReadWrite.AppFolder fehlt oder wurde nicht zugestimmt." : `Das Bild konnte nicht in OneDrive abgelegt werden (HTTP ${r.status}).`);
  const j = (await r.json()) as { webUrl?: string };
  if (!j.webUrl) throw new Error("OneDrive hat keine Adresse für das Bild geliefert.");
  return j.webUrl;
}
