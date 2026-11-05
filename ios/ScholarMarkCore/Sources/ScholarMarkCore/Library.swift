import Foundation

/// Mirrors `annotationCategories` in `shared/schema.ts`, so quotes map onto ScholarMark
/// annotation categories if they are ever synced.
public enum QuoteCategory: String, Codable, CaseIterable, Identifiable, Sendable {
    case keyQuote = "key_quote"
    case argument
    case evidence
    case methodology
    case userAdded = "user_added"

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .keyQuote: return "Key quote"
        case .argument: return "Argument"
        case .evidence: return "Evidence"
        case .methodology: return "Methodology"
        case .userAdded: return "Note"
        }
    }
}

public struct SourceQuote: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var text: String
    public var page: String?
    public var category: QuoteCategory
    public var note: String?
    public var createdAt: Date

    public init(
        id: UUID = UUID(),
        text: String,
        page: String? = nil,
        category: QuoteCategory = .keyQuote,
        note: String? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.text = text
        self.page = page
        self.category = category
        self.note = note
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        text = try container.decode(String.self, forKey: .text)
        page = try container.decodeIfPresent(String.self, forKey: .page)
        category = (try? container.decodeIfPresent(QuoteCategory.self, forKey: .category)) ?? .keyQuote
        note = try container.decodeIfPresent(String.self, forKey: .note)
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
    }
}

public enum CaptureOrigin: String, Codable, Sendable {
    case manual
    case webPage
    case doi
}

public struct ResearchSource: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    /// nil means the source lives in the Inbox.
    public var projectID: UUID?
    public var citation: CitationData
    public var notes: String
    public var quotes: [SourceQuote]
    public var origin: CaptureOrigin
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        projectID: UUID? = nil,
        citation: CitationData,
        notes: String = "",
        quotes: [SourceQuote] = [],
        origin: CaptureOrigin = .manual,
        createdAt: Date = Date(),
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.projectID = projectID
        self.citation = citation
        self.notes = notes
        self.quotes = quotes
        self.origin = origin
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        projectID = try container.decodeIfPresent(UUID.self, forKey: .projectID)
        citation = try container.decode(CitationData.self, forKey: .citation)
        notes = try container.decodeIfPresent(String.self, forKey: .notes) ?? ""
        quotes = try container.decodeIfPresent([SourceQuote].self, forKey: .quotes) ?? []
        origin = (try? container.decodeIfPresent(CaptureOrigin.self, forKey: .origin)) ?? .manual
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
    }
}

public struct ResearchProject: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var name: String
    /// Assignment, thesis, or research question.
    public var details: String
    public var citationStyle: CitationStyle
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        name: String,
        details: String = "",
        citationStyle: CitationStyle = .chicago,
        createdAt: Date = Date(),
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.name = name
        self.details = details
        self.citationStyle = citationStyle
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        details = try container.decodeIfPresent(String.self, forKey: .details) ?? ""
        citationStyle = (try? container.decodeIfPresent(CitationStyle.self, forKey: .citationStyle)) ?? .chicago
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
    }
}

/// Where a list of sources comes from: the Inbox or a project.
public enum ProjectScope: Hashable, Sendable {
    case inbox
    case project(UUID)

    public var projectID: UUID? {
        if case .project(let id) = self { return id }
        return nil
    }

    public init(projectID: UUID?) {
        self = projectID.map(ProjectScope.project) ?? .inbox
    }
}

/// The whole on-device library. Value type so mutations are easy to test and persist.
public struct Library: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 1

    public var schemaVersion: Int
    public var projects: [ResearchProject]
    public var sources: [ResearchSource]
    /// Style for Inbox sources and the default for new projects.
    public var defaultCitationStyle: CitationStyle

    public init(
        projects: [ResearchProject] = [],
        sources: [ResearchSource] = [],
        defaultCitationStyle: CitationStyle = .chicago
    ) {
        self.schemaVersion = Self.currentSchemaVersion
        self.projects = projects
        self.sources = sources
        self.defaultCitationStyle = defaultCitationStyle
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        projects = try container.decodeIfPresent([ResearchProject].self, forKey: .projects) ?? []
        sources = try container.decodeIfPresent([ResearchSource].self, forKey: .sources) ?? []
        defaultCitationStyle = (try? container.decodeIfPresent(CitationStyle.self, forKey: .defaultCitationStyle)) ?? .chicago
    }

    // MARK: Queries

    public func project(_ id: UUID?) -> ResearchProject? {
        guard let id else { return nil }
        return projects.first { $0.id == id }
    }

    public func source(_ id: UUID) -> ResearchSource? {
        sources.first { $0.id == id }
    }

    /// Most recently updated first.
    public func sources(in scope: ProjectScope) -> [ResearchSource] {
        sources
            .filter { $0.projectID == scope.projectID }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    public var sortedProjects: [ResearchProject] {
        projects.sorted { $0.updatedAt > $1.updatedAt }
    }

    public func style(for scope: ProjectScope) -> CitationStyle {
        project(scope.projectID)?.citationStyle ?? defaultCitationStyle
    }

    public func style(for source: ResearchSource) -> CitationStyle {
        style(for: ProjectScope(projectID: source.projectID))
    }

    public func displayName(for scope: ProjectScope) -> String {
        project(scope.projectID)?.name ?? "Inbox"
    }

    /// An existing source with the same DOI or URL, to warn before saving a duplicate.
    public func duplicate(of citation: CitationData, excluding id: UUID? = nil) -> ResearchSource? {
        sources.first { existing in
            guard existing.id != id else { return false }
            if DOI.matches(existing.citation.doi, citation.doi) { return true }
            return WebAddress.matches(existing.citation.url, citation.url)
        }
    }

    // MARK: Mutations

    @discardableResult
    public mutating func addProject(name: String, details: String = "", style: CitationStyle? = nil, now: Date = Date()) -> ResearchProject {
        let project = ResearchProject(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            details: details.trimmingCharacters(in: .whitespacesAndNewlines),
            citationStyle: style ?? defaultCitationStyle,
            createdAt: now
        )
        projects.append(project)
        return project
    }

    public mutating func updateProject(_ project: ResearchProject, now: Date = Date()) {
        guard let index = projects.firstIndex(where: { $0.id == project.id }) else { return }
        var updated = project
        updated.name = project.name.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.updatedAt = now
        projects[index] = updated
    }

    /// Deletes a project. Its sources are deleted too, or moved to the Inbox when `keepSources`.
    public mutating func deleteProject(_ id: UUID, keepSources: Bool, now: Date = Date()) {
        projects.removeAll { $0.id == id }
        if keepSources {
            for index in sources.indices where sources[index].projectID == id {
                sources[index].projectID = nil
                sources[index].updatedAt = now
            }
        } else {
            sources.removeAll { $0.projectID == id }
        }
    }

    @discardableResult
    public mutating func addSource(
        _ citation: CitationData,
        to scope: ProjectScope,
        origin: CaptureOrigin,
        notes: String = "",
        now: Date = Date()
    ) -> ResearchSource {
        let source = ResearchSource(
            projectID: project(scope.projectID)?.id,
            citation: citation.cleaned(),
            notes: notes,
            origin: origin,
            createdAt: now
        )
        sources.append(source)
        touchProject(source.projectID, now: now)
        return source
    }

    public mutating func updateSource(_ id: UUID, now: Date = Date(), _ change: (inout ResearchSource) -> Void) {
        guard let index = sources.firstIndex(where: { $0.id == id }) else { return }
        change(&sources[index])
        sources[index].citation = sources[index].citation.cleaned()
        sources[index].updatedAt = now
        touchProject(sources[index].projectID, now: now)
    }

    public mutating func moveSource(_ id: UUID, to scope: ProjectScope, now: Date = Date()) {
        let target = project(scope.projectID)?.id
        updateSource(id, now: now) { $0.projectID = target }
    }

    public mutating func deleteSource(_ id: UUID) {
        sources.removeAll { $0.id == id }
    }

    public mutating func upsertQuote(_ quote: SourceQuote, in sourceID: UUID, now: Date = Date()) {
        var cleaned = quote
        cleaned.text = quote.text.trimmingCharacters(in: .whitespacesAndNewlines)
        cleaned.page = quote.page?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        cleaned.note = quote.note?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        guard !cleaned.text.isEmpty else { return }

        updateSource(sourceID, now: now) { source in
            if let index = source.quotes.firstIndex(where: { $0.id == cleaned.id }) {
                source.quotes[index] = cleaned
            } else {
                source.quotes.append(cleaned)
            }
        }
    }

    public mutating func deleteQuote(_ quoteID: UUID, in sourceID: UUID, now: Date = Date()) {
        updateSource(sourceID, now: now) { $0.quotes.removeAll { $0.id == quoteID } }
    }

    private mutating func touchProject(_ id: UUID?, now: Date) {
        guard let id, let index = projects.firstIndex(where: { $0.id == id }) else { return }
        projects[index].updatedAt = now
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
