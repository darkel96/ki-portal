import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react";

/** Meldungen als Statuszeile auf der Fußzeile: volle Breite, unten bündig, verdecken keinen Inhalt; auf dem Handy (ohne Fußzeile) über der Blätterleiste. Nur heller Modus. Aussehen in styles/app.css. */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="bottom-center"
      offset={{ bottom: 0, left: 0, right: 0 }}
      mobileOffset={{ bottom: 72, left: 0, right: 0 }}
      gap={0}
      closeButton
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={{ "--width": "100%", "--normal-bg": "var(--popover)", "--normal-text": "var(--popover-foreground)", "--normal-border": "var(--border)", "--border-radius": "var(--k-radius-card)" } as React.CSSProperties}
      {...props}
    />
  );
};

export { Toaster };
