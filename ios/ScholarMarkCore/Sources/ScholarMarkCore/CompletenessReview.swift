import Foundation

/// Editable citation fields, in form order.
public enum CitationField: String, CaseIterable, Identifiable, Sendable {
    case authors
    case title
    case subtitle
    case containerTitle
    case editors
    case edition
    case publisher
    case publicationPlace
    case publicationDate
    case volume
    case issue
    case pages
    case doi
    case url
    case accessDate

    public var id: String { rawValue }

    /// Label that reads naturally for the given source type.
    public func label(for type: SourceType) -> String {
        switch self {
        case .authors: return "Authors"
        case .title:
            switch type {
            case .journal, .newspaper: return "Article title"
            case .chapter: return "Chapter title"
            case .website: return "Page title"
            default: return "Title"
            }
        case .subtitle: return "Subtitle"
        case .containerTitle:
            switch type {
            case .journal: return "Journal"
            case .chapter: return "Book title"
            case .website: return "Website name"
            case .newspaper: return "Newspaper / magazine"
            default: return "Container"
            }
        case .editors: return "Editors"
        case .edition: return "Edition"
        case .publisher: return type == .thesis ? "Institution" : "Publisher"
        case .publicationPlace: return "Place of publication"
        case .publicationDate: return "Publication date"
        case .volume: return "Volume"
        case .issue: return "Issue"
        case .pages: return "Pages"
        case .doi: return "DOI"
        case .url: return "URL"
        case .accessDate: return "Date accessed"
        }
    }

    /// Fields the citation generator uses for each type (others are hidden in the editor).
    public static func fields(for type: SourceType) -> [CitationField] {
        switch type {
        case .book:
            return [.authors, .title, .subtitle, .edition, .publisher, .publicationPlace, .publicationDate, .doi, .url]
        case .journal:
            return [.authors, .title, .containerTitle, .volume, .issue, .pages, .publicationDate, .doi, .url]
        case .chapter:
            return [.authors, .title, .containerTitle, .editors, .publisher, .publicationPlace, .publicationDate, .pages, .doi]
        case .website:
            return [.authors, .title, .containerTitle, .publisher, .publicationDate, .url, .accessDate]
        case .newspaper:
            return [.authors, .title, .containerTitle, .publicationDate, .pages, .url]
        case .thesis:
            return [.authors, .title, .publisher, .publicationDate, .url]
        case .other:
            return [.authors, .title, .containerTitle, .publicationDate, .doi, .url]
        }
    }
}

public struct FieldIssue: Hashable, Identifiable, Sendable {
    public enum Severity: Int, Comparable, Sendable {
        case recommended
        case required

        public static func < (lhs: Severity, rhs: Severity) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    public var field: CitationField
    public var severity: Severity
    public var message: String

    public var id: String { "\(field.rawValue)-\(severity.rawValue)-\(message)" }
}

/// Flags fields that are missing or malformed for a source type and style. "Required" means the
/// generated citation will visibly break (empty parentheses, dangling commas); "recommended"
/// means the citation is valid but weaker than the style guide expects.
public enum CompletenessReview {
    public static func issues(for citation: CitationData, style: CitationStyle) -> [FieldIssue] {
        let c = citation.cleaned()
        let type = c.sourceType
        var issues: [FieldIssue] = []

        func label(_ field: CitationField) -> String { field.label(for: type) }
        func require(_ field: CitationField, _ present: Bool, _ why: String? = nil) {
            guard !present else { return }
            issues.append(FieldIssue(field: field, severity: .required, message: why ?? "\(label(field)) is missing."))
        }
        func recommend(_ field: CitationField, _ present: Bool, _ why: String) {
            guard !present else { return }
            issues.append(FieldIssue(field: field, severity: .recommended, message: why))
        }

        let hasAuthors = !c.authors.isEmpty
        let hasDate = c.publicationDate != nil
        let hasContainer = c.containerTitle != nil
        let hasPublisher = c.publisher != nil
        let hasPlace = c.publicationPlace != nil
        let hasPages = c.pageStart != nil

        require(.title, !c.title.isEmpty)

        switch type {
        case .website:
            recommend(.authors, hasAuthors, "Add an author if the page names one.")
        default:
            require(.authors, hasAuthors, "Add at least one author (or the organization as author).")
        }
        if c.authors.contains(where: { $0.lastName.isEmpty }) {
            issues.append(FieldIssue(field: .authors, severity: .required, message: "Every author needs a last name (or organization name)."))
        }

        switch type {
        case .book:
            require(.publisher, hasPublisher)
            require(.publicationDate, hasDate, "Publication year is missing.")
            if style == .chicago {
                require(.publicationPlace, hasPlace, "Chicago needs the place of publication with the publisher.")
            }
        case .journal:
            require(.containerTitle, hasContainer)
            require(.volume, c.volume != nil)
            require(.publicationDate, hasDate, "Publication year is missing.")
            recommend(.issue, c.issue != nil, "Add the issue number if the journal uses one.")
            recommend(.pages, hasPages, "Add the article's page range.")
            recommend(.doi, c.doi != nil, "Add the DOI; Chicago, MLA, and APA all prefer it for articles.")
        case .chapter:
            require(.containerTitle, hasContainer)
            require(.publisher, hasPublisher)
            require(.publicationDate, hasDate, "Publication year is missing.")
            if style == .chicago {
                require(.publicationPlace, hasPlace, "Chicago needs the place of publication with the publisher.")
            }
            recommend(.editors, !(c.editors ?? []).isEmpty, "Add the book's editors if it is an edited volume.")
            recommend(.pages, hasPages, "Add the chapter's page range.")
        case .website:
            require(.url, c.url != nil)
            if style == .chicago {
                require(.containerTitle, hasContainer, "Chicago bibliography entries start with the website name.")
                require(.accessDate, c.accessDate != nil, "Chicago web citations need the date you accessed the page.")
            } else {
                recommend(.containerTitle, hasContainer, "Add the website name.")
            }
            recommend(.publicationDate, hasDate, style == .apa
                ? "No date means APA prints \"n.d.\"; add one if the page shows it."
                : "Add the publication date if the page shows one.")
        case .newspaper:
            require(.containerTitle, hasContainer)
            require(.publicationDate, hasDate)
            recommend(.url, c.url != nil, "Add the URL if you read it online.")
        case .thesis:
            require(.publisher, hasPublisher, "Institution is missing.")
            require(.publicationDate, hasDate, "Year is missing.")
        case .other:
            recommend(.publicationDate, hasDate, "Add a date if the source has one.")
        }

        if let date = c.publicationDate, !PublicationDate.isWellFormed(date) {
            issues.append(FieldIssue(field: .publicationDate, severity: .required, message: "Use YYYY, YYYY-MM, or YYYY-MM-DD for the date."))
        }
        if let date = c.accessDate, !PublicationDate.isWellFormed(date) {
            issues.append(FieldIssue(field: .accessDate, severity: .required, message: "Use YYYY-MM-DD for the access date."))
        }
        if let doi = c.doi, DOI.normalize(doi) == nil {
            issues.append(FieldIssue(field: .doi, severity: .required, message: "This does not look like a DOI (they start with 10.)."))
        }
        if let url = c.url, WebAddress.parse(url) == nil {
            issues.append(FieldIssue(field: .url, severity: .required, message: "This does not look like a web address."))
        }
        if c.pageEnd != nil, c.pageStart == nil {
            issues.append(FieldIssue(field: .pages, severity: .required, message: "Add the first page as well as the last page."))
        }

        return issues.sorted { lhs, rhs in
            if lhs.severity != rhs.severity { return lhs.severity > rhs.severity }
            return order(lhs.field) < order(rhs.field)
        }
    }

    public static func requiredIssueCount(for citation: CitationData, style: CitationStyle) -> Int {
        issues(for: citation, style: style).filter { $0.severity == .required }.count
    }

    private static func order(_ field: CitationField) -> Int {
        CitationField.allCases.firstIndex(of: field) ?? 0
    }
}
