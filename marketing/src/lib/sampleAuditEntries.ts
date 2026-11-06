import { guidesFixtureDir } from "../config/release";

/**
 * Guides that link to the homepage sample citation check, with copy tied to what each
 * guide teaches. The entry renders after the guide's own text; the guide content, URL
 * and the number of guides are unchanged.
 */
const ENTRIES: Record<string, { title: string; copy: string }> = {
  "pre-submission-quote-and-citation-check": {
    title: "See the wording and page passes on a sample draft",
    copy: "Three citations from an invented survey report, each beside its source page: one matches, one has a word added, one cites the wrong page.",
  },
  "citing-page-numbers-pdfs-scans-ebooks": {
    title: "See a wrong page number next to the right page",
    copy: "A short synthetic example shows a quotation cited to page 4 beside the source page it actually comes from, with the fix spelled out.",
  },
  "changing-quotations-ellipses-brackets": {
    title: "See an unmarked change to a quotation",
    copy: "A short synthetic example puts a quotation with one added word beside the original sentence, so you can see exactly what changed.",
  },
  "apa-7-direct-quotation-citations": {
    title: "Compare APA quotations with their source page",
    copy: "Three author-date citations from an invented survey report, each beside the original passage and page, with the next step for each.",
  },
};

export const SAMPLE_AUDIT_GUIDES = Object.keys(ENTRIES);

export function sampleAuditEntryFor(slug: string): { title: string; copy: string } | null {
  return ENTRIES[slug] ?? null;
}

/** Fails a real build if a listed guide was renamed or removed, so an entry can't silently vanish. */
export function assertSampleAuditGuidesExist(slugs: string[]): void {
  if (guidesFixtureDir) return;
  const missing = SAMPLE_AUDIT_GUIDES.filter((slug) => !slugs.includes(slug));
  if (missing.length) {
    throw new Error(`Sample audit entries point at guides that don't exist: ${missing.join(", ")}`);
  }
}
