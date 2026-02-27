import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { createElement } from "react";
import { queryClient, apiRequest } from "./queryClient";

interface AuthUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  tier: string;
  tokensUsed: number;
  tokenLimit: number;
  storageUsed: number;
  storageLimit: number;
  emailVerified: boolean | null;
  billingCycleStart: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; username: string; password: string; firstName?: string; lastName?: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = "scholarmark_token";

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // localStorage not available
  }
}

/** Fetch with auth token attached */
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(url, { ...options, headers });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [isLoading, setIsLoading] = useState(true);

  // On mount, try to restore session from stored token
  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    authFetch("/api/auth/me")
      .then(async (res) => {
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          setToken(storedToken);
        } else {
          // Token is invalid/expired
          setStoredToken(null);
          setToken(null);
        }
      })
      .catch(() => {
        setStoredToken(null);
        setToken(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: "Login failed" }));
      throw new Error(error.message || "Login failed");
    }

    const data = await res.json();
    setUser(data.user);
    setToken(data.token);
    setStoredToken(data.token);
    // Invalidate all queries so they refetch with the new auth state
    queryClient.invalidateQueries();
  }, []);

  const register = useCallback(async (regData: { email: string; username: string; password: string; firstName?: string; lastName?: string }) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(regData),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: "Registration failed" }));
      throw new Error(error.message || "Registration failed");
    }

    const data = await res.json();
    setUser(data.user);
    setToken(data.token);
    setStoredToken(data.token);
    queryClient.invalidateQueries();
  }, []);

  const logout = useCallback(() => {
    // Fire logout request but don't wait for it
    const storedToken = getStoredToken();
    if (storedToken) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${storedToken}` },
      }).catch(() => {});
    }
    setUser(null);
    setToken(null);
    setStoredToken(null);
    queryClient.invalidateQueries();
  }, []);

  return createElement(
    AuthContext.Provider,
    { value: { user, token, isLoading, login, register, logout } },
    children
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/** Helper: get the current auth headers for fetch calls */
export function getAuthHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
