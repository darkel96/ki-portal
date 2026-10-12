import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kiFragen } from "@/lib/ki";
import { abmelden, graphToken } from "@/lib/ki/auth";
import { copilotVerbindung, redirectUri, testVerbindungSetzen } from "@/lib/ki/config";
import { letzteMessung, letzteRohantwort } from "@/lib/ki/copilot";
import { kiModusGeaendert } from "./KiSchluessel";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Weiterleitung() {
  const uri = redirectUri();
  const kopieren = () => navigator.clipboard.writeText(uri).then(() => toast.success("Adresse kopiert."), () => toast.error("Kopieren nicht möglich."));
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 break-all bg-muted px-1.5 py-1 text-[12px]">{uri}</code>
      <Button size="sm" type="button" variant="outline" className="rounded-full" onClick={kopieren}>Kopieren</Button>
    </div>
  );
}

/** Copilot-Verbindung zum Testen einrichten (Client- und Tenant-ID bleiben in diesem Browser). */
export function KiCopilotEinrichten() {
  const [clientId, setClientId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const speichern = () => {
    if (!GUID.test(clientId.trim())) { toast.error("Die Client-ID ist eine GUID (z. B. 1a2b3c4d-…), zu finden in der App-Registrierung unter „Übersicht“."); return; }
    if (!GUID.test(tenantId.trim()) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(tenantId.trim())) { toast.error("Die Tenant-ID ist eine GUID oder eine Domäne wie firma.onmicrosoft.com."); return; }
    testVerbindungSetzen({ clientId, tenantId });
    kiModusGeaendert();
    toast.success("Copilot ist eingerichtet. Im KI-Menü mit „Verbindung testen“ anmelden.");
  };
  return (
    <form className="mt-3 flex flex-col gap-2 border-t pt-3" onSubmit={(e) => { e.preventDefault(); speichern(); }}>
      <p className="font-semibold">Mit Copilot testen</p>
      <p className="text-muted-foreground">Client- und Tenant-ID der App-Registrierung in Microsoft Entra ID eintragen. Sie bleiben in diesem Browser. Dort muss diese Adresse unter „Authentifizierung“ → „Single-page application“ eingetragen sein:</p>
      <Weiterleitung />
      <label htmlFor="ki-client" className="sr-only">Client-ID</label>
      <Input id="ki-client" autoComplete="off" spellCheck={false} placeholder="Client-ID (Anwendungs-ID)" value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <label htmlFor="ki-tenant" className="sr-only">Tenant-ID</label>
      <Input id="ki-tenant" autoComplete="off" spellCheck={false} placeholder="Tenant-ID (Verzeichnis-ID)" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
      <div><Button size="sm" type="submit" className="rounded-full" disabled={!clientId.trim() || !tenantId.trim()}>Copilot einrichten</Button></div>
    </form>
  );
}

const sek = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
/** Dauer des letzten Copilot-Aufrufs nach Phasen, z. B. „Anmeldung 0,1 s · Gespräch 0,0 s (vorbereitet) · Antwort 4,2 s“. */
function messungText(): string {
  const m = letzteMessung;
  if (!m) return "";
  return [
    `Anmeldung ${sek(m.anmeldung)}`,
    `Gespräch ${sek(m.gespraech)}${m.ausVorrat ? " (vorbereitet)" : ""}`,
    m.ersteZeichen != null ? `erste Zeichen nach ${sek(m.ersteZeichen)}` : "",
    `Antwort ${sek(m.antwort)}${m.gestreamt ? " (Streaming)" : ""}`,
  ].filter(Boolean).join(" · ");
}

/** Copilot verbunden: Anmeldung und eine kurze Testfrage prüfen, Testverbindung wieder entfernen. */
export function KiCopilotStatus({ konto, onKonto }: { konto: string | null; onKonto: () => void }) {
  const v = copilotVerbindung();
  const [laeuft, setLaeuft] = useState<"" | "anmelden" | "fragen">("");
  const testen = async () => {
    try {
      setLaeuft("anmelden");
      await graphToken();
      onKonto();
      setLaeuft("fragen");
      const antwort = await kiFragen("Antworte nur mit dem Wort: Verbunden", undefined, () => undefined);
      toast.success(`Copilot antwortet: „${antwort.slice(0, 120)}“`, { description: messungText(), duration: 10_000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 20_000 });
    } finally {
      setLaeuft("");
    }
  };
  const entfernen = async () => {
    await abmelden().catch(() => undefined);
    testVerbindungSetzen(null);
    kiModusGeaendert();
    toast.success("Copilot-Testverbindung entfernt.");
  };
  if (!v) return null;
  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <p className="text-muted-foreground">
        {konto ? `Angemeldet als ${konto}.` : "Noch nicht angemeldet. Die Anmeldung öffnet sich beim ersten KI-Aufruf oder mit „Verbindung testen“."}
        {v.quelle === "browser" ? " Die Verbindung ist nur in diesem Browser eingetragen." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="rounded-full" onClick={testen} disabled={!!laeuft}>
          {laeuft === "anmelden" ? "Anmeldung …" : laeuft === "fragen" ? "Copilot antwortet …" : "Verbindung testen"}
        </Button>
        {konto && <Button size="sm" variant="outline" className="rounded-full" onClick={() => abmelden().then(onKonto)} disabled={!!laeuft}>Abmelden</Button>}
        {v.quelle === "browser" && <Button size="sm" variant="outline" className="rounded-full" onClick={entfernen} disabled={!!laeuft}>Entfernen</Button>}
      </div>
      <details className="text-[12px] text-muted-foreground">
        <summary className="cursor-pointer">Technische Angaben</summary>
        <dl className="mt-1.5 grid gap-1">
          <dt className="font-semibold">Client-ID</dt><dd className="break-all">{v.clientId}</dd>
          <dt className="font-semibold">Tenant</dt><dd className="break-all">{v.tenantId}</dd>
          <dt className="font-semibold">Weiterleitung (Single-page application)</dt><dd><Weiterleitung /></dd>
          {letzteMessung && <><dt className="font-semibold">Letzter Aufruf</dt><dd>{messungText()}</dd></>}
          {letzteRohantwort && <><dt className="font-semibold">Letzte Antwort von Graph</dt><dd>
            <Button size="sm" type="button" variant="outline" className="rounded-full" onClick={() => navigator.clipboard.writeText(letzteRohantwort).then(() => toast.success("Rohantwort kopiert."), () => toast.error("Kopieren nicht möglich."))}>Rohantwort kopieren</Button>
          </dd></>}
          <dt className="font-semibold">Graph-Berechtigungen (delegiert)</dt><dd className="break-all">{v.scopes.map((s) => s.replace("https://graph.microsoft.com/", "")).join(", ")}</dd>
        </dl>
      </details>
    </div>
  );
}
