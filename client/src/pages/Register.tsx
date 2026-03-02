import { SignUp } from "@clerk/clerk-react";

export default function Register() {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const redirectTo =
    params?.get("redirect_url") ||
    params?.get("redirect") ||
    "/";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl={`/sign-in?redirect_url=${encodeURIComponent(redirectTo)}`}
      />
    </div>
  );
}
