import XCTest
@testable import ScholarMarkCore

/// Verifies the Swift generator matches `server/citationGenerator.ts` exactly, using fixtures
/// produced by running the TypeScript source (`ios/Tools/generate-citation-fixtures.mjs`).
final class CitationParityTests: XCTestCase {
    func testEveryFixtureMatchesTheWebGenerator() throws {
        XCTAssertFalse(citationFixtures.isEmpty)

        for fixture in citationFixtures {
            let citation = try JSONDecoder().decode(CitationData.self, from: Data(fixture.citationJSON.utf8))
            let page = fixture.page
            let quote = fixture.quote.replacingOccurrences(of: "\\n", with: "\n")

            let actual: [String: String] = [
                "chicagoFootnote": CitationGenerator.chicagoFootnote(citation, pageNumber: page),
                "chicagoFootnoteSubsequent": CitationGenerator.chicagoFootnote(citation, pageNumber: page, isSubsequent: true),
                "chicagoInline": CitationGenerator.chicagoInline(citation, pageNumber: page),
                "chicagoBibliography": CitationGenerator.chicagoBibliography(citation),
                "footnoteWithQuote": CitationGenerator.footnoteWithQuote(citation, quote: quote, pageNumber: page),
                "mlaWorksCited": CitationGenerator.mlaWorksCited(citation),
                "mlaInText": CitationGenerator.mlaInText(citation, pageNumber: page),
                "apaReference": CitationGenerator.apaReference(citation),
                "apaInText": CitationGenerator.apaInText(citation, pageNumber: page),
                "unifiedFootnoteMLA": CitationGenerator.footnote(citation, style: .mla, pageNumber: page),
                "unifiedBibliographyAPA": CitationGenerator.bibliographyEntry(citation, style: .apa),
            ]

            XCTAssertEqual(Set(actual.keys), Set(fixture.expected.keys), "\(fixture.name): output set changed; regenerate fixtures")
            for (key, expected) in fixture.expected {
                XCTAssertEqual(actual[key], expected, "\(fixture.name).\(key)")
            }
        }
    }

    /// Same expectations as tests/server/citationGenerator.test.ts.
    func testWebUnitTestExpectations() {
        let book = CitationData(
            sourceType: .book,
            authors: [PersonName(firstName: "John", lastName: "Doe")],
            title: "History of Things",
            publisher: "Acme Press",
            publicationPlace: "New York",
            publicationDate: "2024-05-01"
        )
        XCTAssertEqual(CitationGenerator.chicagoFootnote(book, pageNumber: "42"), "John Doe, History of Things (New York: Acme Press, 2024), 42.")
        XCTAssertEqual(CitationGenerator.chicagoFootnote(book, pageNumber: "42", isSubsequent: true), "Doe, History of Things, 42.")
        XCTAssertEqual(CitationGenerator.chicagoInline(book, pageNumber: "42"), "(Doe, History of Things, 42)")
        XCTAssertEqual(CitationGenerator.chicagoBibliography(book), "Doe, John. History of Things. New York: Acme Press, 2024.")

        let journal = CitationData(
            sourceType: .journal,
            authors: [PersonName(firstName: "Jane", lastName: "Smith")],
            title: "Archival Patterns in Modern Research",
            containerTitle: "Journal of Research Systems",
            publicationDate: "2023-01-15",
            volume: "12",
            issue: "3",
            pageStart: "101",
            pageEnd: "119",
            doi: "10.1234/example"
        )
        XCTAssertEqual(
            CitationGenerator.chicagoBibliography(journal),
            "Smith, Jane. \"Archival Patterns in Modern Research.\" Journal of Research Systems 12, no. 3 (2023): 101-119. https://doi.org/10.1234/example."
        )

        let long = CitationGenerator.footnoteWithQuote(book, quote: String(repeating: "A", count: 180), pageNumber: "55")
        XCTAssertTrue(long.contains(": \""))
        XCTAssertTrue(long.contains("..."))
        XCTAssertTrue(long.hasPrefix("John Doe, History of Things"))
        XCTAssertLessThan(long.count, 260)
    }

    func testQuoteCitationForParentheticalStyles() {
        let source = CitationData(sourceType: .book, authors: [PersonName(firstName: "Toni", lastName: "Morrison")], title: "Beloved", publicationDate: "1987")
        XCTAssertEqual(
            CitationGenerator.quoteCitation(source, quote: "  Definitions belong to\nthe definers ", pageNumber: "190", style: .mla),
            "\"Definitions belong to the definers\" (Morrison 190)"
        )
        XCTAssertEqual(
            CitationGenerator.quoteCitation(source, quote: "Definitions belong to the definers", pageNumber: "190", style: .apa),
            "\"Definitions belong to the definers\" (Morrison, 1987, p. 190)"
        )
    }

    func testJSCompatHelpers() {
        XCTAssertEqual(JS.parseInt("05"), 5)
        XCTAssertEqual(JS.parseInt("12abc"), 12)
        XCTAssertNil(JS.parseInt("abc"))
        XCTAssertEqual(JS.split("a  b", on: " "), ["a", "", "b"])
        XCTAssertEqual(JS.split(" Jean-Paul", pattern: "[\\s-]+"), ["", "Jean", "Paul"])
        XCTAssertEqual(JS.collapseWhitespace("  a \n\t b  "), "a b")
    }
}
