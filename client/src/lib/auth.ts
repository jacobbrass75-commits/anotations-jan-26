import { useQuery } from "@tanstack/react-query";
import { useUser, useAuth as useClerkAuth, useClerk } from "@clerk/clerk-react";
import { queryClient } from "./queryClient";

export interface AuthUser {
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
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  subscriptionStatus: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  tier: string;
  logout: () => void;
}

const LOCAL_DEV_AUTH = import.meta.env.VITE_LOCAL_DEV_AUTH === "true";

async function fetchServerAuthUser(options: {
  allowUnauthorized: boolean;
}): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
  });

  if (response.status === 401) {
    if (options.allowUnauthorized) {
      return null;
    }
    throw new Error("Server rejected the authenticated session");
  }

  if (!response.ok) {
    throw new Error("Failed to resolve local auth user");
  }

  return response.json();
}

function useLocalDevAuth(): AuthContextType {
  const { data: user = null, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me", "local-dev-auth"],
    queryFn: () => fetchServerAuthUser({ allowUnauthorized: true }),
    staleTime: Infinity,
    retry: false,
  });

  return {
    user,
    isLoading,
    isLoaded: !isLoading,
    isSignedIn: !!user,
    tier: user?.tier ?? "free",
    logout: () => {
      queryClient.clear();
      window.location.assign("/");
    },
  };
}

function useClerkBackedAuth(): AuthContextType {
  const { user: clerkUser, isLoaded: isUserLoaded } = useUser();
  const {
    isLoaded: isAuthLoaded,
    isSignedIn,
    userId: clerkAuthUserId,
  } = useClerkAuth();
  const { signOut } = useClerk();

  const clerkLoading = !isUserLoaded || !isAuthLoaded;
  const activeClerkUserId = clerkUser?.id ?? clerkAuthUserId ?? null;
  const shouldLoadServerUser =
    !clerkLoading && !!isSignedIn && !!activeClerkUserId;
  const {
    data: serverUser = null,
    isLoading: isServerUserLoading,
    isError: isServerUserError,
  } = useQuery<AuthUser | null>({
    queryKey: [
      "/api/auth/me",
      "clerk-backed",
      activeClerkUserId ?? "signed-out",
    ],
    queryFn: () => fetchServerAuthUser({ allowUnauthorized: false }),
    enabled: shouldLoadServerUser,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const isLoading =
    clerkLoading || (shouldLoadServerUser && isServerUserLoading);

  const tier =
    serverUser?.tier || (clerkUser?.publicMetadata?.tier as string) || "free";
  const user: AuthUser | null = serverUser;
  const effectiveSignedIn = !!isSignedIn && !!serverUser && !isServerUserError;

  const logout = () => {
    signOut();
    queryClient.invalidateQueries();
  };

  return {
    user,
    isLoading,
    isLoaded: !isLoading,
    isSignedIn: effectiveSignedIn,
    tier,
    logout,
  };
}

/** Drop-in replacement for the old useAuth() hook, now backed by Clerk or local dev auth */
export function useAuth(): AuthContextType {
  return LOCAL_DEV_AUTH ? useLocalDevAuth() : useClerkBackedAuth();
}

export function isLocalDevAuthEnabled(): boolean {
  return LOCAL_DEV_AUTH;
}

// ── Tier feature gating ────────────────────────────────────────────

type Feature =
  | "chat"
  | "writing"
  | "deep_write"
  | "source_verified"
  | "export"
  | "bulk_export"
  | "chrome_extension"
  | "bibliography"
  | "endash_toggle"
  | "batch_analysis"
  | "multi_prompt"
  | "vision_ocr"
  | "advanced_vision_ocr"
  | "unlimited_docs"
  | "unlimited_projects"
  | "unlimited_citations";

const FEATURE_TIERS: Record<Feature, string> = {
  chat: "pro",
  writing: "pro",
  deep_write: "max",
  source_verified: "max",
  export: "pro",
  bulk_export: "max",
  chrome_extension: "pro",
  bibliography: "pro",
  endash_toggle: "pro",
  batch_analysis: "max",
  multi_prompt: "max",
  vision_ocr: "pro",
  advanced_vision_ocr: "max",
  unlimited_docs: "pro",
  unlimited_projects: "pro",
  unlimited_citations: "pro",
};

const TIER_LEVELS: Record<string, number> = { free: 0, pro: 1, max: 2 };

/**
 * Auth headers are no longer needed — Clerk uses session cookies.
 * Kept for backward compatibility with hooks that import it.
 */
export function getAuthHeaders(): Record<string, string> {
  return {};
}

export function useUserTier() {
  const { tier } = useAuth();
  const level = TIER_LEVELS[tier] ?? 0;

  function can(feature: Feature): boolean {
    const required = FEATURE_TIERS[feature];
    if (!required) return true;
    return level >= (TIER_LEVELS[required] ?? 0);
  }

  function requiredTier(feature: Feature): string {
    return FEATURE_TIERS[feature] ?? "free";
  }

  return { tier, level, can, requiredTier };
}
