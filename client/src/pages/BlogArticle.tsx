import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowRight, BookOpen, Clock, ShieldCheck } from "lucide-react";
import { Link, useRoute } from "wouter";
import { MarketingCta, PublicSiteFooter, PublicSiteHeader } from "@/components/PublicSiteChrome";
import { Card, CardContent } from "@/components/ui/card";
import { blogArticles, getArticle, getRelatedArticles } from "@/content/marketingContent";
import { mountJsonLd, updatePageMeta } from "@/lib/pageMeta";

function MarkdownBody({ body }: { body: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2({ children }) {
          return <h2 className="mt-10 text-2xl font-semibold tracking-tight">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="mt-7 text-lg font-semibold tracking-tight">{children}</h3>;
        },
        p({ children }) {
          return <p className="text-sm leading-7 text-muted-foreground md:text-base">{children}</p>;
        },
        ul({ children }) {
          return (
            <ul className="space-y-2 pl-5 text-sm leading-7 text-muted-foreground md:text-base">
              {children}
            </ul>
          );
        },
        ol({ children }) {
          return (
            <ol className="space-y-2 pl-5 text-sm leading-7 text-muted-foreground md:text-base">
              {children}
            </ol>
          );
        },
        li({ children }) {
          return <li className="pl-1">{children}</li>;
        },
        a({ href = "", children }) {
          if (href.startsWith("/")) {
            return (
              <Link
                href={href}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {children}
              </Link>
            );
          }
          return (
            <a
              href={href}
              className="font-medium text-primary underline-offset-4 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          );
        },
        img({ src = "", alt = "" }) {
          return (
            <img
              src={src}
              alt={alt}
              loading="lazy"
              className="my-7 w-full rounded-lg border border-border bg-muted/30"
            />
          );
        },
      }}
    >
      {body}
    </ReactMarkdown>
  );
}

export default function BlogArticle() {
  const [, params] = useRoute<{ slug: string }>("/blog/:slug");
  const article = getArticle(params?.slug);
  const related = article ? getRelatedArticles(article.slug) : blogArticles.slice(0, 3);

  useEffect(() => {
    if (!article) {
      return updatePageMeta(
        "Article Not Found | ScholarMark",
        "The requested ScholarMark article could not be found.",
      );
    }

    const cleanupMeta = updatePageMeta(
      `${article.seoTitle} | ScholarMark`,
      article.metaDescription,
    );
    const cleanupJsonLd = mountJsonLd({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: article.title,
      description: article.metaDescription,
      image: article.visual,
      author: {
        "@type": "Organization",
        name: "ScholarMark",
      },
      publisher: {
        "@type": "Organization",
        name: "ScholarMark",
      },
      mainEntityOfPage: `/blog/${article.slug}`,
    });

    return () => {
      cleanupMeta();
      cleanupJsonLd();
    };
  }, [article]);

  if (!article) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PublicSiteHeader eyebrow="Blog" />
        <main className="container mx-auto max-w-3xl px-4 py-12">
          <Card className="border-border bg-card/80">
            <CardContent className="space-y-4 p-6 text-center">
              <BookOpen className="mx-auto h-8 w-8 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">Article not found</h1>
              <p className="text-sm text-muted-foreground">
                That guide is not published here yet. The blog hub has the live articles.
              </p>
              <Link
                href="/blog"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to blog
              </Link>
            </CardContent>
          </Card>
        </main>
        <PublicSiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicSiteHeader eyebrow={article.category} />
      <main className="container mx-auto max-w-6xl space-y-8 px-4 py-8 lg:py-12">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Blog
        </Link>

        <article className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="min-w-0 space-y-8">
            <header className="max-w-full space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                <span>{article.category}</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {article.readMinutes} min read
                </span>
              </div>
              <h1 className="max-w-full text-3xl font-bold tracking-tight md:max-w-4xl md:text-5xl">
                {article.title}
              </h1>
              <p className="max-w-full text-base leading-7 text-muted-foreground md:max-w-3xl md:text-lg">
                {article.excerpt}
              </p>
              <div className="aspect-[16/8] w-full max-w-full rounded-lg border border-border bg-muted/35 p-3">
                <img
                  src={article.visual}
                  alt={article.visualAlt}
                  className="h-full w-full object-contain"
                />
              </div>
            </header>

            <section className="max-w-full space-y-5 rounded-lg border border-border bg-card/70 p-5 md:p-8">
              <MarkdownBody body={article.body} />
            </section>

            <Card className="border-border bg-muted/25">
              <CardContent className="flex gap-4 p-5">
                <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-primary" />
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                    Academic integrity note
                  </h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {article.academicIntegrityNote}
                  </p>
                </div>
              </CardContent>
            </Card>

            <section className="space-y-4">
              <div className="eva-section-title">Article FAQ</div>
              <div className="grid gap-3">
                {article.faq.map((item) => (
                  <Card key={item.question} className="border-border bg-card/75">
                    <CardContent className="space-y-2 p-5">
                      <h2 className="text-base font-semibold tracking-tight">{item.question}</h2>
                      <p className="text-sm leading-6 text-muted-foreground">{item.answer}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <MarketingCta
              title={article.ctaText}
              copy="Create a project, organize source context, and start your summer paper workflow from evidence."
              href={article.ctaUrl}
              label="Open Summer Head Start"
            />
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24">
            <Card className="border-border bg-card/75">
              <CardContent className="space-y-4 p-5">
                <div className="eva-section-title">Guide Details</div>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                      Keyword
                    </div>
                    <div>{article.targetKeyword}</div>
                  </div>
                  <div>
                    <div className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                      Audience
                    </div>
                    <div className="text-muted-foreground">{article.audience}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card/75">
              <CardContent className="space-y-4 p-5">
                <div className="eva-section-title">Read Next</div>
                <div className="space-y-3">
                  {related.map((next) => (
                    <Link
                      key={next.slug}
                      href={`/blog/${next.slug}`}
                      className="group block rounded-lg border border-border bg-background/40 p-3 hover:border-primary/60"
                    >
                      <div className="text-xs font-mono uppercase tracking-[0.16em] text-muted-foreground">
                        {next.category}
                      </div>
                      <div className="mt-1 text-sm font-medium leading-5">{next.title}</div>
                      <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                        Open
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </aside>
        </article>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
