import { useEffect } from "react";
import { ArrowRight, Clock, FileText, Search, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { MarketingCta, PublicSiteFooter, PublicSiteHeader } from "@/components/PublicSiteChrome";
import { Card, CardContent } from "@/components/ui/card";
import { blogArticles } from "@/content/marketingContent";
import { updatePageMeta } from "@/lib/pageMeta";

const featured = blogArticles[0];
const secondary = blogArticles.slice(1);

export default function BlogIndex() {
  useEffect(
    () =>
      updatePageMeta(
        "ScholarMark Blog | Source-Grounded Writing Guides",
        "Guides for thesis planning, source-grounded AI writing, citation verification, quote context, and student-owned academic work.",
      ),
    [],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicSiteHeader eyebrow="Blog" />
      <main className="container mx-auto max-w-7xl space-y-10 px-4 py-8 lg:py-12">
        <section className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="space-y-5">
            <div className="eva-section-title">ScholarMark Blog</div>
            <h1 className="max-w-3xl text-3xl font-bold tracking-tight md:text-5xl">
              Source-grounded writing guides for serious student research.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              Practical workflows for theses, capstones, long papers, quote context, citation
              verification, and AI-assisted writing that keeps the evidence visible.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: Search, label: "Find passages" },
                { icon: FileText, label: "Keep context" },
                { icon: ShieldCheck, label: "Verify before export" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="rounded-lg border border-border bg-card/70 p-4">
                  <Icon className="mb-2 h-5 w-5 text-primary" />
                  <div className="text-sm font-medium">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <Link href={`/blog/${featured.slug}`} className="group block">
            <Card className="overflow-hidden border-border bg-card/80 transition-colors group-hover:border-primary/60">
              <div className="aspect-[16/10] w-full bg-muted/35 p-3">
                <img
                  src={featured.visual}
                  alt={featured.visualAlt}
                  className="h-full w-full object-contain"
                />
              </div>
              <CardContent className="space-y-3 p-5">
                <div className="text-xs font-mono uppercase tracking-[0.22em] text-primary">
                  Featured guide
                </div>
                <h2 className="text-2xl font-semibold tracking-tight">{featured.title}</h2>
                <p className="text-sm leading-6 text-muted-foreground">{featured.excerpt}</p>
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  Read the guide
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="eva-section-title">Latest Guides</div>
              <h2 className="text-2xl font-semibold tracking-tight">Blogs now live</h2>
            </div>
            <Link href="/faq" className="text-sm font-medium text-primary hover:underline">
              Browse FAQ
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {secondary.map((article) => (
              <Link key={article.slug} href={`/blog/${article.slug}`} className="group block">
                <Card className="h-full overflow-hidden border-border bg-card/75 transition-colors group-hover:border-primary/60">
                  <div className="aspect-[16/9] w-full bg-muted/35 p-3">
                    <img
                      src={article.visual}
                      alt={article.visualAlt}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <CardContent className="flex h-full flex-col gap-3 p-5">
                    <div className="flex items-center justify-between gap-3 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                      <span>{article.category}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {article.readMinutes} min
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold leading-snug tracking-tight">
                      {article.title}
                    </h3>
                    <p className="text-sm leading-6 text-muted-foreground">{article.excerpt}</p>
                    <div className="mt-auto flex items-center gap-2 text-sm font-medium text-primary">
                      Read article
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        <MarketingCta />
      </main>
      <PublicSiteFooter />
    </div>
  );
}
