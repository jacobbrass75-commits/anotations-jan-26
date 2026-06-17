import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowDownToLine, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const ASSETS = [
  {
    title: "AI writing with receipts",
    file: "summer-thesis-source-grounded-ai",
    size: "1080 x 1080",
    use: "Best first social post for source-grounded AI positioning.",
  },
  {
    title: "Citations should point back to sources",
    file: "summer-thesis-citation-aware-story",
    size: "1080 x 1920",
    use: "Story/Reel frame for citation verification messaging.",
  },
  {
    title: "Large source base banner",
    file: "summer-thesis-source-base-banner",
    size: "1600 x 500",
    use: "Newsletter or web banner for source-base positioning.",
  },
  {
    title: "Verification workflow",
    file: "summer-thesis-verification-workflow",
    size: "1080 x 1080",
    use: "Trust-building post: AI can be wrong, verification stays in workflow.",
  },
  {
    title: "Get ahead on your thesis",
    file: "summer-thesis-social-square",
    size: "1080 x 1080",
    use: "Primary Summer Thesis Head Start social post.",
  },
  {
    title: "Future you wants an outline",
    file: "summer-thesis-story",
    size: "1080 x 1920",
    use: "Story/Reel frame for outline-first campaign messaging.",
  },
  {
    title: "Letter flyer",
    file: "summer-thesis-letter-flyer",
    size: "1275 x 1650",
    use: "Printable flyer or PDF handout.",
  },
  {
    title: "Campus banner",
    file: "summer-thesis-campus-banner",
    size: "1600 x 500",
    use: "Campus newsletter banner or web header.",
  },
  {
    title: "LinkedIn post",
    file: "summer-thesis-linkedin-post",
    size: "1200 x 627",
    use: "LinkedIn, X card, or department social post.",
  },
  {
    title: "Email header",
    file: "summer-thesis-email-header",
    size: "1200 x 400",
    use: "Header image for academic-office email outreach.",
  },
  {
    title: "Student newspaper ad",
    file: "summer-thesis-newspaper-ad",
    size: "1200 x 675",
    use: "Student newspaper or newsletter ad block.",
  },
  {
    title: "Referral square",
    file: "summer-thesis-referral-square",
    size: "1080 x 1080",
    use: "Referral ask after signup.",
  },
  {
    title: "Compact announcement",
    file: "summer-thesis-compact-announcement",
    size: "900 x 900",
    use: "Discord, GroupMe, group chat, or campus resource post.",
  },
] as const;

const CAROUSEL = [
  "summer-thesis-carousel-01-question",
  "summer-thesis-carousel-02-sources",
  "summer-thesis-carousel-03-outline",
] as const;

function assetUrl(file: string, extension: "png" | "svg") {
  return `/campaign-assets/${file}.${extension}`;
}

export default function SummerVisuals() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Summer Campaign Visuals | ScholarMark";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/summer" className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <span className="font-sans uppercase tracking-[0.2em] font-bold text-primary text-sm">
              ScholarMark
            </span>
            <span className="hidden sm:inline text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
              Campaign Visuals
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
              <Link href="/summer">Landing page</Link>
            </Button>
            <Button size="sm" asChild>
              <a href="/campaign-assets/phone-preview.png">
                <ExternalLink className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Phone preview</span>
                <span className="sm:hidden">Preview</span>
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-8 lg:py-12 space-y-10">
        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] items-center">
          <div className="space-y-5">
            <div className="text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
              Summer Thesis Head Start
            </div>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
              Source-grounded AI writing support students can trust.
            </h1>
            <p className="max-w-2xl text-muted-foreground md:text-lg">
              Use these campaign visuals for academic-office outreach, campus newsletters,
              student org sharing, social posts, and referral pushes.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href="/campaign-assets/summer-thesis-source-grounded-ai.png">
                  <ArrowDownToLine className="mr-2 h-4 w-4" />
                  Download first post
                </a>
              </Button>
            <Button variant="outline" asChild>
              <a href="/campaign-assets/phone-preview.png">Open mobile contact sheet</a>
            </Button>
            <Button variant="ghost" asChild>
              <a href="/campaign-assets/scholarmark-summer-thesis-visuals.zip">
                Download full pack
              </a>
            </Button>
          </div>
          </div>

          <img
            src="/campaign-assets/summer-thesis-source-grounded-ai.png"
            alt="ScholarMark AI writing with receipts campaign visual"
            className="w-full rounded-lg border border-border bg-card shadow-sm"
          />
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            ["Source-grounded", "Feedback tied to the sources students add."],
            ["Citation-aware", "Prompts students to check quotes and citations."],
            ["Integrity-forward", "No promise that AI is perfect; verification stays visible."],
          ].map(([label, copy]) => (
            <div key={label} className="rounded-lg border border-border bg-card p-4">
              <ShieldCheck className="mb-3 h-5 w-5 text-primary" />
              <h2 className="font-semibold tracking-tight">{label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{copy}</p>
            </div>
          ))}
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Ready-to-send assets</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              PNG for posting, SVG for editing. Direct links work on the live domain after deploy.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {ASSETS.map((asset) => (
              <article key={asset.file} className="rounded-lg border border-border bg-card p-4">
                <img
                  src={assetUrl(asset.file, "png")}
                  alt={`ScholarMark campaign asset: ${asset.title}`}
                  className="aspect-[4/3] w-full rounded-md border border-border bg-background object-contain"
                  loading="lazy"
                />
                <div className="mt-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold tracking-tight">{asset.title}</h3>
                      <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                        {asset.size}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{asset.use}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="outline" size="sm" asChild>
                      <a href={assetUrl(asset.file, "png")}>PNG</a>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <a href={assetUrl(asset.file, "svg")}>SVG</a>
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Carousel set</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Three-slide sequence: research question, source planning, outline/revision.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {CAROUSEL.map((file, index) => (
              <article key={file} className="rounded-lg border border-border bg-card p-4">
                <img
                  src={assetUrl(file, "png")}
                  alt={`ScholarMark carousel slide ${index + 1}`}
                  className="w-full rounded-md border border-border bg-background"
                  loading="lazy"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={assetUrl(file, "png")}>PNG</a>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={assetUrl(file, "svg")}>SVG</a>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-muted/30 p-5">
          <h2 className="font-semibold tracking-tight">Approved wording</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use source-grounded, citation-aware, verify against original sources, and writing
            coaching for student-owned work. Avoid absolute claims like "no hallucinations" or
            "always accurate citations"; AI can be wrong, and the student should verify final
            citations, quotes, and school-policy fit.
          </p>
        </section>
      </main>
    </div>
  );
}
