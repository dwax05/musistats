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

// The chokepoint for all authenticated requests. Components never call
// fetch directly — they use authedPost, which handles the access token,
// the silent-refresh-on-401 retry, and offline (deploy-window) detection.

export type User = { id: string; login: string };
export type ApiResponse = { error: string } & Record<string, unknown>;

type AuthContext = {
  user: User | null;
  offline: boolean;
  authedPost: (url: string, body?: unknown) => Promise<ApiResponse>;
  login: (login: string, password: string, rememberMe: boolean) => Promise<string>;
  register: (login: string, password: string, rememberMe: boolean) => Promise<string>;
  logout: () => Promise<void>;
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
      "x-remember-me": localStorage.getItem("rememberMe") ?? "0",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Access token lives only in a ref — never in state, never on disk.
  const accessToken = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("user");
    return raw ? (JSON.parse(raw) as User) : null;
  });
  const [offline, setOffline] = useState(false);
  // Render nothing until the mount-time silent refresh resolves, so
  // returning users never see a flash of the login form.
  const [ready, setReady] = useState(() => localStorage.getItem("user") === null);

  const applySession = useCallback((data: ApiResponse | null) => {
    if (data && data.error === "" && typeof data.accessToken === "string") {
      accessToken.current = data.accessToken;
      setUser(data.user as User);
      localStorage.setItem("user", JSON.stringify(data.user));
      return true;
    }
    accessToken.current = null;
    setUser(null);
    localStorage.removeItem("user");
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
    if (ready) return;
    void refresh().finally(() => setReady(true));
  }, [ready, refresh]);

  const authedPost = useCallback(
    async (url: string, body?: unknown): Promise<ApiResponse> => {
      try {
        let res = await post(url, body, accessToken.current ?? undefined);
        if (res.status === 401) {
          // Expired access token: silently refresh and retry exactly once.
          if (!(await refresh())) return { error: "unauthorized" };
          res = await post(url, body, accessToken.current ?? undefined);
        }
        setOffline(false);
        return (await res.json()) as ApiResponse;
      } catch (err) {
        if (err instanceof TypeError) {
          // Network-level failure: the server is unreachable (e.g. a deploy
          // is swapping containers), not a logical error from a live server.
          setOffline(true);
          return { error: "offline" };
        }
        throw err;
      }
    },
    [refresh],
  );

  const startSession = useCallback(
    async (path: string, login: string, password: string, rememberMe: boolean) => {
      localStorage.setItem("rememberMe", rememberMe ? "1" : "0");
      try {
        const res = await post(path, { login, password });
        const data = (await res.json()) as ApiResponse;
        if (data.error !== "") return data.error;
        applySession(data);
        return "";
      } catch {
        return "Could not reach the server";
      }
    },
    [applySession],
  );

  const value: AuthContext = {
    user,
    offline,
    authedPost,
    login: (l, p, r) => startSession("/api/auth/login", l, p, r),
    register: (l, p, r) => startSession("/api/auth/register", l, p, r),
    logout: async () => {
      try {
        await post("/api/auth/logout", {});
      } catch {
        /* logging out while offline is fine */
      }
      applySession(null);
      localStorage.removeItem("rememberMe");
    },
  };

  return <Ctx.Provider value={value}>{ready ? children : null}</Ctx.Provider>;
}

/** Full-screen overlay for the ~5s deploy window: polls /api/health and
 *  reloads onto the freshly deployed assets once the server is back. */
export function UpdateBanner() {
  const { offline } = useAuth();

  useEffect(() => {
    if (!offline) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) window.location.reload();
      } catch {
        /* still down, keep polling */
      }
    }, 2000);
    return () => clearInterval(id);
  }, [offline]);

  if (!offline) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(6px)",
        background: "rgba(0,0,0,0.4)",
        color: "white",
        fontSize: "1.25rem",
      }}
    >
      Updating&hellip;
    </div>
  );
}
