import { BookOpen, LifeBuoy, Mail } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "support@scholarmark.ai";

const supportTopics = [
  "Billing, cancellation, plan changes, and refund requests",
  "Account deletion, privacy questions, and data access requests",
  "Upload, OCR, citation, writing, or Chrome extension issues",
  "Academic integrity or source-checking questions",
];

export default function Support() {
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=ScholarMark%20Support%20Request`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/95">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <span className="font-sans uppercase tracking-[0.2em] font-bold text-primary">
              SCHOLARMARK
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
            <Link href="/terms" className="hover:text-primary">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-primary">
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-10 space-y-6">
        <div className="space-y-3">
          <div className="eva-section-title">Support</div>
          <h1 className="text-3xl md:text-4xl font-sans uppercase tracking-[0.12em] text-primary leading-tight">
            ScholarMark Support
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Email support for billing, cancellation, privacy, account deletion, or product help.
            ScholarMark aims to respond within three business days.
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Public contact:{" "}
            <a href={mailto} className="font-medium text-primary underline-offset-4 hover:underline">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>

        <Card className="eva-clip-panel border-border bg-card/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl font-sans uppercase tracking-[0.12em] text-primary">
              <LifeBuoy className="h-5 w-5" />
              How We Can Help
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
              {supportTopics.map((topic) => (
                <li key={topic} className="pl-4 border-l border-border">
                  {topic}
                </li>
              ))}
            </ul>
            <Button asChild>
              <a href={mailto}>
                <Mail className="mr-2 h-4 w-4" />
                Email {SUPPORT_EMAIL}
              </a>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
