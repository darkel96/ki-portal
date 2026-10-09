import type { FileInfo } from "./request";
import { claudeDownloads } from "./ki/claudeTest";

export const MAX_TEXT = 60_000;
export const FILE_ACCEPT = ".txt,.csv,.md,.json,.xml,.html,.vtt,.xlsx,.docx,.pdf,text/*";

export class UnsupportedFormatError extends Error {}

/** Liest Word, Excel, PDF und Textdateien als Text. Bibliotheken werden erst bei Bedarf geladen. */
export async function extractText(file: File): Promise<string> {
  const n = file.name.toLowerCase();
  if (n.endsWith(".xlsx")) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    return sheets.map((s) => `## Tabellenblatt: ${s.sheet}\n` + s.data.map((row) => row.map((c) => (c == null ? "" : String(c))).join(";")).join("\n")).join("\n\n");
  }
  if (n.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return res.value;
  }
  if (n.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const out: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return out.join("\n\n");
  }
  if (/\.(xls|doc|ppt|pptx|msg)$/.test(n)) throw new UnsupportedFormatError(n);
  return file.text();
}

export async function readFileInfo(file: File): Promise<FileInfo> {
  const text = await extractText(file);
  return { name: file.name, size: file.size, type: file.type || file.name.split(".").pop() || "", text: text.slice(0, MAX_TEXT), geaendert: file.lastModified ? new Date(file.lastModified).toISOString() : undefined };
}

/** Bild einlesen und auf höchstens 800 px Breite verkleinern (SVG bleibt unverändert). */
export function loadImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const url = String(r.result);
      if (file.type === "image/svg+xml") return resolve(url);
      const img = new Image();
      img.onerror = () => reject(new Error("Bild"));
      img.onload = () => {
        const scale = Math.min(1, 800 / img.naturalWidth);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        let out = c.toDataURL("image/webp", 0.85);
        if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/png");
        resolve(out.length < url.length ? out : url);
      };
      img.src = url;
    };
    r.readAsDataURL(file);
  });
}

/** Datei im Browser speichern (auf claude.ai über die Download-Funktion des Viewers). */
export async function saveFile(name: string, data: Blob | string, type = "text/plain;charset=utf-8") {
  const dl = await claudeDownloads();
  if (dl) { try { await dl.save({ filename: name, data }); } catch { /* abgelehnt */ } return; }
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
