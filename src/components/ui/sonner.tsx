import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react";

/** Meldungen unten rechts, bündig mit dem Seitenrand (.wrap) und über der Aktionsleiste der App-Seiten („Ergebnisse erstellen“, Blätterleiste), damit sie keinen Knopf verdecken und auf jeder Seite an derselben Stelle stehen; nur heller Modus. Aussehen (Streifen je Art, ✕ rechts) in styles/app.css. */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      offset={{ bottom: 136, right: "clamp(16px, 2.4vw, 40px)" }}
      mobileOffset={{ bottom: 104, left: 16, right: 16 }}
      closeButton
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={{ "--normal-bg": "var(--popover)", "--normal-text": "var(--popover-foreground)", "--normal-border": "var(--border)", "--border-radius": "var(--k-radius-card)" } as React.CSSProperties}
      {...props}
    />
  );
};

export { Toaster };
