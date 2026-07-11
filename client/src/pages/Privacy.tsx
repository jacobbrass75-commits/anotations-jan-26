import { BookOpen } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";

const sections = [
  {
    title: "What ScholarMark Collects",
    body: [
      "Account information such as your user identifier, email address, and subscription tier.",
      "Research content you add to ScholarMark, including uploaded source files, pasted text, notes, annotations, writing drafts, web clips, and generated citation metadata.",
      "Campaign and early access information you choose to provide, such as name, email, school, major, class year, paper type, topic status, invite code, referral source, and activation status.",
      "Campaign attribution data from invite links, such as campus, major, channel, referral code, landing path, and visit timestamps.",
      "Chrome extension clip data when you choose to save selected text, including the selected text, surrounding context, page URL, page title, site name, author metadata, publication date metadata, selected category, and default project destination.",
      "Billing metadata such as customer IDs, subscription status, plan tier, payment status, and billing period dates. ScholarMark does not store full card numbers.",
      "Basic operational data needed to secure, debug, and improve the service, such as authentication state, API key identifiers, request timestamps, and error logs.",
    ],
  },
  {
    title: "How Data Is Used",
    body: [
      "ScholarMark uses your data to save research materials, organize projects, generate citations, support annotation and writing workflows, authenticate users, prevent abuse, and provide account support.",
      "Campaign data is used to manage early access, measure which invite links and channels are working, follow up with interested students, and understand whether a lead becomes an active user.",
      "The Chrome extension sends page content to ScholarMark only after you intentionally connect your account and use the save action from the extension, context menu, or keyboard shortcut.",
      "ScholarMark does not sell personal information or extension-collected browsing content.",
    ],
  },
  {
    title: "Chrome Extension Permissions",
    body: [
      "The extension uses activeTab and scripting to read the current page selection only after a user-initiated save action.",
      "The extension uses storage to keep the ScholarMark server URL, default project selection, and local authentication token needed to save clips.",
      "The extension uses contextMenus to show the Save to ScholarMark option when text is selected.",
      "The extension uses host access for app.scholarmark.ai to authenticate, list projects, save clips, and revoke extension API keys.",
    ],
  },
  {
    title: "Service Providers",
    body: [
      "ScholarMark may use service providers for hosting, authentication, storage, analytics, payment, email, and AI-assisted research features. These providers are used to operate ScholarMark and are not permitted to use your data for unrelated purposes.",
      "Payment information is processed by Stripe, PayPal, or Venmo. ScholarMark stores billing metadata such as customer IDs, subscription status, plan tier, and payment status, but not full card numbers.",
      "Some AI, OCR, citation, drafting, and style-analysis features may send user-selected research content to AI/model providers such as OpenAI or Anthropic.",
      "DeepSeek is disabled by default. If ScholarMark enables it after privacy review, the app will identify it clearly before use. DeepSeek states that it processes data in the People's Republic of China and may use inputs to improve its technology unless the applicable user exercises an available opt-out. Do not use that model for sensitive personal data.",
      "ScholarMark may keep backups, logs, and security records for a limited period after information is removed from the active app, unless a longer retention period is required for legal, billing, security, or abuse-prevention reasons.",
    ],
  },
  {
    title: "Your Controls",
    body: [
      "You can remove or edit many saved materials from within ScholarMark. For account deletion, billing records, or data requests that are not available in-app, contact support@scholarmark.ai.",
      "You can disconnect the Chrome extension by logging out from the extension popup. ScholarMark stores an extension-scoped API key locally and attempts to revoke it during logout.",
      "You can uninstall the Chrome extension at any time from Chrome settings.",
    ],
  },
  {
    title: "Students And Schools",
    body: [
      "ScholarMark is not intended for children under 13.",
      "ScholarMark is a direct-to-user research workspace unless a school separately signs a written agreement with ScholarMark. Users are responsible for following school privacy and academic integrity rules.",
      "ScholarMark does not guarantee that AI-generated outputs, citations, quotations, summaries, or source references are accurate. Users should check all outputs against the original sources.",
    ],
  },
  {
    title: "Contact",
    body: [
      "For privacy, support, billing, cancellation, refund, or account deletion requests, contact support@scholarmark.ai.",
    ],
  },
];

export default function Privacy() {
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
            <Link href="/support" className="hover:text-primary">
              Support
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-10 space-y-6">
        <div className="space-y-3">
          <div className="eva-section-title">Privacy Policy</div>
          <h1 className="text-3xl md:text-4xl font-sans uppercase tracking-[0.12em] text-primary leading-tight">
            ScholarMark Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated July 11, 2026. This policy explains how ScholarMark handles data for the
            web app and Chrome extension.
          </p>
        </div>

        <Card className="eva-clip-panel border-border bg-card/80">
          <CardContent className="p-6 space-y-8">
            {sections.map((section) => (
              <section key={section.title} className="space-y-3">
                <h2 className="text-lg font-sans uppercase tracking-[0.12em] text-primary">
                  {section.title}
                </h2>
                <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
                  {section.body.map((item) => (
                    <li key={item} className="pl-4 border-l border-border">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
