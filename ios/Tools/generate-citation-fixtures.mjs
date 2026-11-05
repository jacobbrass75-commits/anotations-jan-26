// Generates Swift parity fixtures from the web app's citation generator.
//
//   node ios/Tools/generate-citation-fixtures.mjs
//
// Requires Node 22.18+ (built-in TypeScript type stripping). Reads server/citationGenerator.ts
// without modifying it and writes
// ios/ScholarMarkCore/Tests/ScholarMarkCoreTests/CitationParityFixtures.swift.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const generator = await import(pathToFileURL(join(repoRoot, "server", "citationGenerator.ts")).href);
const outFile = join(here, "..", "ScholarMarkCore", "Tests", "ScholarMarkCoreTests", "CitationParityFixtures.swift");

const person = (firstName, lastName, suffix) => (suffix ? { firstName, lastName, suffix } : { firstName, lastName });
const manyAuthors = Array.from({ length: 22 }, (_, i) => person(`Author${i + 1}`, `Last${i + 1}`));
const shortQuote = "History is   written\nby the victors.";
const longQuote = "The archive is not a neutral space; ".repeat(6).trim();

const cases = [
  ["book_basic", { sourceType: "book", authors: [person("John", "Doe")], title: "History of Things", publicationPlace: "New York", publisher: "Acme Press", publicationDate: "2024-05-01" }, "42", shortQuote],
  ["book_subtitle_edition_suffix", { sourceType: "book", authors: [person("Martin Luther", "King", "Jr.")], title: "Why We Can't Wait", subtitle: "A Memoir", edition: "2nd", publicationPlace: "Boston", publisher: "Beacon Press", publicationDate: "1963" }, "12", longQuote],
  ["book_two_authors_publisher_only", { sourceType: "book", authors: [person("Ada", "Lovelace"), person("Charles", "Babbage")], title: "Notes on the Analytical Engine and Its Many Uses", publisher: "Taylor", publicationDate: "2019-03" }, undefined, shortQuote],
  ["book_no_author", { sourceType: "book", authors: [], title: "Beowulf", publisher: "Norton", publicationDate: "2000" }, "7", shortQuote],
  ["book_sentence_case", { sourceType: "book", authors: [person("Eric", "Hobsbawm")], title: "the age of extremes: a history of the world", publisher: "Vintage", publicationPlace: "New York", publicationDate: "1996-01-02" }, "3", shortQuote],
  ["journal_basic", { sourceType: "journal", authors: [person("Jane", "Smith")], title: "Archival Patterns in Modern Research", containerTitle: "Journal of Research Systems", volume: "12", issue: "3", pageStart: "101", pageEnd: "119", publicationDate: "2023-01-15", doi: "10.1234/example" }, "105", shortQuote],
  ["journal_three_authors_url_start_page", { sourceType: "journal", authors: [person("Ana", "Lopez"), person("Ben", "Okafor"), person("Chen", "Wei")], title: "Coral Reef Recovery", containerTitle: "Marine Ecology", volume: "8", pageStart: "44", publicationDate: "2021-07", url: "https://example.org/articles/coral" }, "45", shortQuote],
  ["journal_four_authors_initials", { sourceType: "journal", authors: [person("Jean-Paul", "Sartre"), person("Mary Ann", "Evans"), person("bell", "hooks"), person("W. E. B.", "Du Bois")], title: "Notes: on existence", containerTitle: "Philosophy Today", volume: "2", issue: "1", publicationDate: "1950" }, "9", shortQuote],
  ["journal_month_only_and_bad_month", { sourceType: "journal", authors: [person("Kim", "Park")], title: "Seasonal Data", containerTitle: "Climate", volume: "4", issue: "2", publicationDate: "2020-13-05", doi: "10.5555/abc(2)" }, undefined, shortQuote],
  ["journal_twenty_two_authors", { sourceType: "journal", authors: manyAuthors, title: "Large Collaboration Results", containerTitle: "Physics Letters", volume: "99", pageStart: "1", pageEnd: "20", publicationDate: "2022-02-02", doi: "10.1000/big" }, "2", shortQuote],
  ["chapter_two_editors", { sourceType: "chapter", authors: [person("Toni", "Morrison")], title: "The Site of Memory", containerTitle: "Inventing the Truth", editors: [person("William", "Zinsser"), person("Russell", "Baker")], publicationPlace: "Boston", publisher: "Houghton Mifflin", pageStart: "83", pageEnd: "102", publicationDate: "1995" }, "85", shortQuote],
  ["chapter_one_editor_no_pages", { sourceType: "chapter", authors: [person("Lee", "Ng"), person("Sam", "Ortiz")], title: "Methods in Oral History", containerTitle: "The Oral History Reader", editors: [person("Robert", "Perks")], publisher: "Routledge", publicationDate: "2016-05" }, undefined, shortQuote],
  ["website_basic", { sourceType: "website", authors: [person("Rachel", "Carson")], title: "Silent Spring Revisited", containerTitle: "Example News", url: "https://www.example.com/silent-spring", accessDate: "2026-11-05", publicationDate: "2024-02-10" }, undefined, shortQuote],
  ["website_no_author_no_date", { sourceType: "website", authors: [], title: "How Citation Works for Students Everywhere", containerTitle: "Library Guides", url: "https://guides.example.edu/citation", accessDate: "2026-01-09" }, undefined, shortQuote],
  ["website_publisher_differs", { sourceType: "website", authors: [person("", "Pew Research Center")], title: "Teens and Social Media", containerTitle: "Pew Research", publisher: "Pew Research Center", url: "http://pewresearch.org/teens", accessDate: "2025-12-01", publicationDate: "2023-11" }, undefined, shortQuote],
  ["website_publisher_only_no_date", { sourceType: "website", authors: [], title: "Data Portal", publisher: "City of Example", url: "https://data.example.gov", accessDate: "2025-03-04" }, undefined, shortQuote],
  ["website_no_site_no_access", { sourceType: "website", authors: [person("Ida", "Wells")], title: "Southern Horrors", url: "https://archive.example.org/wells" }, undefined, shortQuote],
  ["newspaper_basic", { sourceType: "newspaper", authors: [person("Nikole", "Hannah-Jones")], title: "The Idea of America", containerTitle: "New York Times Magazine", publicationDate: "2019-08-14", url: "https://www.nytimes.com/example", pageStart: "14", pageEnd: "26" }, undefined, shortQuote],
  ["newspaper_no_author", { sourceType: "newspaper", authors: [], title: "City Council Votes on Budget", containerTitle: "Daily Planet", publicationDate: "2025-06", pageStart: "A1" }, undefined, shortQuote],
  ["thesis_basic", { sourceType: "thesis", authors: [person("Grace", "Hopper")], title: "New Types of Irreducibility Criteria", publisher: "Yale University", publicationDate: "1934", url: "https://example.edu/hopper" }, "15", shortQuote],
  ["other_with_container", { sourceType: "other", authors: [person("Ken", "Burns")], title: "The Civil War", containerTitle: "PBS", publicationDate: "1990", doi: "10.9999/film" }, undefined, shortQuote],
  ["other_plain_url", { sourceType: "other", authors: [], title: "Untitled Field Recording", url: "https://example.com/audio" }, "1", shortQuote],
];

const outputs = (citation, page, quote) => ({
  chicagoFootnote: generator.generateChicagoFootnote(citation, page),
  chicagoFootnoteSubsequent: generator.generateChicagoFootnote(citation, page, true),
  chicagoInline: generator.generateInlineCitation(citation, page),
  chicagoBibliography: generator.generateChicagoBibliography(citation),
  footnoteWithQuote: generator.generateFootnoteWithQuote(citation, quote, page),
  mlaWorksCited: generator.generateMLAWorksCited(citation),
  mlaInText: generator.generateMLAInText(citation, page),
  apaReference: generator.generateAPAReference(citation),
  apaInText: generator.generateAPAInText(citation, page),
  unifiedFootnoteMLA: generator.generateFootnote(citation, "mla", page),
  unifiedBibliographyAPA: generator.generateBibliographyEntry(citation, "apa"),
});

const raw = (value) => {
  if (value.includes('"##')) throw new Error(`Fixture text contains a raw-string delimiter: ${value}`);
  return `##"${value}"##`;
};

const body = cases
  .map(([name, citation, page, quote]) => {
    const expected = Object.entries(outputs(citation, page, quote))
      .map(([key, value]) => `            "${key}": ${raw(value)},`)
      .join("\n");
    return [
      "    CitationFixture(",
      `        name: "${name}",`,
      `        citationJSON: ${raw(JSON.stringify(citation))},`,
      `        page: ${page === undefined ? "nil" : `"${page}"`},`,
      `        quote: ${raw(quote.replace(/\n/g, "\\n"))},`,
      "        expected: [",
      expected,
      "        ]",
      "    ),",
    ].join("\n");
  })
  .join("\n");

const swift = `// Generated by ios/Tools/generate-citation-fixtures.mjs from server/citationGenerator.ts.
// Do not edit by hand; rerun the script after changing the web generator.

struct CitationFixture {
    let name: String
    let citationJSON: String
    let page: String?
    /// Newlines are stored as the two characters \\n; the test unescapes them.
    let quote: String
    let expected: [String: String]
}

let citationFixtures: [CitationFixture] = [
${body}
]
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, swift);
console.log(`Wrote ${cases.length} fixtures to ${outFile}`);
