/**
 * Zweiter Suchdurchlauf im Fachexperten-Chat: Verweisen die Auszüge auf ein anderes Dokument, antwortet der Experte
 * mit „NACHSCHLAGEN: <Begriffe>“; der Hub holt dazu Auszüge und stellt die Frage erneut (höchstens zweimal je Frage).
 */
/** Regel für den Experten: fehlt der Inhalt eines Dokuments, auf das die Auszüge verweisen, erst nachschlagen lassen */
export const NACHSCHLAGEN_REGEL = `Nachschlagen: Verweisen die Auszüge auf ein anderes Dokument, Template oder Konzept, das die Frage beantworten würde, und fehlt dessen Inhalt in den Auszügen, dann antworte NUR mit einer einzigen Zeile: NACHSCHLAGEN: <Dokumentname oder Suchbegriffe> (höchstens drei Begriffe, mit Komma getrennt, keine weitere Erklärung). Der Hub holt dann die passenden Auszüge und stellt die Frage erneut. Nicht nachschlagen, wenn die Antwort schon belegt ist oder wenn die Anfrage sagt, dass nichts mehr nachgeschlagen wird.`;
export const NACHSCHLAGEN = /^\s*(?:\*\*)?NACHSCHLAGEN:(?:\*\*)?\s*(.+?)\s*$/im;
/** Verlangt die Antwort ein Nachschlagen? Dann die Begriffe, sonst null */
export function nachschlagenAus(text: string): string | null {
  const t = text.trim();
  if (t.length > 300) return null;
  const m = NACHSCHLAGEN.exec(t);
  return m ? m[1].replace(/[.*]+$/, "").trim() : null;
}
