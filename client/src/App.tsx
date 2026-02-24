import { useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DataTicker } from "@/components/DataTicker";
import { BootSequence } from "@/components/BootSequence";
import Home from "@/pages/Home";
import Projects from "@/pages/Projects";
import ProjectWorkspace from "@/pages/ProjectWorkspace";
import ProjectDocument from "@/pages/ProjectDocument";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/projects" component={Projects} />
      <Route path="/projects/:id" component={ProjectWorkspace} />
      <Route path="/projects/:projectId/documents/:docId" component={ProjectDocument} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [booted, setBooted] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {!booted && <BootSequence onComplete={() => setBooted(true)} />}
        <div className="min-h-screen pb-6 eva-scanlines">
          <Router />
        </div>
        <DataTicker />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
