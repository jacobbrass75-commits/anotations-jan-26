import { SignUp } from "@clerk/clerk-react";
import { Redirect } from "wouter";
import { isLocalDevAuthEnabled } from "@/lib/auth";

export default function Register() {
  if (isLocalDevAuthEnabled()) {
    return <Redirect to="/dashboard" />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in?redirect_url=%2Fdashboard" />
    </div>
  );
}
