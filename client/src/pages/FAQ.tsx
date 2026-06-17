import { useEffect } from "react";
import { ArrowRight, HelpCircle, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { MarketingCta, PublicSiteFooter, PublicSiteHeader } from "@/components/PublicSiteChrome";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { blogArticles, faqGroups } from "@/content/marketingContent";
import { mountJsonLd, updatePageMeta } from "@/lib/pageMeta";

export default function FAQ() {
  useEffect(() => {
    const cleanupMeta = updatePageMeta(
      "ScholarMark FAQ | AI Quotes, Citations, Source-Grounded Writing",
      "Answers about ScholarMark, source-grounded AI writing, citation verification, hallucinated quotes, academic integrity, and Summer Thesis Head Start.",
    );
    const cleanupJsonLd = mountJsonLd({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqGroups.flatMap((group) =>
        group.items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      ),
    });

    return () => {
      cleanupMeta();
      cleanupJsonLd();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicSiteHeader eyebrow="FAQ" />
      <main className="container mx-auto max-w-6xl space-y-10 px-4 py-8 lg:py-12">
        <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="space-y-5">
            <div className="eva-section-title">FAQ</div>
            <h1 className="max-w-3xl text-3xl font-bold tracking-tight md:text-5xl">
              Answers for source-grounded academic writing.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              Clear guidance on ScholarMark, quote context, citation verification, academic
              integrity, and the Summer Thesis Head Start workflow.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/blog/avoid-hallucinated-quotes" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary/60">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Hallucinated quotes
              </Link>
              <Link href="/blog/source-grounded-ai-writing" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary/60">
                <HelpCircle className="h-4 w-4 text-primary" />
                Source grounding
              </Link>
            </div>
          </div>
          <div className="aspect-[16/10] w-full rounded-lg border border-border bg-muted/35 p-3">
            <img
              src="/campaign-assets/summer-thesis-verification-workflow.png"
              alt="ScholarMark verification workflow"
              className="h-full w-full object-contain"
            />
          </div>
        </section>

        <section className="grid gap-5">
          {faqGroups.map((group) => (
            <Card key={group.title} className="border-border bg-card/75">
              <CardContent className="grid gap-5 p-5 md:grid-cols-[260px_minmax(0,1fr)] md:p-6">
                <div className="space-y-2">
                  <div className="text-xs font-mono uppercase tracking-[0.22em] text-primary">
                    {group.title}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{group.description}</p>
                </div>
                <Accordion type="single" collapsible className="w-full">
                  {group.items.map((item) => (
                    <AccordionItem key={item.question} value={item.question}>
                      <AccordionTrigger className="text-left text-sm font-semibold">
                        {item.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-sm leading-6 text-muted-foreground">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="eva-section-title">Related Guides</div>
              <h2 className="text-2xl font-semibold tracking-tight">Go deeper</h2>
            </div>
            <Link href="/blog" className="text-sm font-medium text-primary hover:underline">
              Blog hub
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {blogArticles.slice(1, 4).map((article) => (
              <Link key={article.slug} href={`/blog/${article.slug}`} className="group block">
                <Card className="h-full border-border bg-card/75 transition-colors group-hover:border-primary/60">
                  <CardContent className="space-y-3 p-5">
                    <div className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                      {article.category}
                    </div>
                    <h3 className="text-lg font-semibold leading-snug tracking-tight">
                      {article.title}
                    </h3>
                    <p className="text-sm leading-6 text-muted-foreground">{article.excerpt}</p>
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                      Read guide
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
