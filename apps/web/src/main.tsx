import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// Phase 0 placeholder. Pages (Leaderboard, Trader, Trade, Keys, HowItWorks), Tailwind,
// Recharts and the wallet integration arrive in Phase 3.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

type Meta = { demoMode: boolean; network: string; contractId: string | null; hasOneClickKey: boolean };

function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/meta`)
      .then((r) => r.json() as Promise<Meta>)
      .then(setMeta)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Clavis</h1>
      <p>Trade in private. Prove your PnL in public. Sell the key to your trades.</p>
      <pre>{error ? `API error: ${error}` : JSON.stringify(meta, null, 2)}</pre>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
