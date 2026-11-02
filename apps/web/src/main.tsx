import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import "./index.css";
import { SessionProvider } from "./lib/session";
import { HowItWorks } from "./pages/HowItWorks";
import { Keys } from "./pages/Keys";
import { Leaderboard } from "./pages/Leaderboard";
import { Spinner } from "./components/ui";

// Chart-heavy pages load on demand so the leaderboard paints fast.
const Trader = lazy(() => import("./pages/Trader").then((m) => ({ default: m.Trader })));
const Trade = lazy(() => import("./pages/Trade").then((m) => ({ default: m.Trade })));
const lazyPage = (node: ReactNode) => <Suspense fallback={<Spinner />}>{node}</Suspense>;

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Leaderboard /> },
      { path: "/trader/:id", element: lazyPage(<Trader />) },
      { path: "/trade", element: lazyPage(<Trade />) },
      { path: "/keys", element: <Keys /> },
      { path: "/how-it-works", element: <HowItWorks /> },
      { path: "*", element: <p className="text-muted">Page not found.</p> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
);
