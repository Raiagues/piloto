import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SessionUser } from "./team";
import { requestJson } from "./apiClient";
import { createHeartbeatSender } from "./presenceHeartbeat";
export { ApiError } from "./apiClient";

export const API_ORIGIN = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/u, "");

export type RegisterAccountInput = {
  login?: string;
  nickname?: string;
  name: string;
  email?: string;
  password: string;
  bootstrapToken?: string;
};

type AuthStatus = "loading" | "anonymous" | "authenticated" | "offline";

type AuthContextValue = {
  status: AuthStatus;
  user: SessionUser | null;
  hasOwner: boolean;
  bootstrapRequired: boolean;
  login: (login: string, password: string) => Promise<void>;
  register: (input: RegisterAccountInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
};

type SessionResponse = {
  authenticated?: boolean;
  hasOwner?: boolean;
  bootstrapRequired?: boolean;
  user?: SessionUser;
  csrfToken?: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [hasOwner, setHasOwner] = useState(false);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const csrfRef = useRef("");

  const api = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const method = (init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfRef.current) headers.set("x-csrf-token", csrfRef.current);
    return requestJson<T>(`${API_ORIGIN}/api${path}`, { ...init, headers, credentials: "include" });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await api<SessionResponse>("/auth/session");
      setHasOwner(Boolean(response.hasOwner));
      setBootstrapRequired(Boolean(response.bootstrapRequired));
      if (response.authenticated && response.user && response.csrfToken) {
        csrfRef.current = response.csrfToken;
        setUser(response.user);
        setStatus("authenticated");
      } else {
        csrfRef.current = "";
        setUser(null);
        setStatus("anonymous");
      }
    } catch {
      csrfRef.current = "";
      setUser(null);
      setStatus("offline");
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let lastInteraction = Date.now();
    const sendHeartbeat = createHeartbeatSender(() => api("/auth/heartbeat", { method: "POST" }));
    const active = () => { lastInteraction = Date.now(); };
    const heartbeat = () => {
      if (document.visibilityState === "visible" && Date.now() - lastInteraction < 120_000) {
        void sendHeartbeat().catch(() => undefined);
      }
    };
    const visible = () => { if (document.visibilityState === "visible") { active(); heartbeat(); } };
    window.addEventListener("pointerdown", active);
    window.addEventListener("keydown", active);
    window.addEventListener("scroll", active, true);
    document.addEventListener("visibilitychange", visible);
    heartbeat();
    const interval = window.setInterval(heartbeat, 30_000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
      window.removeEventListener("scroll", active, true);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [api, status]);

  const login = useCallback(async (login: string, password: string) => {
    const response = await api<{ user: SessionUser; csrfToken: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ login, password })
    });
    csrfRef.current = response.csrfToken;
    setUser(response.user);
    setHasOwner(true);
    setBootstrapRequired(false);
    setStatus("authenticated");
  }, [api]);


  const register = useCallback(async (input: RegisterAccountInput) => {
    const response = await api<{ user: SessionUser; csrfToken: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input)
    });
    csrfRef.current = response.csrfToken;
    setUser(response.user);
    setHasOwner(true);
    setBootstrapRequired(false);
    setStatus("authenticated");
  }, [api]);

  const logout = useCallback(async () => {
    try {
      await api<void>("/auth/logout", { method: "POST" });
    } finally {
      csrfRef.current = "";
      setUser(null);
      setStatus("anonymous");
    }
  }, [api]);

  const value = useMemo<AuthContextValue>(() => ({ status, user, hasOwner, bootstrapRequired, login, register, logout, refresh, api }), [status, user, hasOwner, bootstrapRequired, login, register, logout, refresh, api]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
