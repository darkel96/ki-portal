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
    if (!res.ok) throw new Error(`Copilot antwortet mit Fehler ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
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
