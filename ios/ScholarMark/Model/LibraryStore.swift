import Foundation
import Observation
import ScholarMarkCore

/// App-wide state. Holds the on-device `Library`, applies mutations, and saves after each one.
@MainActor
@Observable
final class LibraryStore {
    private(set) var library: Library
    /// Set when the saved library could not be opened. Saving is paused so the file is never
    /// overwritten until the user chooses what to do.
    private(set) var loadProblem: String? = nil
    private(set) var saveProblem: String? = nil

    private let repository: LibraryRepository?
    let lookupService: MetadataLookupService

    init(repository: LibraryRepository?, lookupService: MetadataLookupService = MetadataLookupService()) {
        self.repository = repository
        self.lookupService = lookupService
        do {
            library = try repository?.load() ?? Library()
        } catch {
            library = Library()
            loadProblem = error.localizedDescription
        }
    }

    static func live() -> LibraryStore {
        do {
            return LibraryStore(repository: LibraryRepository(directory: try LibraryRepository.defaultDirectory()))
        } catch {
            let store = LibraryStore(repository: nil)
            store.loadProblem = "Storage is unavailable: \(error.localizedDescription)"
            return store
        }
    }

    // MARK: Mutations

    func update(_ change: (inout Library) -> Void) {
        change(&library)
        persist()
    }

    @discardableResult
    func addProject(name: String, details: String, style: CitationStyle) -> ResearchProject {
        var created: ResearchProject?
        update { created = $0.addProject(name: name, details: details, style: style) }
        return created!
    }

    @discardableResult
    func addSource(_ citation: CitationData, to scope: ProjectScope, origin: CaptureOrigin) -> ResearchSource {
        var created: ResearchSource?
        update { created = $0.addSource(citation, to: scope, origin: origin) }
        return created!
    }

    /// Moves a damaged library aside (it is kept, not deleted) and starts with an empty one.
    func startFreshAfterLoadProblem() {
        guard let repository else { return }
        do {
            try repository.quarantineDamagedFile()
            library = Library()
            loadProblem = nil
            persist()
        } catch {
            saveProblem = "Could not move the damaged file: \(error.localizedDescription)"
        }
    }

    func deleteEverything() {
        library = Library(defaultCitationStyle: library.defaultCitationStyle)
        do {
            try repository?.deleteAll()
            loadProblem = nil
            persist()
        } catch {
            saveProblem = "Could not delete saved data: \(error.localizedDescription)"
        }
    }

    private func persist() {
        guard loadProblem == nil, let repository else { return }
        do {
            try repository.save(library)
            saveProblem = nil
        } catch {
            saveProblem = "Your last change could not be saved: \(error.localizedDescription)"
        }
    }

    // MARK: Derived

    func issues(for source: ResearchSource) -> [FieldIssue] {
        CompletenessReview.issues(for: source.citation, style: library.style(for: source))
    }

    func requiredIssueCount(for source: ResearchSource) -> Int {
        issues(for: source).filter { $0.severity == .required }.count
    }

    var sourcesNeedingReview: Int {
        library.sources.filter { requiredIssueCount(for: $0) > 0 }.count
    }
}

#if DEBUG
extension LibraryStore {
    /// In-memory store with sample data for SwiftUI previews.
    static func preview() -> LibraryStore {
        let store = LibraryStore(repository: nil)
        store.update { library in
            let project = library.addProject(name: "HIST 210 Research Paper", details: "How do archives shape public memory?", style: .chicago)
            let article = library.addSource(
                CitationData(
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
                to: .project(project.id),
                origin: .doi
            )
            library.upsertQuote(SourceQuote(text: "Archives do not simply store the past; they arrange it.", page: "104", category: .argument), in: article.id)
            library.addSource(
                CitationData(sourceType: .website, title: "Teens and Social Media", url: "https://example.org/teens"),
                to: .project(project.id),
                origin: .webPage
            )
            library.addSource(
                CitationData(sourceType: .book, authors: [PersonName(firstName: "Toni", lastName: "Morrison")], title: "Beloved", publisher: "Knopf", publicationPlace: "New York", publicationDate: "1987"),
                to: .inbox,
                origin: .manual
            )
        }
        return store
    }
}
#endif
