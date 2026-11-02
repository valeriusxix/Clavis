/** Read-only NEAR contract call over JSON-RPC (`query` / `call_function`). No keys needed. */
export type ViewFn = <T>(contractId: string, method: string, args: Record<string, unknown>) => Promise<T>;

export const DEFAULT_RPC: Record<"testnet" | "mainnet", string> = {
  // docs.near.org/api/rpc/providers: FASTNEAR public endpoints
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://rpc.mainnet.fastnear.com",
};

export function makeViewFn(rpcUrl: string, timeoutMs = 10_000): ViewFn {
  return async <T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> => {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "clavis",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: contractId,
          method_name: method,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json()) as { result?: { result?: number[] }; error?: unknown };
    if (!res.ok || body.error || !body.result?.result) {
      throw new Error(`NEAR view ${contractId}.${method} failed: ${JSON.stringify(body.error ?? res.status).slice(0, 300)}`);
    }
    return JSON.parse(Buffer.from(body.result.result).toString("utf8")) as T;
  };
}
