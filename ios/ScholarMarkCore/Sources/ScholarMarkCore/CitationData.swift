import Foundation

/// Mirrors `CitationData["sourceType"]` in `shared/schema.ts`.
public enum SourceType: String, Codable, CaseIterable, Identifiable, Sendable {
    case book
    case journal
    case website
    case newspaper
    case chapter
    case thesis
    case other

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .book: return "Book"
        case .journal: return "Journal article"
        case .website: return "Web page"
        case .newspaper: return "News article"
        case .chapter: return "Book chapter"
        case .thesis: return "Thesis / dissertation"
        case .other: return "Other"
        }
    }

    public var systemImage: String {
        switch self {
        case .book: return "book.closed"
        case .journal: return "doc.text"
        case .website: return "globe"
        case .newspaper: return "newspaper"
        case .chapter: return "book"
        case .thesis: return "graduationcap"
        case .other: return "doc"
        }
    }
}

/// Mirrors the author/editor entries in `CitationData`. `suffix` is omitted from JSON when nil,
/// matching the optional field in the web schema.
public struct PersonName: Codable, Hashable, Sendable {
    public var firstName: String
    public var lastName: String
    public var suffix: String?

    public init(firstName: String = "", lastName: String = "", suffix: String? = nil) {
        self.firstName = firstName
        self.lastName = lastName
        self.suffix = suffix
    }

    /// "First Last Suffix", used for display only (not for citation output).
    public var displayName: String {
        [firstName, lastName, suffix ?? ""]
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    public var isEmpty: Bool {
        firstName.trimmingCharacters(in: .whitespaces).isEmpty
            && lastName.trimmingCharacters(in: .whitespaces).isEmpty
    }
}

/// Swift mirror of `CitationData` in `shared/schema.ts`. JSON keys are identical so exported
/// records line up with the ScholarMark web data model.
public struct CitationData: Codable, Hashable, Sendable {
    public var sourceType: SourceType
    public var authors: [PersonName]
    public var title: String
    public var subtitle: String?
    public var containerTitle: String?
    public var publisher: String?
    public var publicationPlace: String?
    public var publicationDate: String?
    public var volume: String?
    public var issue: String?
    public var pageStart: String?
    public var pageEnd: String?
    public var url: String?
    public var accessDate: String?
    public var doi: String?
    public var edition: String?
    public var editors: [PersonName]?

    public init(
        sourceType: SourceType = .website,
        authors: [PersonName] = [],
        title: String = "",
        subtitle: String? = nil,
        containerTitle: String? = nil,
        publisher: String? = nil,
        publicationPlace: String? = nil,
        publicationDate: String? = nil,
        volume: String? = nil,
        issue: String? = nil,
        pageStart: String? = nil,
        pageEnd: String? = nil,
        url: String? = nil,
        accessDate: String? = nil,
        doi: String? = nil,
        edition: String? = nil,
        editors: [PersonName]? = nil
    ) {
        self.sourceType = sourceType
        self.authors = authors
        self.title = title
        self.subtitle = subtitle
        self.containerTitle = containerTitle
        self.publisher = publisher
        self.publicationPlace = publicationPlace
        self.publicationDate = publicationDate
        self.volume = volume
        self.issue = issue
        self.pageStart = pageStart
        self.pageEnd = pageEnd
        self.url = url
        self.accessDate = accessDate
        self.doi = doi
        self.edition = edition
        self.editors = editors
    }

    /// Trims every field, turns empty strings into nil, and drops blank people. Applied before
    /// saving so the generator's "falsy" checks behave the same as in the web app.
    public func cleaned() -> CitationData {
        func clean(_ value: String?) -> String? {
            guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !trimmed.isEmpty else { return nil }
            return trimmed
        }
        func cleanPeople(_ people: [PersonName]) -> [PersonName] {
            people
                .map {
                    PersonName(
                        firstName: $0.firstName.trimmingCharacters(in: .whitespacesAndNewlines),
                        lastName: $0.lastName.trimmingCharacters(in: .whitespacesAndNewlines),
                        suffix: clean($0.suffix)
                    )
                }
                .filter { !$0.isEmpty }
        }

        var copy = self
        copy.authors = cleanPeople(authors)
        copy.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.subtitle = clean(subtitle)
        copy.containerTitle = clean(containerTitle)
        copy.publisher = clean(publisher)
        copy.publicationPlace = clean(publicationPlace)
        copy.publicationDate = clean(publicationDate)
        copy.volume = clean(volume)
        copy.issue = clean(issue)
        copy.pageStart = clean(pageStart)
        copy.pageEnd = clean(pageEnd)
        copy.url = clean(url)
        copy.accessDate = clean(accessDate)
        copy.doi = clean(doi).map { DOI.normalize($0) ?? $0 }
        copy.edition = clean(edition)
        if let editors {
            let cleanedEditors = cleanPeople(editors).map {
                PersonName(firstName: $0.firstName, lastName: $0.lastName)
            }
            copy.editors = cleanedEditors.isEmpty ? nil : cleanedEditors
        }
        return copy
    }

    /// Short "Author · Year" line for list rows.
    public var bylineSummary: String {
        var parts: [String] = []
        if let first = authors.first {
            let name = first.lastName.isEmpty ? first.firstName : first.lastName
            parts.append(authors.count > 1 ? "\(name) et al." : name)
        }
        if let year = publicationDate?.split(separator: "-").first, !year.isEmpty {
            parts.append(String(year))
        }
        if let container = containerTitle, !container.isEmpty {
            parts.append(container)
        }
        return parts.joined(separator: " · ")
    }

    /// Title used in lists when the user has not entered one yet.
    public var displayTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        if let url, let host = URL(string: url)?.host { return host }
        if let doi { return "doi:\(doi)" }
        return "Untitled source"
    }
}

/// Mirrors `citationStyles` in `shared/schema.ts`.
public enum CitationStyle: String, Codable, CaseIterable, Identifiable, Sendable {
    case chicago
    case mla
    case apa

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .chicago: return "Chicago"
        case .mla: return "MLA"
        case .apa: return "APA"
        }
    }

    public var bibliographyHeading: String {
        switch self {
        case .chicago: return "Bibliography"
        case .mla: return "Works Cited"
        case .apa: return "References"
        }
    }

    /// Chicago uses footnotes; MLA and APA use parenthetical in-text citations.
    public var shortCitationLabel: String {
        self == .chicago ? "Footnote" : "In-text citation"
    }
}
