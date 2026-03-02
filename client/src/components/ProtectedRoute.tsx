import { type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Redirect } from "wouter";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isSignedIn) {
    const redirectPath =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/";
    return <Redirect to={`/sign-in?redirect_url=${encodeURIComponent(redirectPath)}`} />;
  }

  return <>{children}</>;
}
