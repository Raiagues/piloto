export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const transientStatuses = new Set([502, 503, 504]);
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const unavailable = () => new ApiError(response.status, "API_UNAVAILABLE",
    `O servidor não conseguiu carregar os dados (HTTP ${response.status}). Tente novamente em instantes.`);
  const contentType = response.headers.get("content-type") || "";
  if (!/\bapplication\/(?:[\w.-]+\+)?json\b/iu.test(contentType)) throw unavailable();
  let payload: { error?: string; code?: string; message?: string } & T;
  try { payload = await response.json(); } catch { throw unavailable(); }
  if (!response.ok) throw new ApiError(response.status, payload.code || payload.error || "REQUEST_FAILED",
    payload.message || "Não foi possível concluir a solicitação.");
  return payload;
}

/** A failed read can be repeated safely; writes and generation are never replayed here. */
export async function requestJson<T>(url: string, init: RequestInit = {}, dependencies: {
  fetch?: typeof fetch;
  wait?: typeof wait;
} = {}): Promise<T> {
  const fetchResponse = dependencies.fetch || fetch;
  const pause = dependencies.wait || wait;
  const canRetry = ["GET", "HEAD"].includes((init.method || "GET").toUpperCase());
  for (let attempt = 0; ; attempt++) {
    const response = await fetchResponse(url, init);
    if (canRetry && attempt === 0 && transientStatuses.has(response.status) && !init.signal?.aborted) {
      const retryAfter = response.headers.get("retry-after");
      const requestedDelay = retryAfter === null ? 1000
        : /^\d+$/u.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
      const delay = Number.isFinite(requestedDelay) ? Math.max(1000, requestedDelay) : 1000;
      // Do not loop on a persistent outage or retry before a long server delay.
      if (delay <= 3000) {
        await response.body?.cancel();
        await pause(delay);
        init.signal?.throwIfAborted();
        continue;
      }
    }
    return parseResponse<T>(response);
  }
}
