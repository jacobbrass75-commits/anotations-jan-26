import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { withRedirectUrl } from "./redirects";

const LOCAL_DEV_AUTH = import.meta.env.VITE_LOCAL_DEV_AUTH === "true";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401 && !LOCAL_DEV_AUTH) {
      // Clerk session expired — redirect to sign-in
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/sign-in")) {
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.href = withRedirectUrl("/sign-in", returnTo);
      }
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
