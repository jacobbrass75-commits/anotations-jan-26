import { type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { Redirect, useLocation, useSearch } from "wouter";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [location] = useLocation();
  const search = useSearch();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isSignedIn) {
    const returnTo = `${location}${search ? `?${search}` : ""}`;
    return <Redirect to={`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`} />;
  }

  return <>{children}</>;
}
