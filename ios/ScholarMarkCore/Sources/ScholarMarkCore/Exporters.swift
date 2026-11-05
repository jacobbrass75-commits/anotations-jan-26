import Foundation

public enum ExportFormat: String, CaseIterable, Identifiable, Sendable {
    case bibliography
    case markdownNotes
    case bibtex
    case ris
    case json

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .bibliography: return "Bibliography (text)"
        case .markdownNotes: return "Notes & quotes (Markdown)"
        case .bibtex: return "BibTeX (.bib)"
        case .ris: return "RIS (Zotero, EndNote, Mendeley)"
        case .json: return "ScholarMark JSON backup"
        }
    }

    public var fileExtension: String {
        switch self {
        case .bibliography: return "txt"
        case .markdownNotes: return "md"
        case .bibtex: return "bib"
        case .ris: return "ris"
        case .json: return "json"
        }
    }

    func fileLabel(style: CitationStyle) -> String {
        switch self {
        case .bibliography: return style.bibliographyHeading
        case .markdownNotes: return "Notes"
        case .bibtex: return "BibTeX"
        case .ris: return "RIS"
        case .json: return "Backup"
        }
    }

    /// Whether the chosen citation style changes the output.
    public var usesCitationStyle: Bool {
        self == .bibliography || self == .markdownNotes
    }
}

public enum Exporter {
    public static func export(
        _ sources: [ResearchSource],
        format: ExportFormat,
        style: CitationStyle,
        title: String,
        details: String = "",
        exportedAt: Date = Date()
    ) -> String {
        switch format {
        case .bibliography: return bibliography(sources, style: style, title: title)
        case .markdownNotes: return markdownNotes(sources, style: style, title: title, details: details)
        case .bibtex: return bibTeX(sources)
        case .ris: return ris(sources)
        case .json: return json(sources, title: title, exportedAt: exportedAt)
        }
    }

    /// Safe file name, e.g. "HIST 210 Paper - Works Cited.txt".
    public static func fileName(title: String, format: ExportFormat, style: CitationStyle) -> String {
        let base = "\(title) - \(format.fileLabel(style: style))"
            .components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|()."))
            .joined(separator: " ")
            .split(separator: " ")
            .joined(separator: " ")
        return "\(base.isEmpty ? "ScholarMark export" : String(base.prefix(80))).\(format.fileExtension)"
    }

    // MARK: Bibliography

    /// Entries sorted alphabetically (all three styles alphabetize the list).
    public static func sortedEntries(_ sources: [ResearchSource], style: CitationStyle) -> [String] {
        sources
            .map { CitationGenerator.bibliographyEntry($0.citation, style: style) }
            .sorted { sortKey($0).localizedCaseInsensitiveCompare(sortKey($1)) == .orderedAscending }
    }

    private static func sortKey(_ entry: String) -> String {
        entry.trimmingCharacters(in: CharacterSet(charactersIn: "\"“”'‘’. ").union(.whitespaces))
    }

    public static func bibliography(_ sources: [ResearchSource], style: CitationStyle, title: String) -> String {
        var lines = [style.bibliographyHeading, ""]
        lines.append(contentsOf: sortedEntries(sources, style: style).flatMap { [$0, ""] })
        return lines.joined(separator: "\n").trimmingCharacters(in: .newlines) + "\n"
    }

    // MARK: Markdown notes

    public static func markdownNotes(_ sources: [ResearchSource], style: CitationStyle, title: String, details: String) -> String {
        var out: [String] = ["# \(title)"]
        if !details.isEmpty { out += ["", details] }
        out += ["", "_\(sources.count) source\(sources.count == 1 ? "" : "s") · \(style.displayName) style · exported from ScholarMark for iOS_"]

        let ordered = sources.sorted {
            $0.citation.displayTitle.localizedCaseInsensitiveCompare($1.citation.displayTitle) == .orderedAscending
        }
        for source in ordered {
            let citation = source.citation
            out += ["", "## \(citation.displayTitle)", "", CitationGenerator.bibliographyEntry(citation, style: style)]
            let missing = CompletenessReview.issues(for: citation, style: style).filter { $0.severity == .required }
            if !missing.isEmpty {
                out += ["", "> ⚠️ Needs attention: " + missing.map(\.message).joined(separator: " ")]
            }
            if !source.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                out += ["", "**Notes**", "", source.notes.trimmingCharacters(in: .whitespacesAndNewlines)]
            }
            if !source.quotes.isEmpty {
                out += ["", "**Quotes**"]
                for quote in source.quotes {
                    let quoted = quote.text.split(separator: "\n", omittingEmptySubsequences: false).map { "> \($0)" }
                    out += [""] + quoted
                    out.append("")
                    var meta = "— \(quote.category.displayName)"
                    if let page = quote.page { meta += ", p. \(page)" }
                    out.append(meta)
                    out.append("")
                    out.append("Cite as: \(CitationGenerator.quoteCitation(citation, quote: quote.text, pageNumber: quote.page, style: style))")
                    if let note = quote.note { out += ["", "Note: \(note)"] }
                }
            }
        }

        out += ["", "## \(style.bibliographyHeading)", ""]
        out += sortedEntries(sources, style: style).flatMap { [$0, ""] }
        return out.joined(separator: "\n").trimmingCharacters(in: .newlines) + "\n"
    }

    // MARK: BibTeX

    public static func bibTeX(_ sources: [ResearchSource]) -> String {
        var usedKeys: [String: Int] = [:]
        let entries = sources.map { source -> String in
            let c = source.citation
            var key = bibKey(c)
            let count = usedKeys[key, default: 0]
            usedKeys[key] = count + 1
            if count > 0 { key += String(UnicodeScalar(UInt8(96 + min(count, 26)))) }

            let entryType: String
            switch c.sourceType {
            case .book: entryType = "book"
            case .journal: entryType = "article"
            case .chapter: entryType = "incollection"
            case .website: entryType = "online"
            case .newspaper: entryType = "article"
            case .thesis: entryType = "phdthesis"
            case .other: entryType = "misc"
            }

            var fields: [(String, String)] = []
            func add(_ name: String, _ value: String?, escape: Bool = true) {
                guard let value, !value.isEmpty else { return }
                let isVerbatim = name == "url" || name == "doi"
                fields.append((name, escape && !isVerbatim ? bibEscape(value) : value))
            }
            add("author", c.authors.map(bibName).joined(separator: " and "), escape: false)
            let fullTitle = c.subtitle.map { "\(c.title): \($0)" } ?? c.title
            add("title", fullTitle)
            switch c.sourceType {
            case .journal, .newspaper: add("journal", c.containerTitle)
            case .chapter: add("booktitle", c.containerTitle)
            case .website, .other: add("howpublished", c.containerTitle)
            case .book, .thesis: break
            }
            add("editor", c.editors.map { $0.map(bibName).joined(separator: " and ") }, escape: false)
            add("edition", c.edition)
            if c.sourceType == .thesis { add("school", c.publisher) } else { add("publisher", c.publisher) }
            add("address", c.publicationPlace)
            add("year", c.publicationDate.map { String($0.prefix(4)) })
            add("date", c.publicationDate)
            add("volume", c.volume)
            add("number", c.issue)
            if let start = c.pageStart {
                add("pages", c.pageEnd.map { "\(start)--\($0)" } ?? start)
            }
            add("doi", c.doi)
            add("url", c.url)
            add("urldate", c.accessDate)
            if !source.notes.isEmpty { add("annote", source.notes) }

            let body = fields
                .map { name, value in "  \(name) = {\(value)}" }
                .joined(separator: ",\n")
            return "@\(entryType){\(key),\n\(body)\n}"
        }
        return entries.joined(separator: "\n\n") + (entries.isEmpty ? "" : "\n")
    }

    /// Escaped BibTeX name. Organizations are braced so BibTeX does not split them.
    private static func bibName(_ person: PersonName) -> String {
        let last = bibEscape(person.lastName)
        if person.firstName.isEmpty { return "{\(last)}" }
        let suffix = person.suffix.map { ", \(bibEscape($0))" } ?? ""
        return "\(last)\(suffix), \(bibEscape(person.firstName))"
    }

    static func bibKey(_ c: CitationData) -> String {
        func ascii(_ text: String) -> String {
            let folded = text.folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            return String(folded.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) && $0.isASCII }.map(Character.init))
        }
        let author = ascii(c.authors.first?.lastName ?? "")
        let year = c.publicationDate.map { String($0.prefix(4)) } ?? ""
        let stopWords: Set<String> = ["a", "an", "the", "on", "of", "in", "and"]
        let word = c.title
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map { ascii(String($0)) }
            .first { !$0.isEmpty && !stopWords.contains($0.lowercased()) } ?? ""
        let key = (author.isEmpty ? "anon" : author) + year + word
        return key.isEmpty ? "source" : key
    }

    private static func bibEscape(_ value: String) -> String {
        var result = ""
        for character in value {
            switch character {
            case "\\": result += "\\textbackslash{}"
            case "{", "}", "&", "%", "$", "#", "_": result += "\\\(character)"
            case "~": result += "\\textasciitilde{}"
            case "^": result += "\\textasciicircum{}"
            case "\n": result += " "
            default: result.append(character)
            }
        }
        return result
    }

    // MARK: RIS

    public static func ris(_ sources: [ResearchSource]) -> String {
        let records = sources.map { source -> String in
            let c = source.citation
            var lines: [String] = []
            func add(_ tag: String, _ value: String?) {
                guard let value, !value.isEmpty else { return }
                lines.append("\(tag)  - \(value.replacingOccurrences(of: "\n", with: " "))")
            }
            let type: String
            switch c.sourceType {
            case .book: type = "BOOK"
            case .journal: type = "JOUR"
            case .chapter: type = "CHAP"
            case .website: type = "ELEC"
            case .newspaper: type = "NEWS"
            case .thesis: type = "THES"
            case .other: type = "GEN"
            }
            add("TY", type)
            for author in c.authors {
                let suffix = author.suffix.map { ", \($0)" } ?? ""
                add("AU", author.firstName.isEmpty ? author.lastName : "\(author.lastName), \(author.firstName)\(suffix)")
            }
            add("TI", c.subtitle.map { "\(c.title): \($0)" } ?? c.title)
            add("T2", c.containerTitle)
            for editor in c.editors ?? [] {
                add("ED", editor.firstName.isEmpty ? editor.lastName : "\(editor.lastName), \(editor.firstName)")
            }
            add("ET", c.edition)
            add("PB", c.publisher)
            add("CY", c.publicationPlace)
            add("PY", c.publicationDate.map { String($0.prefix(4)) })
            add("DA", c.publicationDate.map { $0.replacingOccurrences(of: "-", with: "/") })
            add("VL", c.volume)
            add("IS", c.issue)
            add("SP", c.pageStart)
            add("EP", c.pageEnd)
            add("DO", c.doi)
            add("UR", c.url)
            add("Y2", c.accessDate.map { $0.replacingOccurrences(of: "-", with: "/") })
            add("N1", source.notes.trimmingCharacters(in: .whitespacesAndNewlines))
            for quote in source.quotes {
                add("N1", "\"\(quote.text)\"" + (quote.page.map { " (p. \($0))" } ?? ""))
            }
            lines.append("ER  - ")
            return lines.joined(separator: "\r\n")
        }
        return records.joined(separator: "\r\n\r\n") + (records.isEmpty ? "" : "\r\n")
    }

    // MARK: JSON

    private struct JSONExport: Encodable {
        struct Item: Encodable {
            var id: UUID
            var citation: CitationData
            var notes: String
            var quotes: [SourceQuote]
            var createdAt: Date
            var updatedAt: Date
        }

        var format = "scholarmark-ios-export"
        var version = 1
        var title: String
        var exportedAt: Date
        var sources: [Item]
    }

    /// Whole-library backup (projects, sources, quotes) in the app's own format, readable by
    /// `LibraryRepository` if copied back as `library.json`.
    public static func libraryBackup(_ library: Library) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(library), let text = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return text + "\n"
    }

    /// `citation` objects use the same keys as `CitationData` in the ScholarMark web schema.
    public static func json(_ sources: [ResearchSource], title: String, exportedAt: Date) -> String {
        let payload = JSONExport(
            title: title,
            exportedAt: exportedAt,
            sources: sources.map {
                .init(id: $0.id, citation: $0.citation, notes: $0.notes, quotes: $0.quotes, createdAt: $0.createdAt, updatedAt: $0.updatedAt)
            }
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(payload), let text = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return text + "\n"
    }
}
