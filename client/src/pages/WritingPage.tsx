import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FolderOpen, MessageSquare, PenLine, PenTool, UserRound } from "lucide-react";
import WritingChat from "@/components/WritingChat";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function WritingPage() {
  const searchParams =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const initialProjectId = searchParams?.get("projectId") || undefined;
  const summerMode = searchParams?.get("summer") === "1";

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 min-h-14 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PenTool className="h-5 w-5 text-primary" />
            <h1 className="eva-section-title">AI WRITING</h1>
          </div>
          <div className="flex w-full sm:w-auto items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 uppercase tracking-wider text-xs font-mono"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Home
              </Button>
            </Link>
            <Link href="/projects">
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 uppercase tracking-wider text-xs font-mono"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Projects
              </Button>
            </Link>
            <Link href="/writing-styles">
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 uppercase tracking-wider text-xs font-mono"
              >
                <PenLine className="h-4 w-4 mr-2" />
                Styles
              </Button>
            </Link>
            <Link href="/chat">
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 uppercase tracking-wider text-xs font-mono"
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                Chat
              </Button>
            </Link>
            <Link href="/account">
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 uppercase tracking-wider text-xs font-mono"
                data-testid="button-open-account"
              >
                <UserRound className="h-4 w-4 mr-2" />
                Account
              </Button>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main
        className="flex-1 container mx-auto px-4 py-6 pb-8 w-full eva-grid-bg"
        style={{ height: "calc(100vh - 56px)" }}
      >
        <WritingChat
          key={initialProjectId ?? "standalone"}
          initialProjectId={initialProjectId}
          summerMode={summerMode}
        />
      </main>
    </div>
  );
}
