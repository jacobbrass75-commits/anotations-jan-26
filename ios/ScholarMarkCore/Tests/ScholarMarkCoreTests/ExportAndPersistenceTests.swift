import XCTest
@testable import ScholarMarkCore

final class ExporterTests: XCTestCase {
    private let created = Date(timeIntervalSince1970: 1_700_000_000)

    private var sources: [ResearchSource] {
        [
            ResearchSource(
                citation: CitationData(
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
                ),
                notes: "Strong on method.",
                quotes: [SourceQuote(text: "Archives shape memory.", page: "104", category: .argument, createdAt: created)],
                createdAt: created
            ),
            ResearchSource(
                citation: CitationData(
                    sourceType: .book,
                    authors: [PersonName(firstName: "John", lastName: "Doe")],
                    title: "History of Things",
                    publisher: "Acme Press",
                    publicationPlace: "New York",
                    publicationDate: "2024"
                ),
                createdAt: created
            ),
        ]
    }

    func testBibliographyIsAlphabeticalWithStyleHeading() {
        let text = Exporter.bibliography(sources, style: .chicago, title: "Paper")
        XCTAssertEqual(text, """
        Bibliography

        Doe, John. History of Things. New York: Acme Press, 2024.

        Smith, Jane. "Archival Patterns in Modern Research." Journal of Research Systems 12, no. 3 (2023): 101-119. https://doi.org/10.1234/example.

        """)
        XCTAssertTrue(Exporter.bibliography(sources, style: .mla, title: "Paper").hasPrefix("Works Cited\n"))
        XCTAssertTrue(Exporter.bibliography(sources, style: .apa, title: "Paper").hasPrefix("References\n"))
    }

    func testMarkdownIncludesNotesQuotesAndCiteAs() {
        let text = Exporter.markdownNotes(sources, style: .mla, title: "HIST 210", details: "Thesis: archives matter.")
        XCTAssertTrue(text.hasPrefix("# HIST 210\n\nThesis: archives matter."))
        XCTAssertTrue(text.contains("## Archival Patterns in Modern Research"))
        XCTAssertTrue(text.contains("**Notes**\n\nStrong on method."))
        XCTAssertTrue(text.contains("> Archives shape memory."))
        XCTAssertTrue(text.contains("— Argument, p. 104"))
        XCTAssertTrue(text.contains("Cite as: \"Archives shape memory.\" (Smith 104)"))
        XCTAssertTrue(text.contains("## Works Cited"))
    }

    func testBibTeX() {
        let text = Exporter.bibTeX(sources)
        XCTAssertTrue(text.contains("@article{Smith2023Archival,"))
        XCTAssertTrue(text.contains("  author = {Smith, Jane}"))
        XCTAssertTrue(text.contains("  pages = {101--119}"))
        XCTAssertTrue(text.contains("  doi = {10.1234/example}"))
        XCTAssertTrue(text.contains("@book{Doe2024History,"))
        XCTAssertTrue(text.contains("  address = {New York}"))
    }

    func testBibTeXKeysAreUniqueAndEscaped() {
        let citation = CitationData(sourceType: .other, authors: [PersonName(firstName: "", lastName: "R&D Group")], title: "The 50% Rule_v2")
        let text = Exporter.bibTeX([ResearchSource(citation: citation), ResearchSource(citation: citation)])
        XCTAssertTrue(text.contains("@misc{RDGroup50,"))
        XCTAssertTrue(text.contains("@misc{RDGroup50a,"))
        XCTAssertTrue(text.contains("author = {{R\\&D Group}}"))
        XCTAssertTrue(text.contains("title = {The 50\\% Rule\\_v2}"))
    }

    func testRIS() {
        let text = Exporter.ris(sources)
        let lines = text.components(separatedBy: "\r\n")
        XCTAssertEqual(lines.first, "TY  - JOUR")
        XCTAssertTrue(lines.contains("AU  - Smith, Jane"))
        XCTAssertTrue(lines.contains("DA  - 2023/01/15"))
        XCTAssertTrue(lines.contains("SP  - 101"))
        XCTAssertTrue(lines.contains("N1  - \"Archives shape memory.\" (p. 104)"))
        XCTAssertEqual(lines.filter { $0 == "ER  - " }.count, 2)
        XCTAssertTrue(lines.contains("TY  - BOOK"))
    }

    func testJSONUsesWebCitationKeys() throws {
        let text = Exporter.json(sources, title: "Paper", exportedAt: created)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        XCTAssertEqual(object["format"] as? String, "scholarmark-ios-export")
        let first = try XCTUnwrap((object["sources"] as? [[String: Any]])?.first)
        let citation = try XCTUnwrap(first["citation"] as? [String: Any])
        XCTAssertEqual(citation["sourceType"] as? String, "journal")
        XCTAssertEqual(citation["containerTitle"] as? String, "Journal of Research Systems")
        XCTAssertEqual(citation["doi"] as? String, "10.1234/example")
    }

    func testLibraryBackupCanBeRestoredByRepository() throws {
        var library = Library(defaultCitationStyle: .mla)
        let project = library.addProject(name: "Thesis")
        library.addSource(sources[0].citation, to: .project(project.id), origin: .doi)

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Backup-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = LibraryRepository(directory: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data(Exporter.libraryBackup(library).utf8).write(to: repository.fileURL)

        XCTAssertEqual(try repository.load(), library)
    }

    func testFileNamesAreSafe() {
        XCTAssertEqual(Exporter.fileName(title: "HIST 210: Paper/Draft", format: .bibliography, style: .mla), "HIST 210 Paper Draft - Works Cited.txt")
        XCTAssertEqual(Exporter.fileName(title: "Lab", format: .ris, style: .apa), "Lab - RIS.ris")
    }
}

final class LibraryRepositoryTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("ScholarMarkTests-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testMissingFileLoadsEmptyLibrary() throws {
        XCTAssertEqual(try LibraryRepository(directory: directory).load(), Library())
    }

    func testRoundTrip() throws {
        let repository = LibraryRepository(directory: directory)
        var library = Library(defaultCitationStyle: .apa)
        let project = library.addProject(name: "Thesis")
        let source = library.addSource(CitationData(sourceType: .book, title: "Beloved"), to: .project(project.id), origin: .manual)
        library.upsertQuote(SourceQuote(text: "Definitions belong to the definers.", page: "190"), in: source.id)

        try repository.save(library)
        XCTAssertEqual(try repository.load(), library)
    }

    func testDamagedFileIsReportedAndQuarantinedNotDeleted() throws {
        let repository = LibraryRepository(directory: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("{not json".utf8).write(to: repository.fileURL)

        XCTAssertThrowsError(try repository.load()) { error in
            guard case .unreadable = error as? LibraryRepository.RepositoryError else {
                return XCTFail("unexpected error \(error)")
            }
        }

        let moved = try XCTUnwrap(try repository.quarantineDamagedFile(now: Date(timeIntervalSince1970: 42)))
        XCTAssertEqual(moved.lastPathComponent, "library-unreadable-42.json")
        XCTAssertTrue(FileManager.default.fileExists(atPath: moved.path))
        XCTAssertEqual(try repository.load(), Library())
    }

    func testNewerSchemaIsNotOverwritten() throws {
        let repository = LibraryRepository(directory: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data(#"{"schemaVersion": 99, "projects": [], "sources": []}"#.utf8).write(to: repository.fileURL)

        XCTAssertThrowsError(try repository.load()) { error in
            XCTAssertEqual(error as? LibraryRepository.RepositoryError, .newerSchema(found: 99, supported: 1))
        }
    }

    func testDeleteAll() throws {
        let repository = LibraryRepository(directory: directory)
        try repository.save(Library())
        try repository.deleteAll()
        XCTAssertFalse(FileManager.default.fileExists(atPath: repository.fileURL.path))
    }
}
