import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createHashRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { MotionConfig } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppsProvider } from "@/state/apps";
import { MeinHubProvider } from "@/state/meinhub";
import { RechteProvider } from "@/state/rechte";
import { Shell } from "@/components/layout/Shell";
import { HubPage } from "@/pages/HubPage";
import { nachladen } from "@/lib/neueVersion";
import { toast } from "sonner";
const AppPage = lazy(nachladen(() => import("@/pages/AppPage").then((m) => ({ default: m.AppPage }))));
const BuilderPage = lazy(nachladen(() => import("@/pages/BuilderPage").then((m) => ({ default: m.BuilderPage }))));
const MeinHubPage = lazy(nachladen(() => import("@/pages/MeinHubPage").then((m) => ({ default: m.MeinHubPage }))));
const NeuPage = lazy(nachladen(() => import("@/pages/NeuPage").then((m) => ({ default: m.NeuPage }))));
const AgentenPage = lazy(nachladen(() => import("@/pages/AgentenPage").then((m) => ({ default: m.AgentenPage }))));
const VerwaltungPage = lazy(nachladen(() => import("@/pages/VerwaltungPage").then((m) => ({ default: m.VerwaltungPage }))));
const laden = <p className="hint">Wird geladen …</p>;

// Andere nachgeladene Teile (z. B. Word- oder PDF-Erzeugung) einer inzwischen ersetzten Version: Hinweis statt stiller Fehler,
// kein automatisches Neuladen, damit Eingaben auf der Seite nicht verloren gehen
// (der Fehler läuft weiter: Seitenwechsel fangen ihn in nachladen() ab und laden neu)
window.addEventListener("vite:preloadError", () => {
  toast.info("Es gibt eine neue Version des KI-Hubs. Bitte die Seite neu laden.", { duration: 15_000, action: { label: "Neu laden", onClick: () => location.reload() } });
});
import { FehlerPage, NotFoundPage } from "@/pages/NotFoundPage";
import "./index.css";

// Als Artifact auf claude.ai gibt es keine Server-Weiterleitung, dort laufen die Adressen über „#/…“.
const router = (import.meta.env.VITE_ROUTER === "hash" ? createHashRouter : createBrowserRouter)([
  {
    element: <Shell />,
    errorElement: <FehlerPage />,
    children: [
      { path: "/", element: <HubPage /> },
      { path: "/app/:id", element: <Suspense fallback={laden}><AppPage /></Suspense> },
      { path: "/mein", element: <Suspense fallback={laden}><MeinHubPage /></Suspense> },
      { path: "/neu", element: <Suspense fallback={laden}><NeuPage /></Suspense> },
      { path: "/baukasten", element: <Suspense fallback={laden}><BuilderPage /></Suspense> },
      { path: "/baukasten/:id", element: <Suspense fallback={laden}><BuilderPage /></Suspense> },
      { path: "/agenten", element: <Suspense fallback={laden}><AgentenPage /></Suspense> },
      { path: "/verwaltung", element: <Suspense fallback={laden}><VerwaltungPage /></Suspense> },
      // Sprechende Adresse je App („/cra-experte“, lib/adresse); feste Seiten oben gehen vor
      { path: "/:id", element: <Suspense fallback={laden}><AppPage /></Suspense> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <RechteProvider>
          <AppsProvider>
            <MeinHubProvider>
              <RouterProvider router={router} />
              <Toaster />
            </MeinHubProvider>
          </AppsProvider>
        </RechteProvider>
      </TooltipProvider>
    </MotionConfig>
  </StrictMode>
);
