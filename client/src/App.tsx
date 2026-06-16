import { Suspense, lazy, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DataTicker } from "@/components/DataTicker";
import { BootSequence } from "@/components/BootSequence";

const Home = lazy(() => import("@/pages/Home"));
const Projects = lazy(() => import("@/pages/Projects"));
const ProjectWorkspace = lazy(() => import("@/pages/ProjectWorkspace"));
const ProjectDocument = lazy(() => import("@/pages/ProjectDocument"));
const Login = lazy(() => import("@/pages/Login"));
const Register = lazy(() => import("@/pages/Register"));
const SsoCallback = lazy(() => import("@/pages/SsoCallback"));
const Pricing = lazy(() => import("@/pages/Pricing"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const Terms = lazy(() => import("@/pages/Terms"));
const Support = lazy(() => import("@/pages/Support"));
const Account = lazy(() => import("@/pages/Account"));
const Chat = lazy(() => import("@/pages/Chat"));
const WritingPage = lazy(() => import("@/pages/WritingPage"));
const WritingStyles = lazy(() => import("@/pages/WritingStyles"));
const WebClips = lazy(() => import("@/pages/WebClips"));
const ExtensionAuth = lazy(() => import("@/pages/ExtensionAuth"));
const AdminAnalytics = lazy(() => import("@/pages/AdminAnalytics"));
const AdminCampaign = lazy(() => import("@/pages/AdminCampaign"));
const SummerCampaign = lazy(() => import("@/pages/SummerCampaign"));
const SummerOnboarding = lazy(() => import("@/pages/SummerOnboarding"));
const LocalWritingStudio = lazy(() => import("@/pages/LocalWritingStudio"));
const NotFound = lazy(() => import("@/pages/not-found"));

const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLocalPreviewEnabled() {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  return LOCAL_PREVIEW_HOSTS.has(window.location.hostname);
}

function usesPublicShell(pathname: string): boolean {
  return (
    pathname === "/pricing" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/support" ||
    pathname === "/sso-callback" ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/summer") ||
    pathname.startsWith("/invite")
  );
}

function RouteFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center px-6">
      <div className="text-center space-y-2">
        <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
          Loading View
        </div>
        <div className="h-2 w-40 rounded-full bg-border overflow-hidden">
          <div className="h-full w-1/2 animate-pulse bg-primary/60" />
        </div>
      </div>
    </div>
  );
}

function Router() {
  const localPreviewEnabled = isLocalPreviewEnabled();

  return (
    <Switch>
      <Route path="/sign-in" component={Login} />
      <Route path="/sign-in/*" component={Login} />
      <Route path="/sign-up" component={Register} />
      <Route path="/sign-up/*" component={Register} />
      <Route path="/sso-callback" component={SsoCallback} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/support" component={Support} />
      <Route path="/summer/onboarding">
        {() => (
          <ProtectedRoute>
            <SummerOnboarding />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/summer" component={SummerCampaign} />
      <Route path="/invite" component={SummerCampaign} />
      <Route path="/invite/:code" component={SummerCampaign} />
      {localPreviewEnabled && <Route path="/dev/writing-studio" component={LocalWritingStudio} />}
      <Route path="/account">
        {() => (
          <ProtectedRoute>
            <Account />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/extension-auth">
        {() => (
          <ProtectedRoute>
            <ExtensionAuth />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/dashboard">
        {() => (
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/">
        {() => (
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/projects">
        {() => (
          <ProtectedRoute>
            <Projects />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/web-clips">
        {() => (
          <ProtectedRoute>
            <WebClips />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/projects/:id">
        {() => (
          <ProtectedRoute>
            <ProjectWorkspace />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/projects/:projectId/documents/:docId">
        {() => (
          <ProtectedRoute>
            <ProjectDocument />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/chat">
        {() => (
          <ProtectedRoute>
            <Chat />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/chat/:conversationId">
        {() => (
          <ProtectedRoute>
            <Chat />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/write">
        {() => (
          <ProtectedRoute>
            <WritingPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/writing">
        {() => (
          <ProtectedRoute>
            <WritingPage />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/writing-styles">
        {() => (
          <ProtectedRoute>
            <WritingStyles />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/analytics">
        {() => (
          <ProtectedRoute>
            <AdminAnalytics />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/campaign">
        {() => (
          <ProtectedRoute>
            <AdminCampaign />
          </ProtectedRoute>
        )}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [booted, setBooted] = useState(false);
  const [pathname] = useLocation();
  const publicShell = usesPublicShell(pathname);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {!publicShell && !booted && <BootSequence onComplete={() => setBooted(true)} />}
        <div className={publicShell ? "min-h-screen" : "min-h-screen pb-6 eva-scanlines"}>
          <Suspense fallback={<RouteFallback />}>
            <Router />
          </Suspense>
        </div>
        {!publicShell && <DataTicker />}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
