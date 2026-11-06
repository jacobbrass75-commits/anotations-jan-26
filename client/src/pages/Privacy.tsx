import { BookOpen } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { clearMarketingConsent } from "@/lib/metaTracking";

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
      "If you allow optional advertising measurement, ScholarMark and Meta may process campaign identifiers, page paths without query strings, device category, browser identifiers such as _fbp and _fbc, IP address, browser user agent, registration events, and hashed account identifiers. ScholarMark does not send research content to Meta.",
    ],
  },
  {
    title: "How Data Is Used",
    body: [
      "ScholarMark uses your data to save research materials, organize projects, generate citations, support annotation and writing workflows, authenticate users, prevent abuse, and provide account support.",
      "Campaign data is used to manage early access, measure which invite links and channels are working, follow up with interested students, and understand whether a lead becomes an active user.",
      "The Chrome extension sends page content to ScholarMark only after you intentionally connect your account and use the save action from the extension, context menu, or keyboard shortcut.",
      "ScholarMark does not sell personal information or extension-collected browsing content.",
      "When you allow optional advertising measurement, ScholarMark uses those events to attribute registrations to ads, measure campaign performance, and help Meta optimize ad delivery. Declining does not change ScholarMark features.",
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
    title: "Claude, ChatGPT, And Codex Connector",
    body: [
      "ScholarMark offers a remote MCP connector at https://mcp.scholarmark.ai/mcp for Claude, ChatGPT, and Codex. You add it in the host app and sign in to ScholarMark through OAuth. The connector then reads and writes only your own ScholarMark account.",
      "When the assistant calls a ScholarMark tool you have authorized, the host app sends ScholarMark the tool's inputs and an OAuth access token. Inputs can include source text you shared in the chat, PDF or text files, summaries, key concepts, highlighted quotes, notes, citation metadata, project names and details, and search queries.",
      "ScholarMark returns what each tool requests, such as project and source lists, stored source text, summaries, highlights, citation metadata, web clips, and search results with links to the ScholarMark app. The host app receives that content in your conversation.",
      "ScholarMark stores what write tools send, including sources, summaries, highlights, notes, and citations, in your account, where it appears in the ScholarMark web app like other saved materials and stays until you delete it. ScholarMark stores hashes of the OAuth tokens it issues, and those tokens expire.",
      "In the connector's default mode, Claude or ChatGPT does the reading, summarizing, and annotating. ScholarMark stores the results and makes no calls to its own AI model providers for connector requests.",
      "Routine connector request logs record the request method and path, the MCP method name, a shortened session ID, the client user agent, response status, timing, and your user ID.",
      "Anthropic operates Claude, and OpenAI operates ChatGPT and Codex. You use those apps under your own agreements with Anthropic or OpenAI, and their terms and privacy policies govern how they store and use your conversations, including content ScholarMark returns to them. ScholarMark processes connector data to provide the features of your ScholarMark account.",
      "You can review and remove saved sources, projects, and highlights in the ScholarMark web app. To stop future access, disconnect ScholarMark in the host app's connector settings. To have ScholarMark revoke issued connector tokens, contact support@scholarmark.ai.",
    ],
  },
  {
    id: "ios",
    title: "ScholarMark For iPhone And iPad",
    body: [
      "The ScholarMark app for iPhone and iPad (the iOS app) works without a ScholarMark account and does not connect to or sync with the ScholarMark web service. The account, billing, campaign, advertising measurement, connector, and server-side data described elsewhere in this policy is not collected through the iOS app. If you also use the web app, the rest of this policy applies to that use.",
      "Projects, sources, citation details, notes, and quotes you enter in the iOS app are stored in the app's own storage on your device, protected by iOS Data Protection. ScholarMark does not receive them. They are included in your device backups, such as iCloud Backup or a backup to your computer, when you have backups turned on, and those backups follow your Apple and device settings.",
      "The iOS app uses the internet only when you tap Look up details for a DOI or link you entered. For a DOI, or a link that contains a DOI, the app sends the DOI to doi.org, which can redirect the request to the DOI registration agency that holds the record, such as Crossref or DataCite. For any other link, the app requests that page from its website over HTTPS and follows any redirects the site sends. If the page names a DOI, the app then looks up that DOI at doi.org.",
      "A lookup request includes the DOI or the page address you entered, standard connection information such as your device's IP address, a User-Agent that identifies the request as a ScholarMark iOS citation lookup, and any cookies those sites set during earlier lookups. The app does not add your library content, ScholarMark account details, or a device identifier. iOS can keep those cookies and a cache of lookup responses in the app's storage on your device.",
      "doi.org, the registration agencies, and the websites you look up receive those requests and handle them under their own terms and privacy policies. ScholarMark does not control what they log or keep.",
      "Open source opens a source's link outside the app, in your default browser or the app that handles that link. Copy, Share citation, Export, and Export full library backup send text or files only where you choose, through the iOS clipboard or share sheet, and the app or service you choose handles them from there. To share a file, the iOS app first writes a temporary copy in its storage on your device.",
      "The iOS app contains no analytics, advertising measurement, tracking, or third-party SDKs. It does not use the Meta Pixel or Conversions API described in this policy.",
      "Your iOS library stays on your device until you delete it. In the app's Settings tab, Delete all projects and sources removes your projects, sources, notes, and quotes from the app. Temporary export copies can remain until iOS clears them or you delete the app. Deleting the app removes everything it stored on the device, including cookies and cached lookup responses. Neither step removes copies in existing device backups or in files you exported or shared. Because ScholarMark does not receive your iOS library, it has no copy to delete on request. For questions about the iOS app, contact support@scholarmark.ai.",
    ],
  },
  {
    title: "Service Providers",
    body: [
      "ScholarMark may use service providers for hosting, authentication, storage, analytics, payment, email, and AI-assisted research features. These providers are used to operate ScholarMark and are not permitted to use your data for unrelated purposes.",
      "Payment information is processed by Stripe, PayPal, or Venmo. ScholarMark stores billing metadata such as customer IDs, subscription status, plan tier, and payment status, but not full card numbers.",
      "Some AI, OCR, citation, drafting, and style-analysis features may send user-selected research content to AI/model providers such as OpenAI or Anthropic.",
      "Meta provides optional advertising measurement through the Meta Pixel and Conversions API. Browser and server events share an event identifier to avoid duplicate counting, and server-side identifiers such as email are normalized and hashed before transmission.",
      "DeepSeek is disabled by default. If ScholarMark enables it after privacy review, the app will identify it clearly before use. DeepSeek states that it processes data in the People's Republic of China and may use inputs to improve its technology unless the applicable user exercises an available opt-out. Do not use that model for sensitive personal data.",
      "ScholarMark takes backup snapshots of its database and uploaded files, including one before each deployment. The backup job keeps the 14 most recent snapshots and removes older ones, so information you delete from the active app remains in existing snapshots until they rotate out.",
      "That rotation covers backups only. ScholarMark may keep logs and security records for a limited period, and keeps records longer when legal, billing, security, or abuse-prevention reasons require it. Content you share with Claude, ChatGPT, Codex, or another host app is handled by that provider under its own policies, outside ScholarMark's backups.",
    ],
  },
  {
    title: "Your Controls",
    body: [
      "You can remove or edit many saved materials from within ScholarMark. For account deletion, billing records, or data requests that are not available in-app, contact support@scholarmark.ai.",
      "You can disconnect the Chrome extension by logging out from the extension popup. ScholarMark stores an extension-scoped API key locally and attempts to revoke it during logout.",
      "You can uninstall the Chrome extension at any time from Chrome settings.",
      "You can allow or decline optional Meta advertising measurement when prompted. ScholarMark also honors Global Privacy Control where supported. Use the control below to clear your saved choice and choose again.",
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
            Last updated November 6, 2026. This policy explains how ScholarMark handles data for the
            web app, the Chrome extension, the MCP connector for Claude, ChatGPT, and Codex, and the
            ScholarMark app for iPhone and iPad. The iOS app works on your device without a
            ScholarMark account; its section below says exactly what it sends and when.
          </p>
        </div>

        <Card className="eva-clip-panel border-border bg-card/80">
          <CardContent className="p-6 space-y-8">
            {sections.map((section) => (
              <section key={section.title} id={section.id} className="space-y-3 scroll-mt-6">
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
            <section className="space-y-3 border-t border-border pt-6">
              <h2 className="text-lg font-sans uppercase tracking-[0.12em] text-primary">
                Advertising Privacy Choice
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Clear your saved choice, return to the public site, and choose Allow or No thanks
                again. Essential first-party security and product analytics are not changed by this
                control.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  clearMarketingConsent();
                  window.location.assign("/");
                }}
              >
                Change optional ad measurement choice
              </Button>
            </section>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
