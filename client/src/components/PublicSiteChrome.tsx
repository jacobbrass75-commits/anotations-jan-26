import { ArrowRight, BookOpen, FileText, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { withRedirectUrl } from "@/lib/redirects";

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "support@scholarmark.ai";

const navLinks = [
  { href: "/summer", label: "Summer" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
  { href: "/pricing", label: "Pricing" },
  { href: "/support", label: "Support" },
] as const;

export function PublicSiteHeader({
  eyebrow = "Source-Grounded Writing",
}: {
  eyebrow?: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md">
      <div className="container mx-auto flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2">
        <Link href="/summer" className="flex items-center gap-3">
          <BookOpen className="h-5 w-5 text-primary" />
          <span className="font-sans text-sm font-bold uppercase tracking-[0.2em] text-primary">
            ScholarMark
          </span>
          <span className="hidden text-xs font-mono uppercase tracking-[0.24em] text-muted-foreground md:inline">
            {eyebrow}
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <nav className="flex flex-wrap items-center justify-end gap-3 text-xs font-mono uppercase tracking-[0.16em] text-muted-foreground">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-primary">
                {link.label}
              </Link>
            ))}
          </nav>
          <Button asChild size="sm" variant="ghost">
            <Link href={withRedirectUrl("/sign-in", "/dashboard")}>Sign in</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function PublicSiteFooter() {
  return (
    <footer className="border-t border-border bg-card/40">
      <div className="container mx-auto flex flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Link href="/summer" className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <span className="font-sans text-sm font-bold uppercase tracking-[0.2em] text-primary">
              ScholarMark
            </span>
          </Link>
          <p className="max-w-xl text-xs leading-5 text-muted-foreground">
            Find the quote. Keep the context. Write from evidence.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <Link href="/blog" className="hover:text-primary">
            Blog
          </Link>
          <Link href="/faq" className="hover:text-primary">
            FAQ
          </Link>
          <Link href="/summer/visuals" className="hover:text-primary">
            Campaign visuals
          </Link>
          <Link href="/privacy" className="hover:text-primary">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-primary">
            Terms
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-primary">
            {SUPPORT_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}

export function MarketingCta({
  title = "Start before fall gets busy.",
  copy = "Build a source base, keep quote context attached, and turn early evidence into a working plan.",
  href = "/summer",
  label = "Start your Summer Thesis Head Start",
}: {
  title?: string;
  copy?: string;
  href?: string;
  label?: string;
}) {
  return (
    <Card className="border-border bg-card/85">
      <CardContent className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Evidence-first workflow
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{copy}</p>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link href={href}>
            <FileText className="mr-2 h-4 w-4" />
            {label}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
