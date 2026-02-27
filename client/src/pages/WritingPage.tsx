import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FolderOpen, MessageSquare, PenTool } from "lucide-react";
import WritingPane from "@/components/WritingPane";

export default function WritingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <PenTool className="h-5 w-5 text-primary" />
            <h1 className="eva-section-title">AI WRITING</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Home
              </Button>
            </Link>
            <Link href="/projects">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono">
                <FolderOpen className="h-4 w-4 mr-2" />
                Projects
              </Button>
            </Link>
            <Link href="/chat">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono">
                <MessageSquare className="h-4 w-4 mr-2" />
                Chat
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 pb-8 w-full eva-grid-bg">
        <WritingPane />
      </main>
    </div>
  );
}
