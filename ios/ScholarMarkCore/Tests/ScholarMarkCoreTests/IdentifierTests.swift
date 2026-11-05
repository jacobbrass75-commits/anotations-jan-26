import XCTest
@testable import ScholarMarkCore

final class IdentifierTests: XCTestCase {
    func testDOIExtractionFromCommonForms() {
        XCTAssertEqual(DOI.extract(from: "10.1234/example"), "10.1234/example")
        XCTAssertEqual(DOI.extract(from: "doi:10.1234/Example."), "10.1234/Example")
        XCTAssertEqual(DOI.extract(from: "https://doi.org/10.1038/nature12373"), "10.1038/nature12373")
        XCTAssertEqual(DOI.extract(from: "http://dx.doi.org/10.1038/nature12373"), "10.1038/nature12373")
        XCTAssertEqual(
            DOI.extract(from: "https://www.tandfonline.com/doi/full/10.1080/00207543.2020.1750727?src=recsys#abstract"),
            "10.1080/00207543.2020.1750727"
        )
        XCTAssertEqual(DOI.extract(from: "See (10.1000/xyz123) for details"), "10.1000/xyz123")
        XCTAssertEqual(DOI.extract(from: "10.1016/S0140-6736(20)30183-5"), "10.1016/S0140-6736(20)30183-5")
        XCTAssertEqual(DOI.extract(from: "https://doi.org/10.1000%2Fencoded"), "10.1000/encoded")
        XCTAssertNil(DOI.extract(from: "https://example.com/article"))
        XCTAssertNil(DOI.normalize("11.1234/nope"))
    }

    func testDOIResolverURLAndMatching() {
        XCTAssertEqual(DOI.resolverURL(for: "10.1000/a<b>")?.absoluteString, "https://doi.org/10.1000/a%3Cb%3E")
        XCTAssertTrue(DOI.matches("10.1000/ABC", "10.1000/abc"))
        XCTAssertFalse(DOI.matches(nil, "10.1000/abc"))
    }

    func testWebAddressParsing() {
        XCTAssertEqual(WebAddress.parse("example.com/page")?.absoluteString, "https://example.com/page")
        XCTAssertEqual(WebAddress.parse("  https://Example.com/a?b=1 ")?.absoluteString, "https://Example.com/a?b=1")
        XCTAssertNil(WebAddress.parse("not a url"))
        XCTAssertNil(WebAddress.parse("ftp://example.com/file"))
        XCTAssertNil(WebAddress.parse("10.1000/xyz"), "a bare DOI is not a host")
        XCTAssertNil(WebAddress.parse("someone@example.com"))
    }

    func testURLNormalizationMatchesServer() {
        let url = URL(string: "https://example.com/a?b=1#section")!
        XCTAssertEqual(WebAddress.normalize(url), "https://example.com/a?b=1")
        XCTAssertEqual(WebAddress.secureFetchURL(for: URL(string: "http://example.com/x")!).absoluteString, "https://example.com/x")
        XCTAssertTrue(WebAddress.matches("http://www.example.com/a/", "https://example.com/a#top"))
        XCTAssertFalse(WebAddress.matches("https://example.com/a", "https://example.com/b"))
    }

    func testCaptureInputClassification() {
        XCTAssertEqual(CaptureInput.classify(""), .empty)
        XCTAssertEqual(CaptureInput.classify("https://doi.org/10.1000/xyz"), .doi("10.1000/xyz", pageURL: nil))
        XCTAssertEqual(
            CaptureInput.classify("https://journals.example.org/doi/10.1000/xyz"),
            .doi("10.1000/xyz", pageURL: URL(string: "https://journals.example.org/doi/10.1000/xyz"))
        )
        XCTAssertEqual(CaptureInput.classify("example.com/story"), .webPage(URL(string: "https://example.com/story")!))
        XCTAssertEqual(CaptureInput.classify("The Souls of Black Folk"), .title("The Souls of Black Folk"))
        XCTAssertTrue(CaptureInput.classify("10.1000/xyz").canLookUp)
        XCTAssertFalse(CaptureInput.classify("Some title").canLookUp)
    }

    func testManualDraftKeepsWhatWasTyped() {
        let web = CaptureInput.webPage(URL(string: "https://www.example.com/a#b")!).manualDraft(accessDate: "2026-11-05")
        XCTAssertEqual(web.sourceType, .website)
        XCTAssertEqual(web.url, "https://www.example.com/a")
        XCTAssertEqual(web.containerTitle, "example.com")
        XCTAssertEqual(web.accessDate, "2026-11-05")

        let doi = CaptureInput.doi("10.1000/xyz", pageURL: nil).manualDraft(accessDate: "2026-11-05")
        XCTAssertEqual(doi.doi, "10.1000/xyz")
        XCTAssertEqual(doi.url, "https://doi.org/10.1000/xyz")

        XCTAssertEqual(CaptureInput.title("Beloved").manualDraft(accessDate: "x").title, "Beloved")
    }

    func testAuthorNameParserMatchesWebClipBehavior() {
        XCTAssertEqual(AuthorNameParser.parse("By Jane Smith"), [PersonName(firstName: "Jane", lastName: "Smith")])
        XCTAssertEqual(AuthorNameParser.parse("Smith, Jane"), [PersonName(firstName: "Jane", lastName: "Smith")])
        XCTAssertEqual(
            AuthorNameParser.parse("Jane Smith and John   Q. Public"),
            [PersonName(firstName: "Jane", lastName: "Smith"), PersonName(firstName: "John Q.", lastName: "Public")]
        )
        XCTAssertEqual(
            AuthorNameParser.parse("Doe, John; Roe, Richard"),
            [PersonName(firstName: "John", lastName: "Doe"), PersonName(firstName: "Richard", lastName: "Roe")]
        )
        XCTAssertEqual(AuthorNameParser.parse("Plato"), [PersonName(firstName: "", lastName: "Plato")])
        XCTAssertEqual(AuthorNameParser.parse("   "), [])
        XCTAssertEqual(AuthorNameParser.parse(nil), [])
    }

    func testPublicationDateNormalization() {
        XCTAssertEqual(PublicationDate.normalize("2023/1/5"), "2023-01-05")
        XCTAssertEqual(PublicationDate.normalize("2024-05-01T10:00:00Z"), "2024-05-01")
        XCTAssertEqual(PublicationDate.normalize("2021"), "2021")
        XCTAssertEqual(PublicationDate.normalize("2021-7"), "2021-07")
        XCTAssertEqual(PublicationDate.normalize("Published 2022-03-04 by staff"), "2022-03-04")
        XCTAssertEqual(PublicationDate.normalize("March 5, 2020"), "2020-03-05")
        XCTAssertEqual(PublicationDate.normalize("July 2019"), "2019-07")
        XCTAssertNil(PublicationDate.normalize("yesterday"))
        XCTAssertNil(PublicationDate.normalize(""))

        XCTAssertTrue(PublicationDate.isWellFormed("2020"))
        XCTAssertTrue(PublicationDate.isWellFormed("2020-02-29"))
        XCTAssertFalse(PublicationDate.isWellFormed("2020-13"))
        XCTAssertFalse(PublicationDate.isWellFormed("May 2020"))
    }
}
