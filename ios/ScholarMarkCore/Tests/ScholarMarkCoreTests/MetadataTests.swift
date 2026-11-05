import XCTest
@testable import ScholarMarkCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class HTMLMetadataParserTests: XCTestCase {
    private let pageURL = URL(string: "https://journals.example.org/article/123#top")!

    func testHighwireTagsProduceJournalCitation() {
        let html = """
        <html><head>
        <title>Ignored | Journal Site</title>
        <meta name="citation_title" content="Archival Patterns in &lt;i&gt;Modern&lt;/i&gt; Research">
        <meta name="citation_author" content="Smith, Jane">
        <meta name="citation_author" content="John Q. Public">
        <meta name="citation_journal_title" content="Journal of Research Systems">
        <meta name="citation_volume" content="12">
        <meta name="citation_issue" content="3">
        <meta name="citation_firstpage" content="101">
        <meta name="citation_lastpage" content="119">
        <meta name="citation_publication_date" content="2023/01/15">
        <meta name="citation_doi" content="doi:10.1234/example">
        <meta name="citation_publisher" content="Example &amp; Sons">
        </head><body></body></html>
        """
        let citation = HTMLMetadataParser.citation(fromHTML: html, pageURL: pageURL, accessDate: "2026-11-05")

        XCTAssertEqual(citation.sourceType, .journal)
        XCTAssertEqual(citation.title, "Archival Patterns in Modern Research")
        XCTAssertEqual(citation.authors, [PersonName(firstName: "Jane", lastName: "Smith"), PersonName(firstName: "John Q.", lastName: "Public")])
        XCTAssertEqual(citation.containerTitle, "Journal of Research Systems")
        XCTAssertEqual(citation.volume, "12")
        XCTAssertEqual(citation.issue, "3")
        XCTAssertEqual(citation.pageStart, "101")
        XCTAssertEqual(citation.pageEnd, "119")
        XCTAssertEqual(citation.publicationDate, "2023-01-15")
        XCTAssertEqual(citation.doi, "10.1234/example")
        XCTAssertEqual(citation.publisher, "Example & Sons")
        XCTAssertEqual(citation.url, "https://journals.example.org/article/123")
        XCTAssertNil(citation.accessDate, "access date only applies to web pages")
    }

    func testOpenGraphTagsProduceWebsiteCitation() {
        let html = """
        <head>
          <meta property='og:title' content='Why Students Cite | Example News'>
          <meta property="og:site_name" content="Example News">
          <meta name=author content="By Rachel Carson">
          <meta property="article:published_time" content="2024-02-10T08:00:00+00:00">
          <TITLE>fallback</TITLE>
        </head>
        """
        let citation = HTMLMetadataParser.citation(fromHTML: html, pageURL: URL(string: "https://www.example.com/story")!, accessDate: "2026-11-05")

        XCTAssertEqual(citation.sourceType, .website)
        XCTAssertEqual(citation.title, "Why Students Cite")
        XCTAssertEqual(citation.containerTitle, "Example News")
        XCTAssertEqual(citation.authors, [PersonName(firstName: "Rachel", lastName: "Carson")])
        XCTAssertEqual(citation.publicationDate, "2024-02-10")
        XCTAssertEqual(citation.accessDate, "2026-11-05")
    }

    func testFallsBackToDocumentTitleAndHost() {
        let html = "<html><head><title>\n  Plain &#8220;Page&#8221; Title \n</title></head></html>"
        let citation = HTMLMetadataParser.citation(fromHTML: html, pageURL: URL(string: "https://www.city.gov/info")!, accessDate: "2026-11-05")
        XCTAssertEqual(citation.title, "Plain “Page” Title")
        XCTAssertEqual(citation.containerTitle, "city.gov")
        XCTAssertTrue(citation.authors.isEmpty)
    }

    func testAuthorURLsAreIgnoredAndThesisDetected() {
        let html = """
        <meta name="author" content="https://facebook.com/someone">
        <meta name="citation_title" content="River Towns">
        <meta name="citation_dissertation_institution" content="Yale University">
        <meta name="citation_date" content="1999">
        """
        let citation = HTMLMetadataParser.citation(fromHTML: html, pageURL: URL(string: "https://repo.example.edu/1")!, accessDate: "2026-11-05")
        XCTAssertEqual(citation.sourceType, .thesis)
        XCTAssertEqual(citation.publisher, "Yale University")
        XCTAssertEqual(citation.publicationDate, "1999")
        XCTAssertTrue(citation.authors.isEmpty)
    }

    func testEntityDecoding() {
        XCTAssertEqual(HTMLText.decodeEntities("Tom &amp; Jerry &#39;s &#x2014; &quot;ok&quot; &amp;lt;"), "Tom & Jerry 's — \"ok\" &lt;")
    }
}

final class CSLJSONMapperTests: XCTestCase {
    func testCrossrefJournalArticle() throws {
        let json = """
        {
          "type": "article-journal",
          "title": "Coral <i>reef</i> recovery",
          "subtitle": ["a decade of data"],
          "container-title": "Marine Ecology",
          "author": [
            {"given": "Ana", "family": "Lopez"},
            {"given": "Ben", "family": "Okafor", "suffix": "Jr."},
            {"literal": "Reef Consortium"}
          ],
          "issued": {"date-parts": [[2021, 7, 3]]},
          "volume": 8,
          "issue": "2",
          "page": "44–59",
          "DOI": "10.5555/Coral.2021",
          "URL": "https://doi.org/10.5555/Coral.2021",
          "publisher": "Example Press"
        }
        """
        let citation = try CSLJSONMapper.citation(fromCSLJSON: Data(json.utf8), accessDate: "2026-11-05")
        XCTAssertEqual(citation.sourceType, .journal)
        XCTAssertEqual(citation.title, "Coral reef recovery: a decade of data")
        XCTAssertNil(citation.subtitle)
        XCTAssertEqual(citation.containerTitle, "Marine Ecology")
        XCTAssertEqual(citation.authors, [
            PersonName(firstName: "Ana", lastName: "Lopez"),
            PersonName(firstName: "Ben", lastName: "Okafor", suffix: "Jr."),
            PersonName(firstName: "", lastName: "Reef Consortium"),
        ])
        XCTAssertEqual(citation.publicationDate, "2021-07-03")
        XCTAssertEqual(citation.volume, "8")
        XCTAssertEqual(citation.pageStart, "44")
        XCTAssertEqual(citation.pageEnd, "59")
        XCTAssertEqual(citation.doi, "10.5555/Coral.2021")
        XCTAssertNil(citation.accessDate)
    }

    func testBookKeepsSubtitleAndEditors() throws {
        let json = """
        {"type": "book", "title": ["Why We Can't Wait"], "subtitle": ["A Memoir"],
         "author": [{"given": "Martin Luther", "family": "King"}],
         "editor": [{"given": "Ed", "family": "Itor"}],
         "publisher": "Beacon Press", "publisher-place": "Boston",
         "published-print": {"date-parts": [["1963"]]}, "edition": 2}
        """
        let citation = try CSLJSONMapper.citation(fromCSLJSON: Data(json.utf8), accessDate: "2026-11-05")
        XCTAssertEqual(citation.sourceType, .book)
        XCTAssertEqual(citation.title, "Why We Can't Wait")
        XCTAssertEqual(citation.subtitle, "A Memoir")
        XCTAssertEqual(citation.publicationPlace, "Boston")
        XCTAssertEqual(citation.publicationDate, "1963")
        XCTAssertEqual(citation.edition, "2")
        XCTAssertEqual(citation.editors, [PersonName(firstName: "Ed", lastName: "Itor")])
    }

    func testTypeMappingAndErrors() {
        XCTAssertEqual(CSLJSONMapper.mapType("paper-conference"), .chapter)
        XCTAssertEqual(CSLJSONMapper.mapType("thesis"), .thesis)
        XCTAssertEqual(CSLJSONMapper.mapType("article-newspaper"), .newspaper)
        XCTAssertEqual(CSLJSONMapper.mapType("dataset"), .other)
        XCTAssertThrowsError(try CSLJSONMapper.citation(fromCSLJSON: Data("[]".utf8), accessDate: "x"))
        XCTAssertThrowsError(try CSLJSONMapper.citation(fromCSLJSON: Data(#"{"type":"book"}"#.utf8), accessDate: "x"))
    }
}

/// Records requests and replays canned responses; no network access.
private final class StubLoader: HTTPDataLoading, @unchecked Sendable {
    struct Reply {
        var status: Int
        var contentType: String
        var body: String
    }

    private let lock = NSLock()
    private var replies: [String: Reply]
    private(set) var requests: [URLRequest] = []

    init(_ replies: [String: Reply]) {
        self.replies = replies
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let reply = lock.withLock { () -> Reply? in
            requests.append(request)
            return replies[request.url?.absoluteString ?? ""]
        }

        guard let reply, let url = request.url else { throw URLError(.cannotFindHost) }
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": reply.contentType])!
        return (Data(reply.body.utf8), response)
    }
}

final class MetadataLookupServiceTests: XCTestCase {
    private let csl = #"{"type":"article-journal","title":"Registered Title","container-title":"Journal","author":[{"given":"Jane","family":"Smith"}],"issued":{"date-parts":[[2020]]},"volume":"1","DOI":"10.1000/xyz","URL":"https://doi.org/10.1000/xyz"}"#

    func testDOILookupUsesContentNegotiation() async throws {
        let loader = StubLoader(["https://doi.org/10.1000/xyz": .init(status: 200, contentType: "application/vnd.citationstyles.csl+json", body: csl)])
        let service = MetadataLookupService(loader: loader, accessDate: { "2026-11-05" })

        let citation = try await service.lookUp(.doi("10.1000/xyz", pageURL: nil))
        XCTAssertEqual(citation.title, "Registered Title")
        XCTAssertEqual(loader.requests.first?.value(forHTTPHeaderField: "Accept"), "application/vnd.citationstyles.csl+json")
        XCTAssertNil(loader.requests.first?.value(forHTTPHeaderField: "Authorization"), "lookups never send credentials")
    }

    func testDOINotFound() async {
        let loader = StubLoader(["https://doi.org/10.1000/missing": .init(status: 404, contentType: "text/html", body: "")])
        let service = MetadataLookupService(loader: loader, accessDate: { "2026-11-05" })
        do {
            _ = try await service.lookUpDOI("10.1000/missing")
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? MetadataLookupError, .doiNotFound("10.1000/missing"))
        }
    }

    func testWebPageLookupUpgradesToHTTPSAndMergesDOIRecord() async throws {
        let html = #"<meta name="citation_title" content="Page Title"><meta name="citation_doi" content="10.1000/xyz">"#
        let loader = StubLoader([
            "https://example.org/article": .init(status: 200, contentType: "text/html; charset=utf-8", body: html),
            "https://doi.org/10.1000/xyz": .init(status: 200, contentType: "application/json", body: csl),
        ])
        let service = MetadataLookupService(loader: loader, accessDate: { "2026-11-05" })

        let citation = try await service.lookUp(.webPage(URL(string: "http://example.org/article")!))
        XCTAssertEqual(loader.requests.first?.url?.absoluteString, "https://example.org/article")
        XCTAssertEqual(citation.title, "Registered Title", "doi.org record wins over meta tags")
        XCTAssertEqual(citation.url, "http://example.org/article", "keeps the address the student captured")
    }

    func testNonHTMLResponsesAreRejected() async {
        let loader = StubLoader(["https://example.org/paper.pdf": .init(status: 200, contentType: "application/pdf", body: "%PDF")])
        let service = MetadataLookupService(loader: loader, accessDate: { "2026-11-05" })
        do {
            _ = try await service.lookUpWebPage(URL(string: "https://example.org/paper.pdf")!)
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? MetadataLookupError, .notAWebPage)
        }
    }

    func testNetworkFailureIsReported() async {
        let service = MetadataLookupService(loader: StubLoader([:]), accessDate: { "2026-11-05" })
        do {
            _ = try await service.lookUpWebPage(URL(string: "https://offline.example")!)
            XCTFail("expected an error")
        } catch {
            guard case .network = error as? MetadataLookupError else {
                return XCTFail("unexpected error \(error)")
            }
        }
    }

    func testTitleInputCannotBeLookedUp() async {
        let service = MetadataLookupService(loader: StubLoader([:]), accessDate: { "2026-11-05" })
        do {
            _ = try await service.lookUp(.title("Beloved"))
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? MetadataLookupError, .nothingToLookUp)
        }
    }

    func testDecodeHTMLHandlesTruncatedUTF8() {
        let data = Data("café".utf8).dropLast()  // cuts the 2-byte "é"
        XCTAssertEqual(MetadataLookupService.decodeHTML(Data(data)), "caf")
    }
}
