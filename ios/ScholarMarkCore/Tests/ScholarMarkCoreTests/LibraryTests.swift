import XCTest
@testable import ScholarMarkCore

final class LibraryTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)
    private let t1 = Date(timeIntervalSince1970: 1_700_000_100)

    private func journal(_ title: String = "Coral Reef Recovery", doi: String? = "10.1000/coral") -> CitationData {
        CitationData(
            sourceType: .journal,
            authors: [PersonName(firstName: "Ana", lastName: "Lopez")],
            title: title,
            containerTitle: "Marine Ecology",
            publicationDate: "2021",
            volume: "8",
            doi: doi
        )
    }

    func testAddingSourcesCleansCitationAndScopesToProject() {
        var library = Library(defaultCitationStyle: .mla)
        let project = library.addProject(name: "  HIST 210 Paper ", now: t0)
        XCTAssertEqual(project.name, "HIST 210 Paper")
        XCTAssertEqual(project.citationStyle, .mla, "new projects inherit the default style")

        var messy = journal()
        messy.title = "  Coral Reef Recovery  "
        messy.issue = "   "
        messy.authors.append(PersonName(firstName: " ", lastName: ""))
        let source = library.addSource(messy, to: .project(project.id), origin: .doi, now: t1)

        XCTAssertEqual(source.citation.title, "Coral Reef Recovery")
        XCTAssertNil(source.citation.issue)
        XCTAssertEqual(source.citation.authors.count, 1)
        XCTAssertEqual(library.sources(in: .project(project.id)).map(\.id), [source.id])
        XCTAssertTrue(library.sources(in: .inbox).isEmpty)
        XCTAssertEqual(library.project(project.id)?.updatedAt, t1, "adding a source bumps the project")
    }

    func testUnknownProjectFallsBackToInbox() {
        var library = Library()
        let source = library.addSource(journal(), to: .project(UUID()), origin: .manual)
        XCTAssertNil(source.projectID)
        XCTAssertEqual(library.sources(in: .inbox).count, 1)
    }

    func testDuplicateDetectionByDOIAndURL() {
        var library = Library()
        let first = library.addSource(journal(doi: "10.1000/CORAL"), to: .inbox, origin: .doi)
        XCTAssertEqual(library.duplicate(of: journal(doi: "10.1000/coral"))?.id, first.id)
        XCTAssertNil(library.duplicate(of: journal(doi: "10.1000/coral"), excluding: first.id))

        var page = CitationData(sourceType: .website, title: "Page", url: "https://www.example.com/a")
        library.addSource(page, to: .inbox, origin: .webPage)
        page.url = "http://example.com/a#section"
        XCTAssertNotNil(library.duplicate(of: page))
    }

    func testMoveAndDeleteProjectKeepingSources() {
        var library = Library()
        let project = library.addProject(name: "Thesis")
        let source = library.addSource(journal(), to: .inbox, origin: .manual)

        library.moveSource(source.id, to: .project(project.id), now: t1)
        XCTAssertEqual(library.source(source.id)?.projectID, project.id)
        XCTAssertEqual(library.source(source.id)?.updatedAt, t1)

        library.deleteProject(project.id, keepSources: true)
        XCTAssertTrue(library.projects.isEmpty)
        XCTAssertNil(library.source(source.id)?.projectID, "kept sources move to the Inbox")
    }

    func testDeleteProjectWithSources() {
        var library = Library()
        let project = library.addProject(name: "Old class")
        library.addSource(journal(), to: .project(project.id), origin: .manual)
        let inboxSource = library.addSource(journal("Other", doi: nil), to: .inbox, origin: .manual)

        library.deleteProject(project.id, keepSources: false)
        XCTAssertEqual(library.sources.map(\.id), [inboxSource.id])
    }

    func testQuoteUpsertAndDelete() {
        var library = Library()
        let source = library.addSource(journal(), to: .inbox, origin: .manual)

        var quote = SourceQuote(text: "  Reefs recover within a decade.  ", page: " 45 ", category: .evidence, note: "")
        library.upsertQuote(quote, in: source.id)
        XCTAssertEqual(library.source(source.id)?.quotes.first?.text, "Reefs recover within a decade.")
        XCTAssertEqual(library.source(source.id)?.quotes.first?.page, "45")
        XCTAssertNil(library.source(source.id)?.quotes.first?.note)

        quote.note = "Use in section 2"
        library.upsertQuote(quote, in: source.id)
        XCTAssertEqual(library.source(source.id)?.quotes.count, 1, "same id updates in place")
        XCTAssertEqual(library.source(source.id)?.quotes.first?.note, "Use in section 2")

        library.upsertQuote(SourceQuote(text: "   "), in: source.id)
        XCTAssertEqual(library.source(source.id)?.quotes.count, 1, "blank quotes are ignored")

        library.deleteQuote(quote.id, in: source.id)
        XCTAssertEqual(library.source(source.id)?.quotes.count, 0)
    }

    func testStyleResolution() {
        var library = Library(defaultCitationStyle: .apa)
        let project = library.addProject(name: "Lab report", style: .chicago)
        let projectSource = library.addSource(journal(), to: .project(project.id), origin: .manual)
        let inboxSource = library.addSource(journal("Inbox", doi: nil), to: .inbox, origin: .manual)

        XCTAssertEqual(library.style(for: projectSource), .chicago)
        XCTAssertEqual(library.style(for: inboxSource), .apa)
        XCTAssertEqual(library.displayName(for: .inbox), "Inbox")
        XCTAssertEqual(library.displayName(for: .project(project.id)), "Lab report")
    }

    func testDecodingToleratesMissingOptionalFields() throws {
        let json = """
        {"projects":[{"id":"7E1B7C4A-2F6F-4C59-9B65-4E2A3A9B1C11","name":"Old"}],
         "sources":[{"id":"0B2D4F7E-5A43-4D9E-8E1C-6A7B8C9D0E1F","citation":{"sourceType":"book","authors":[],"title":"T"}}]}
        """
        let library = try JSONDecoder().decode(Library.self, from: Data(json.utf8))
        XCTAssertEqual(library.schemaVersion, 1)
        XCTAssertEqual(library.projects.first?.citationStyle, .chicago)
        XCTAssertEqual(library.sources.first?.notes, "")
        XCTAssertEqual(library.sources.first?.origin, .manual)
        XCTAssertEqual(library.defaultCitationStyle, .chicago)
    }

    func testCitationJSONUsesWebSchemaKeys() throws {
        let citation = CitationData(
            sourceType: .chapter,
            authors: [PersonName(firstName: "A", lastName: "B")],
            title: "T",
            editors: [PersonName(firstName: "E", lastName: "F")]
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let json = String(data: try encoder.encode(citation), encoding: .utf8)
        XCTAssertEqual(
            json,
            #"{"authors":[{"firstName":"A","lastName":"B"}],"editors":[{"firstName":"E","lastName":"F"}],"sourceType":"chapter","title":"T"}"#
        )
    }
}

final class CompletenessReviewTests: XCTestCase {
    private func fields(_ issues: [FieldIssue], _ severity: FieldIssue.Severity) -> Set<CitationField> {
        Set(issues.filter { $0.severity == severity }.map(\.field))
    }

    func testCompleteJournalHasNoIssues() {
        let citation = CitationData(
            sourceType: .journal,
            authors: [PersonName(firstName: "Jane", lastName: "Smith")],
            title: "Archival Patterns",
            containerTitle: "Journal of Research",
            publicationDate: "2023-01-15",
            volume: "12",
            issue: "3",
            pageStart: "101",
            pageEnd: "119",
            doi: "10.1234/example"
        )
        for style in CitationStyle.allCases {
            XCTAssertEqual(CompletenessReview.issues(for: citation, style: style), [], "\(style)")
        }
    }

    func testEmptyJournalFlagsRequiredAndRecommended() {
        let issues = CompletenessReview.issues(for: CitationData(sourceType: .journal), style: .apa)
        XCTAssertEqual(fields(issues, .required), [.title, .authors, .containerTitle, .volume, .publicationDate])
        XCTAssertEqual(fields(issues, .recommended), [.issue, .pages, .doi])
        XCTAssertEqual(issues.first?.severity, .required, "required issues sort first")
    }

    func testChicagoBookNeedsPlaceButMLADoesNot() {
        let book = CitationData(
            sourceType: .book,
            authors: [PersonName(firstName: "John", lastName: "Doe")],
            title: "History of Things",
            publisher: "Acme",
            publicationDate: "2024"
        )
        XCTAssertEqual(fields(CompletenessReview.issues(for: book, style: .chicago), .required), [.publicationPlace])
        XCTAssertTrue(CompletenessReview.issues(for: book, style: .mla).isEmpty)
    }

    func testWebsiteRulesDependOnStyle() {
        let page = CitationData(sourceType: .website, title: "Teens and Social Media", url: "https://example.org/teens")
        XCTAssertEqual(fields(CompletenessReview.issues(for: page, style: .chicago), .required), [.containerTitle, .accessDate])
        XCTAssertEqual(fields(CompletenessReview.issues(for: page, style: .apa), .required), [])
        XCTAssertEqual(
            fields(CompletenessReview.issues(for: page, style: .apa), .recommended),
            [.authors, .containerTitle, .publicationDate]
        )
    }

    func testMalformedValuesAreFlagged() {
        let citation = CitationData(
            sourceType: .other,
            authors: [PersonName(firstName: "Ann", lastName: "")],
            title: "X",
            publicationDate: "May 2020",
            pageEnd: "9",
            url: "not a url",
            accessDate: "yesterday",
            doi: "doi-ish"
        )
        let required = fields(CompletenessReview.issues(for: citation, style: .mla), .required)
        XCTAssertEqual(required, [.authors, .publicationDate, .pages, .url, .accessDate, .doi])
        XCTAssertEqual(CompletenessReview.requiredIssueCount(for: citation, style: .mla), 6)
    }

    func testEditorFieldsMatchSourceType() {
        XCTAssertTrue(CitationField.fields(for: .chapter).contains(.editors))
        XCTAssertFalse(CitationField.fields(for: .website).contains(.volume))
        XCTAssertEqual(CitationField.publisher.label(for: .thesis), "Institution")
        XCTAssertEqual(CitationField.containerTitle.label(for: .journal), "Journal")
    }
}
