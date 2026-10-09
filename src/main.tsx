import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createHashRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { MotionConfig } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppsProvider } from "@/state/apps";
import { MeinHubProvider } from "@/state/meinhub";
import { Shell } from "@/components/layout/Shell";
import { HubPage } from "@/pages/HubPage";
const AppPage = lazy(() => import("@/pages/AppPage").then((m) => ({ default: m.AppPage })));
const BuilderPage = lazy(() => import("@/pages/BuilderPage").then((m) => ({ default: m.BuilderPage })));
const MeinHubPage = lazy(() => import("@/pages/MeinHubPage").then((m) => ({ default: m.MeinHubPage })));
const NeuPage = lazy(() => import("@/pages/NeuPage").then((m) => ({ default: m.NeuPage })));
const laden = <p className="hint">Wird geladen …</p>;
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
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <AppsProvider>
          <MeinHubProvider>
            <RouterProvider router={router} />
            <Toaster position="bottom-right" />
          </MeinHubProvider>
        </AppsProvider>
      </TooltipProvider>
    </MotionConfig>
  </StrictMode>
);
