import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react";

/** Meldungen oben mittig unter Kopfzeile und Werkzeugleiste der Seite, damit sie weder Knöpfe, Blätterleiste noch Dialog-Knöpfe verdecken; nur heller Modus. Aussehen (Streifen je Art, ✕ rechts) in styles/app.css. */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="top-center"
      offset={{ top: 128 }}
      mobileOffset={{ top: 64 }}
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
