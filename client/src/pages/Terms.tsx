import { BookOpen } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";

const sections = [
  {
    title: "Subscriptions And Billing",
    body: [
      "Paid ScholarMark plans are billed monthly in USD unless a checkout page or written agreement says otherwise.",
      "The standard Pro offer charges $14 when checkout is completed, starts access immediately, and renews for $14 each month until canceled. It is not a free trial.",
      "Venmo or PayPal payments, when offered, provide one month of access unless ScholarMark confirms otherwise.",
      "You can cancel Stripe subscriptions from the Account page Billing Portal or by emailing support@scholarmark.ai. Cancellation stops future renewals; paid access continues through the current billing period unless a refund is issued.",
      "Payments are non-refundable except where required by law or for duplicate, mistaken, or unauthorized charges that ScholarMark confirms.",
    ],
  },
  {
    title: "Academic Integrity",
    body: [
      "ScholarMark helps with research organization, citation formatting, annotation, feedback, and drafting from materials you provide.",
      "ScholarMark does not replace your own work, guarantee grades, or guarantee that citations, quotations, summaries, or AI outputs are accurate.",
      "You are responsible for checking all outputs and following your school, publisher, workplace, or instructor policies.",
    ],
  },
  {
    title: "Your Content",
    body: [
      "You keep ownership of research materials, notes, drafts, and other content you add to ScholarMark.",
      "You give ScholarMark permission to store, process, display, and send selected content to service providers as needed to operate the app features you request.",
      "Do not upload content you do not have permission to use or content that would violate another person's privacy, rights, or academic policies.",
    ],
  },
  {
    title: "Acceptable Use",
    body: [
      "Do not use ScholarMark to cheat, impersonate another person, submit work you are not allowed to submit, abuse the service, bypass access controls, or violate laws or school rules.",
      "ScholarMark may suspend or terminate access for abuse, fraud, payment problems, security risk, or violation of these Terms.",
    ],
  },
  {
    title: "Service Changes",
    body: [
      "ScholarMark may change features, limits, plan details, or these Terms as the product evolves.",
      "For material paid-plan changes, ScholarMark will make a reasonable effort to give notice before the change affects your next renewal.",
    ],
  },
  {
    title: "Support",
    body: [
      "For billing, cancellation, refunds, account deletion, privacy, or support requests, contact support@scholarmark.ai.",
      "ScholarMark aims to respond to support requests within three business days.",
    ],
  },
];

export default function Terms() {
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
            <Link href="/privacy" className="hover:text-primary">
              Privacy
            </Link>
            <Link href="/support" className="hover:text-primary">
              Support
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-10 space-y-6">
        <div className="space-y-3">
          <div className="eva-section-title">Terms</div>
          <h1 className="text-3xl md:text-4xl font-sans uppercase tracking-[0.12em] text-primary leading-tight">
            ScholarMark Terms Of Service
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated July 11, 2026. These terms are written for the first paid launch and should
            be reviewed by counsel as ScholarMark grows.
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
