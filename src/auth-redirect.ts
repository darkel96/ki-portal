/** Weiterleitungsseite der Anmeldung (MSAL 5): gibt das Ergebnis an das Hauptfenster zurück. */
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = "Die Anmeldung konnte nicht abgeschlossen werden. Schließe dieses Fenster und versuche es erneut.";
});
