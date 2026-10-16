import { describe, expect, it, vi } from "vitest";
import { ApiError, requestJson } from "../src/lib/apiClient";

const unavailable = (status = 502, headers = {}) => new Response("<html>Gateway unavailable</html>", {
  status, headers: { "content-type": "text/html", ...headers }
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
});

describe("API reads during a gateway outage", () => {
  it("recovers from an HTML gateway response without losing the authenticated request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(json({ artifacts: [{ id: "source" }] }));
    const wait = vi.fn(async () => {});
    const init: RequestInit = { credentials: "include", headers: { accept: "application/json" } };
    expect(await requestJson("/api/artifacts", init, { fetch, wait })).toEqual({ artifacts: [{ id: "source" }] });
    expect(fetch.mock.calls).toEqual([["/api/artifacts", init], ["/api/artifacts", init]]);
    expect(wait).toHaveBeenCalledWith(1000);
  });

  it("stops after two failed reads and preserves a useful status without displaying upstream HTML", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => unavailable(503));
    await expect(requestJson("/api/artifacts", {}, { fetch, wait: async () => {} })).rejects.toMatchObject({
      status: 503, code: "API_UNAVAILABLE", message: expect.stringContaining("HTTP 503")
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not replay writes, generation, authorization failures or non-transient errors", async () => {
    for (const [method, response] of [["POST", unavailable()], ["PUT", unavailable()], ["GET", json({ error: "AUTH_REQUIRED" }, 401)], ["GET", json({ error: "INTERNAL_ERROR" }, 500)], ["GET", unavailable(404)]] as const) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
      await expect(requestJson("/api/system-ai/generate", { method }, { fetch })).rejects.toBeInstanceOf(ApiError);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("honors Retry-After within the retry budget and declines longer delays", async () => {
    for (const delay of ["2", "120"]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(unavailable(503, { "retry-after": delay })).mockResolvedValueOnce(json({ ready: true }));
      const wait = vi.fn(async () => {});
      if (delay === "2") {
        expect(await requestJson("/api/teams", {}, { fetch, wait })).toEqual({ ready: true });
        expect(wait).toHaveBeenCalledWith(2000);
      } else {
        await expect(requestJson("/api/teams", {}, { fetch, wait })).rejects.toMatchObject({ status: 503 });
        expect(wait).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("does not issue a second read after cancellation", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(unavailable());
    await expect(requestJson("/api/artifacts", { signal: controller.signal }, { fetch, wait: async () => { controller.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("handles malformed JSON and Fastify error codes consistently", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response("{", { headers: { "content-type": "application/json" } }));
    await expect(requestJson("/api/artifacts", {}, { fetch })).rejects.toMatchObject({ code: "API_UNAVAILABLE", status: 200 });
    fetch.mockResolvedValueOnce(json({ error: "Unauthorized", code: "AUTH_REQUIRED", message: "Please sign in." }, 401));
    await expect(requestJson("/api/artifacts", {}, { fetch })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
