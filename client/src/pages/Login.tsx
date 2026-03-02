import { SignIn } from "@clerk/clerk-react";

export default function Login() {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const redirectTo =
    params?.get("redirect_url") ||
    params?.get("redirect") ||
    "/";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl={`/sign-up?redirect_url=${encodeURIComponent(redirectTo)}`}
      />
    </div>
  );
}
