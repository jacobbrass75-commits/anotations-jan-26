/**
 * Data for the homepage sample citation check.
 *
 * Everything here is synthetic. The source text is the Riverside survey report written
 * for ScholarMark plugin review and QA
 * (integrations/scholarmark-plugin/listing/review-fixtures/riverside-survey-source.txt);
 * the draft sentences are written for this demo. The results are pre-written, not
 * computed in the browser, and nothing a visitor does here is sent anywhere.
 *
 * `buildSampleAudit()` checks every result against the source text when the site is
 * built, so a wording or page claim in the demo cannot drift away from the text it shows.
 */

export const SAMPLE_SOURCE = {
  author: "Riverside Garden Collective",
  year: "2024",
  title: "Volunteer Retention at the Riverside Community Garden: 2024 Survey Report",
  pageCount: 4,
  /** Verbatim from the fixture, one paragraph per entry. */
  pages: {
    3: [
      "Findings",
      "Thirty-eight percent of respondents stopped volunteering within twelve months of joining.",
      "Volunteers who were paired with a mentor in their first month were more likely to remain active after one year, although the difference was modest and the survey cannot show that mentoring caused it.",
      "The most common reason given for leaving was schedule conflicts (46 percent), followed by moving away (21 percent).",
    ],
    4: [
      "Discussion",
      "Some coordinators believe that shorter shifts would improve retention. Our data do not support this view: retention was similar for two-hour and four-hour shifts.",
      "Because the survey relied on self-report and reached only current and recent volunteers, the results may not describe volunteers who left without responding.",
    ],
  } as Record<number, string[]>,
} as const;

export type AuditStatus = "match" | "wording" | "page";

/** A quotation as it appears in the draft. `added` words are in the draft but not the source. */
type QuoteSegment = { text: string } | { added: string };

interface SampleItemInput {
  id: AuditStatus;
  /** Draft text before the quotation, the quotation itself, and the cited page. */
  lead: string;
  quote: QuoteSegment[];
  citedPage: number;
  /** Page the passage is actually on in the source. */
  foundPage: number;
  status: string;
  headline: string;
  wording: string;
  page: string;
  nextStep: string;
}

const ITEMS: SampleItemInput[] = [
  {
    id: "match",
    lead: "Shift length made little difference:",
    quote: [{ text: "retention was similar for two-hour and four-hour shifts" }],
    citedPage: 4,
    foundPage: 4,
    status: "Matches source",
    headline: "The quotation matches page 4 word for word.",
    wording: "Identical to the source.",
    page: "Found on p. 4, the page cited.",
    nextStep:
      "Nothing to fix. Keep the page attached to the quote while you revise, and check it again if you edit the sentence around it.",
  },
  {
    id: "wording",
    lead: "Mentoring appears to matter: volunteers paired with a mentor",
    quote: [
      { text: "were " },
      { added: "far" },
      { text: " more likely to remain active after one year" },
    ],
    citedPage: 3,
    foundPage: 3,
    status: "Wording differs",
    headline: "One word in the quotation is not in the source.",
    wording: "“far” was added. The source says “were more likely”.",
    page: "Found on p. 3, the page cited.",
    nextStep:
      "Delete “far” so the quotation matches the source exactly. The same sentence calls the difference modest, so check that your claim is no stronger than the source.",
  },
  {
    id: "page",
    lead: "Schedules were the main problem:",
    quote: [{ text: "The most common reason given for leaving was schedule conflicts" }],
    citedPage: 4,
    foundPage: 3,
    status: "Page differs",
    headline: "The wording matches, but the passage is on page 3.",
    wording: "Identical to the source.",
    page: "Cited as p. 4. Page 4 doesn’t contain this passage; it’s on p. 3.",
    nextStep: "Change the citation from p. 4 to p. 3. The quotation itself can stay as it is.",
  },
];

export interface SampleItem extends SampleItemInput {
  /** The quotation as the draft has it, and as the source has it. */
  draftQuote: string;
  sourceQuote: string;
  citation: string;
  /** The source page split around the matching passage, for highlighting. */
  sourcePage: {
    before: string[];
    line: { before: string; match: string; after: string };
    after: string[];
  };
}

function citationFor(page: number): string {
  // A no-break space keeps "p." with its number when the citation wraps.
  return `(${SAMPLE_SOURCE.author}, ${SAMPLE_SOURCE.year}, p.\u00a0${page})`;
}

function pageText(page: number): string[] {
  const lines = SAMPLE_SOURCE.pages[page];
  if (!lines) throw new Error(`Sample audit: the source has no text for page ${page}.`);
  return lines;
}

/** Builds the demo and fails the build if a result contradicts the source text. */
export function buildSampleAudit(): SampleItem[] {
  return ITEMS.map((item) => {
    const draftQuote = item.quote.map((part) => ("text" in part ? part.text : part.added)).join("");
    const sourceQuote = item.quote
      .filter((part): part is { text: string } => "text" in part)
      .map((part) => part.text)
      .join("")
      .replace(/\s{2,}/g, " ");
    const fail = (message: string) => {
      throw new Error(`Sample audit "${item.id}": ${message}`);
    };

    const lines = pageText(item.foundPage);
    const lineIndex = lines.findIndex((line) => line.includes(sourceQuote));
    if (lineIndex === -1) fail(`"${sourceQuote}" is not on p. ${item.foundPage} of the source.`);

    const wordingMatches = draftQuote === sourceQuote;
    const onCitedPage = pageText(item.citedPage).some((line) => line.includes(sourceQuote));
    const expected: AuditStatus = !wordingMatches ? "wording" : onCitedPage ? "match" : "page";
    if (expected !== item.id) fail(`the source text gives "${expected}", not "${item.id}".`);
    if (
      item.id === "wording" &&
      pageText(item.foundPage).some((line) => line.includes(draftQuote))
    ) {
      fail("the altered quotation appears verbatim in the source.");
    }
    if (item.id !== "page" && item.citedPage !== item.foundPage)
      fail("cited and found pages differ.");

    const line = lines[lineIndex];
    const start = line.indexOf(sourceQuote);
    return {
      ...item,
      draftQuote,
      sourceQuote,
      citation: citationFor(item.citedPage),
      sourcePage: {
        before: lines.slice(0, lineIndex),
        line: {
          before: line.slice(0, start),
          match: sourceQuote,
          after: line.slice(start + sourceQuote.length),
        },
        after: lines.slice(lineIndex + 1),
      },
    };
  });
}
