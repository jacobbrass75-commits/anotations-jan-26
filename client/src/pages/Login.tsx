import { SignIn } from "@clerk/clerk-react";
import { Redirect } from "wouter";
import { isLocalDevAuthEnabled } from "@/lib/auth";

export default function Login() {
  if (isLocalDevAuthEnabled()) {
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </div>
  );
}
