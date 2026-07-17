import { describe, expect, it } from "vitest";
import { blogArticles, getArticle } from "../../client/src/content/marketingContent";

const V3_SLUGS = [
  "writing-v3-quote-integrity-benchmark",
  "context-rot-long-research-projects",
  "writing-v3-living-evidence-packet",
] as const;

describe("marketing blog content", () => {
  it("keeps every article slug unique", () => {
    const slugs = blogArticles.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("publishes the reviewed Writing V3 series with complete metadata", () => {
    for (const slug of V3_SLUGS) {
      const article = getArticle(slug);
      expect(article).toBeDefined();
      expect(article?.title.length).toBeGreaterThan(20);
      expect(article?.metaDescription.length).toBeLessThanOrEqual(170);
      expect(article?.body.length).toBeGreaterThan(2_000);
      expect(article?.faq).toHaveLength(4);
      expect(article?.visual).toMatch(/^\/campaign-assets\/writing-v3-.+\.svg$/);
    }
  });

  it("keeps the benchmark claim boundaries in the public copy", () => {
    const quoteBenchmark = getArticle("writing-v3-quote-integrity-benchmark");
    expect(quoteBenchmark?.body).toContain("99.2% quote integrity");
    expect(quoteBenchmark?.body).toContain("30 wins, 10 ties, and no losses");
    expect(quoteBenchmark?.body).toContain("internal, deterministic synthetic benchmark");

    const contextBenchmark = getArticle("context-rot-long-research-projects");
    expect(contextBenchmark?.body).toContain("0.9643");
    expect(contextBenchmark?.body).toContain("small custom suite");
  });

  it("places the harness explainers in the public article series", () => {
    expect(getArticle("writing-v3-quote-integrity-benchmark")?.body).toContain(
      "/campaign-assets/writing-v3-harness-why-it-works.webp",
    );
    expect(getArticle("context-rot-long-research-projects")?.body).toContain(
      "/campaign-assets/writing-v3-harness-vs-normal-chat.webp",
    );
    expect(getArticle("writing-v3-living-evidence-packet")?.body).toContain(
      "/campaign-assets/writing-v3-harness-source-scale.webp",
    );
  });
});
