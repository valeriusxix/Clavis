import type { QuoteRequest, QuoteResponse, TokenResponse } from "./types";

export type OneClickClientOptions = {
  baseUrl: string;
  /** Partner JWT. Sent as `X-API-Key` only when set. Without it, quotes still work with an extra fee. */
  apiKey?: string;
  timeoutMs?: number;
  /** Retries on 5xx / network errors (not on 4xx). */
  retries?: number;
};

export class OneClickError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "OneClickError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OneClickClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(opts: OneClickClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.retries = opts.retries ?? 2;
  }

  get hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  /** GET /v0/tokens — no auth required. */
  getTokens(): Promise<TokenResponse[]> {
    return this.request<TokenResponse[]>("GET", "/v0/tokens");
  }

  /** POST /v0/quote. `dry: true` returns no deposit address and nothing executes. */
  getQuote(req: QuoteRequest): Promise<QuoteResponse> {
    return this.request<QuoteResponse>("POST", "/v0/quote", req);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        lastError = new OneClickError(
          `1Click ${method} ${path} network error: ${(err as Error).message}${causeOf(err)}`,
          null,
          null,
        );
        continue;
      }

      const text = await res.text();
      const parsed = safeJson(text);
      if (res.ok) return parsed as T;

      const error = new OneClickError(
        `1Click ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`,
        res.status,
        parsed,
      );
      if (res.status < 500) throw error; // 4xx: do not retry
      lastError = error;
    }
    throw lastError;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function causeOf(err: unknown): string {
  const cause = (err as { cause?: { message?: string; code?: string } }).cause;
  if (!cause) return "";
  return ` (cause: ${cause.code ?? ""} ${cause.message ?? ""})`.replace(/\s+\)/, ")");
}
