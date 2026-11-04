import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider } from "react-router";
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
const lazyPage = (node: ReactNode) => (
  <Suspense
    fallback={
      <div className="pt-8">
        <Spinner />
      </div>
    }
  >
    {node}
  </Suspense>
);

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Leaderboard /> },
      { path: "/trader/:id", element: lazyPage(<Trader />) },
      { path: "/trade", element: lazyPage(<Trade />) },
      { path: "/keys", element: <Keys /> },
      { path: "/how-it-works", element: <HowItWorks /> },
      {
        path: "*",
        element: (
          <p className="pt-8 text-muted">
            Page not found.{" "}
            <Link className="text-green hover:underline" to="/">
              Leaderboard
            </Link>
          </p>
        ),
      },
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
