/**
 * Versand an Microsoft 365 Copilot über Microsoft Graph.
 * Ablauf wie in der bestehenden Copilot-Verbindung (EPLAN/Visio):
 *   1. POST /beta/copilot/conversations
 *   2. POST /beta/copilot/conversations/{id}/chat
 *   Antwort = letzter Text in "messages", der nicht die eigene Frage ist.
 * TODO: Endpunkte vor Inbetriebnahme mit der aktuellen Graph-Dokumentation abgleichen (Beta-API).
 */
import { KI_CONFIG } from "./config";
import { graphToken } from "./auth";

const GRAPH = "https://graph.microsoft.com";

async function post(url: string, body: unknown, token: string, signal?: AbortSignal): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), KI_CONFIG.timeoutMs);
  signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw graphFehler(res.status, text);
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError" && !signal?.aborted) throw new Error("Copilot hat nicht innerhalb von 3 Minuten geantwortet.");
    if (e instanceof TypeError) throw new Error("Keine Verbindung zu Microsoft Graph. Netzwerk oder Proxy prüfen.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Graph-Fehler mit dem Hinweis, woran es meist liegt; die Meldung von Graph hängt zur Fehlersuche an. */
function graphFehler(status: number, text: string): Error {
  let meldung = text.slice(0, 300);
  try { meldung = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? meldung; } catch { /* kein JSON */ }
  const hinweis =
    status === 401 ? "Die Anmeldung wurde nicht akzeptiert. Abmelden und neu anmelden."
    : status === 403 ? "Kein Zugriff auf Copilot. Meist fehlt die Microsoft-365-Copilot-Lizenz oder eine der Graph-Berechtigungen (Sites.Read.All, Mail.Read, People.Read.All, OnlineMeetingTranscript.Read.All, Chat.Read, ChannelMessage.Read.All, ExternalItem.Read.All) samt Administratorzustimmung."
    : status === 404 ? "Die Copilot-Schnittstelle wurde nicht gefunden. Sie ist in diesem Tenant evtl. nicht verfügbar oder hat sich geändert (Beta)."
    : status === 429 ? "Zu viele Anfragen an Copilot. Kurz warten und erneut versuchen."
    : `Copilot antwortet mit Fehler ${status}.`;
  return new Error(`${hinweis} Meldung von Graph: ${meldung}`);
}

function letzterText(antwort: unknown, frage: string): string {
  const msgs = (antwort as { messages?: { text?: string }[] })?.messages ?? [];
  let text = "";
  for (const m of msgs) if (m?.text && m.text.trim() && m.text !== frage) text = m.text;
  return text;
}

export async function copilotFragen(frage: string, opts: { web?: boolean; dateien?: string[]; signal?: AbortSignal } = {}): Promise<string> {
  const token = await graphToken();
  const conv = (await post(`${GRAPH}/beta/copilot/conversations`, {}, token, opts.signal)) as { id?: string };
  if (!conv.id) throw new Error("Copilot hat keine Unterhaltung angelegt.");
  const body = {
    message: { text: frage },
    locationHint: { timeZone: "Europe/Berlin" },
    contextualResources: {
      ...(opts.dateien?.length ? { files: opts.dateien.map((uri) => ({ uri })) } : {}),
      webContext: { isWebEnabled: !!opts.web },
    },
  };
  const antwort = await post(`${GRAPH}/beta/copilot/conversations/${encodeURIComponent(conv.id)}/chat`, body, token, opts.signal);
  const text = letzterText(antwort, frage);
  if (!text) throw new Error("Copilot hat keinen Text geliefert.");
  return text;
}
