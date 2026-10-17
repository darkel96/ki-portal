/** Server-Fassung von src/lib/ki/claudeTest.ts: Den Testmodus über den claude.ai-Viewer gibt es im Dienst nicht. */
export const imClaudeViewer = () => false;
export function claudeSample(): Promise<null> { return Promise.resolve(null); }
export function claudeDownloads(): Promise<null> { return Promise.resolve(null); }
export async function claudeFragen(): Promise<string> { throw new Error("Im Dienst nicht vorgesehen."); }
