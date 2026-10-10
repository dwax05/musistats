/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type User = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type ApiResponse = { error: string } & Record<string, unknown>;

type AuthContext = {
  user: User | null;
  offline: boolean;
  authedPost: (url: string, body?: unknown) => Promise<ApiResponse>;
  logout: () => Promise<void>;
  disconnect: () => Promise<string>;
};

const Ctx = createContext<AuthContext | null>(null);

export function useAuth(): AuthContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

async function post(url: string, body: unknown, accessToken?: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const accessToken = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [offline, setOffline] = useState(false);
  const [ready, setReady] = useState(false);

  const applySession = useCallback((data: ApiResponse | null) => {
    if (data?.error === "" && typeof data.accessToken === "string" && data.user) {
      accessToken.current = data.accessToken;
      setUser(data.user as User);
      return true;
    }
    accessToken.current = null;
    setUser(null);
    return false;
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await post("/api/auth/refresh", {});
      return applySession(res.ok ? await res.json() : null);
    } catch {
      return false;
    }
  }, [applySession]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Session state comes from the server after mount.
    void refresh().finally(() => setReady(true));
  }, [refresh]);

  const authedPost = useCallback(
    async (url: string, body?: unknown): Promise<ApiResponse> => {
      try {
        let res = await post(url, body, accessToken.current ?? undefined);
        if (res.status === 401) {
          if (!(await refresh())) return { error: "unauthorized" };
          res = await post(url, body, accessToken.current ?? undefined);
        }
        setOffline(false);
        if (!res.ok) return { error: "request_failed" };
        return (await res.json()) as ApiResponse;
      } catch (err) {
        if (err instanceof TypeError) {
          setOffline(true);
          return { error: "offline" };
        }
        throw err;
      }
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await post("/api/auth/logout", {}, accessToken.current ?? undefined);
    } catch {
      // A local logout still succeeds when the server is unavailable.
    } finally {
      applySession(null);
    }
  }, [applySession]);

  const disconnect = useCallback(async () => {
    try {
      let res = await post("/api/auth/disconnect", {}, accessToken.current ?? undefined);
      if (res.status === 401 && await refresh()) {
        res = await post("/api/auth/disconnect", {}, accessToken.current ?? undefined);
      }
      const data = res.ok ? await res.json() as ApiResponse : null;
      if (!data || data.error) return "Your data could not be deleted. Please try again.";
      applySession(null);
      return "";
    } catch {
      return "Your data could not be deleted. Please try again.";
    }
  }, [applySession, refresh]);

  const value: AuthContext = {
    user,
    offline,
    authedPost,
    logout,
    disconnect,
  };

  return <Ctx.Provider value={value}>{ready ? children : null}</Ctx.Provider>;
}

export function UpdateBanner() {
  const { offline } = useAuth();

  useEffect(() => {
    if (!offline) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) window.location.reload();
      } catch {
        // Keep polling while a deploy replaces the server.
      }
    }, 2000);
    return () => clearInterval(id);
  }, [offline]);

  if (!offline) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
      <div className="rounded-2xl border border-border-app bg-surface px-6 py-5 text-sm font-medium shadow-2xl">
        Updating&hellip;
      </div>
    </div>
  );
}
