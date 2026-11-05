import Foundation

/// Maps CSL-JSON (returned by DOI content negotiation at doi.org for Crossref, DataCite, and
/// mEDRA DOIs) to `CitationData`.
public enum CSLJSONMapper {
    public enum MappingError: Error, Equatable {
        case notJSONObject
        case missingTitle
    }

    public static func citation(fromCSLJSON data: Data, accessDate: String) throws -> CitationData {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw MappingError.notJSONObject
        }
        return try citation(from: object, accessDate: accessDate)
    }

    public static func citation(from csl: [String: Any], accessDate: String) throws -> CitationData {
        let sourceType = mapType(csl["type"] as? String)
        guard let title = text(csl["title"]).map(HTMLText.clean), !title.isEmpty else {
            throw MappingError.missingTitle
        }

        let subtitle = text(csl["subtitle"]).map(HTMLText.clean)
        let pages = splitPages(text(csl["page"]))
        let doi = text(csl["DOI"]).flatMap(DOI.normalize)
        let url = text(csl["URL"]) ?? doi.flatMap { DOI.resolverURL(for: $0)?.absoluteString }
        let editors = people(csl["editor"])

        var citation = CitationData(
            sourceType: sourceType,
            authors: people(csl["author"]),
            title: title,
            subtitle: sourceType == .book ? subtitle : nil,
            containerTitle: text(csl["container-title"]).map(HTMLText.clean),
            publisher: text(csl["publisher"]),
            publicationPlace: text(csl["publisher-place"]),
            publicationDate: date(csl, keys: ["issued", "published-print", "published-online", "created"]),
            volume: text(csl["volume"]),
            issue: text(csl["issue"]),
            pageStart: pages.start,
            pageEnd: pages.end,
            url: url,
            accessDate: sourceType == .website ? accessDate : nil,
            doi: doi,
            edition: text(csl["edition"]),
            editors: editors.isEmpty ? nil : editors
        )

        // Non-book subtitles read better folded into the title.
        if sourceType != .book, let subtitle, !subtitle.isEmpty, !title.contains(subtitle) {
            citation.title = "\(title): \(subtitle)"
        }
        // Theses list the degree-granting institution as publisher.
        if sourceType == .thesis, citation.publisher == nil {
            citation.publisher = text(csl["institution"])
        }
        return citation.cleaned()
    }

    static func mapType(_ type: String?) -> SourceType {
        switch type?.lowercased() {
        case "article-journal", "journal-article", "review", "review-book": return .journal
        case "book", "monograph", "edited-book", "reference-book": return .book
        case "chapter", "book-chapter", "paper-conference", "entry", "entry-dictionary",
             "entry-encyclopedia", "proceedings-article": return .chapter
        case "thesis", "dissertation": return .thesis
        case "article-newspaper", "article-magazine": return .newspaper
        case "webpage", "post", "post-weblog": return .website
        default: return .other
        }
    }

    /// CSL fields may be a string, a number, or (from some registries) an array of strings.
    static func text(_ value: Any?) -> String? {
        let raw: String?
        switch value {
        case let string as String: raw = string
        case let number as NSNumber: raw = number.stringValue
        case let array as [Any]: raw = array.lazy.compactMap { $0 as? String }.first { !$0.isEmpty }
        default: raw = nil
        }
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    static func people(_ value: Any?) -> [PersonName] {
        guard let entries = value as? [[String: Any]] else { return [] }
        return entries.compactMap { entry -> PersonName? in
            if let family = text(entry["family"]) {
                return PersonName(firstName: text(entry["given"]) ?? "", lastName: family, suffix: text(entry["suffix"]))
            }
            // Organizations and single-field names come through as `literal` or `name`.
            if let literal = text(entry["literal"]) ?? text(entry["name"]) {
                return PersonName(firstName: "", lastName: literal)
            }
            return nil
        }
    }

    static func date(_ csl: [String: Any], keys: [String]) -> String? {
        for key in keys {
            guard let container = csl[key] as? [String: Any] else { continue }
            if let parts = container["date-parts"] as? [[Any]], let first = parts.first, !first.isEmpty {
                let numbers = first.compactMap { part -> Int? in
                    if let number = part as? NSNumber { return number.intValue }
                    if let string = part as? String { return Int(string) }
                    return nil
                }
                guard let year = numbers.first, year > 0 else { continue }
                var value = String(format: "%04d", year)
                if numbers.count > 1, (1...12).contains(numbers[1]) {
                    value += String(format: "-%02d", numbers[1])
                    if numbers.count > 2, (1...31).contains(numbers[2]) {
                        value += String(format: "-%02d", numbers[2])
                    }
                }
                return value
            }
            if let raw = text(container["raw"]), let normalized = PublicationDate.normalize(raw) {
                return normalized
            }
        }
        return nil
    }

    static func splitPages(_ page: String?) -> (start: String?, end: String?) {
        guard let page else { return (nil, nil) }
        let pieces = JS.split(page, pattern: "\\s*[-–—]+\\s*").filter { !$0.isEmpty }
        guard let start = pieces.first else { return (nil, nil) }
        return (start, pieces.count > 1 ? pieces[1] : nil)
    }
}
