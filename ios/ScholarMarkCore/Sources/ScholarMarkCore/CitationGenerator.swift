import Foundation

/// Swift port of `server/citationGenerator.ts` (Chicago 17th, MLA 9th, APA 7th).
///
/// Output is kept byte-for-byte identical to the web app, including its quirks, so a citation
/// copied on iPhone matches the one ScholarMark produces on the web. `CitationParityTests`
/// checks this against fixtures generated from the TypeScript source
/// (see `ios/Tools/generate-citation-fixtures.mjs`). Change the TypeScript first, then
/// regenerate fixtures and update this file.
public enum CitationGenerator {
    private typealias Authors = [PersonName]

    private static let months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]

    private static let mlaMonthAbbreviations = [
        "Jan.", "Feb.", "Mar.", "Apr.", "May", "June",
        "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec.",
    ]

    // MARK: - Shared helpers

    private static func suffix(_ person: PersonName) -> String {
        JS.truthy(person.suffix).map { " \($0)" } ?? ""
    }

    private static func formatAuthors(_ authors: Authors, isFirst: Bool) -> String {
        if authors.isEmpty { return "" }

        if isFirst {
            if authors.count == 1 {
                let a = authors[0]
                return "\(a.firstName) \(a.lastName)\(suffix(a))"
            }
            if authors.count == 2 {
                return "\(authors[0].firstName) \(authors[0].lastName) and \(authors[1].firstName) \(authors[1].lastName)"
            }
            if authors.count == 3 {
                return "\(authors[0].firstName) \(authors[0].lastName), \(authors[1].firstName) \(authors[1].lastName), and \(authors[2].firstName) \(authors[2].lastName)"
            }
            return "\(authors[0].firstName) \(authors[0].lastName) et al."
        }

        if authors.count == 1 { return authors[0].lastName }
        if authors.count <= 3 { return authors.map(\.lastName).joined(separator: ", ") }
        return "\(authors[0].lastName) et al."
    }

    private static func formatAuthorsForBibliography(_ authors: Authors) -> String {
        if authors.isEmpty { return "" }

        if authors.count == 1 {
            let a = authors[0]
            return "\(a.lastName), \(a.firstName)\(suffix(a))"
        }

        let first = authors[0]
        var result = "\(first.lastName), \(first.firstName)\(suffix(first))"
        for index in 1..<authors.count {
            let a = authors[index]
            if index == authors.count - 1 {
                result += ", and \(a.firstName) \(a.lastName)\(suffix(a))"
            } else {
                result += ", \(a.firstName) \(a.lastName)\(suffix(a))"
            }
        }
        return result
    }

    private static func shortTitle(_ title: String) -> String {
        let words = JS.split(title, on: " ")
        if words.count <= 4 { return title }
        return words.prefix(4).joined(separator: " ")
    }

    private static func month(_ part: String, names: [String]) -> String {
        guard let value = JS.parseInt(part) else { return "" }
        let index = value - 1
        return names.indices.contains(index) ? names[index] : ""
    }

    private static func day(_ parts: [String]) -> Int? {
        guard parts.count > 2, !parts[2].isEmpty, let value = JS.parseInt(parts[2]), value != 0 else {
            return nil
        }
        return value
    }

    private static func formatDate(_ dateString: String?) -> String {
        guard let dateString = JS.truthy(dateString) else { return "" }
        let parts = JS.split(dateString, on: "-")
        if parts.count == 1 { return parts[0] }

        let year = parts[0]
        let monthName = month(parts[1], names: months)
        if let day = day(parts), !monthName.isEmpty { return "\(monthName) \(day), \(year)" }
        if !monthName.isEmpty { return "\(monthName) \(year)" }
        return year
    }

    private static func year(_ dateString: String?) -> String {
        guard let dateString = JS.truthy(dateString) else { return "" }
        return JS.split(dateString, on: "-")[0]
    }

    private static func editorsList(_ citation: CitationData) -> Authors? {
        guard let editors = citation.editors, !editors.isEmpty else { return nil }
        return editors
    }

    private static func isQuotedTitleType(_ type: SourceType) -> Bool {
        type == .journal || type == .chapter || type == .newspaper
    }

    // MARK: - Chicago

    public static func chicagoFootnote(
        _ citation: CitationData,
        pageNumber: String? = nil,
        isSubsequent: Bool = false
    ) -> String {
        let pageRef = JS.truthy(pageNumber).map { ", \($0)" } ?? ""

        if isSubsequent {
            let author = formatAuthors(citation.authors, isFirst: false)
            let short = shortTitle(citation.title)
            if isQuotedTitleType(citation.sourceType) {
                return "\(author), \"\(short)\"\(pageRef)."
            }
            return "\(author), \(short)\(pageRef)."
        }

        let author = formatAuthors(citation.authors, isFirst: true)

        switch citation.sourceType {
        case .book:
            let title = JS.truthy(citation.subtitle).map { "\(citation.title): \($0)" } ?? citation.title
            let edition = JS.truthy(citation.edition).map { ", \($0) ed." } ?? ""
            let place = citation.publicationPlace ?? ""
            let publisher = citation.publisher ?? ""
            let yr = year(citation.publicationDate)
            let pubInfo = !place.isEmpty && !publisher.isEmpty ? "(\(place): \(publisher), \(yr))" : "(\(yr))"
            return "\(author), \(title)\(edition) \(pubInfo)\(pageRef)."

        case .journal:
            let title = "\"\(citation.title)\""
            let journal = citation.containerTitle ?? ""
            let vol = citation.volume ?? ""
            let issue = JS.truthy(citation.issue).map { ", no. \($0)" } ?? ""
            let yr = year(citation.publicationDate)
            // JS: pageRef.replace(",", ":") swaps the leading comma only.
            let journalPageRef = pageRef.isEmpty ? "" : ":" + String(pageRef.dropFirst())
            return "\(author), \(title) \(journal) \(vol)\(issue) (\(yr))\(journalPageRef)."

        case .chapter:
            let chapterTitle = "\"\(citation.title)\""
            let bookTitle = citation.containerTitle ?? ""
            let editors = editorsList(citation).map {
                ", edited by " + $0.map { "\($0.firstName) \($0.lastName)" }.joined(separator: " and ")
            } ?? ""
            let place = citation.publicationPlace ?? ""
            let publisher = citation.publisher ?? ""
            let yr = year(citation.publicationDate)
            let pubInfo = !place.isEmpty && !publisher.isEmpty ? "(\(place): \(publisher), \(yr))" : "(\(yr))"
            return "\(author), \(chapterTitle) in \(bookTitle)\(editors) \(pubInfo)\(pageRef)."

        case .website:
            let title = "\"\(citation.title)\""
            let site = citation.containerTitle ?? ""
            let accessed = JS.truthy(citation.accessDate).map { "accessed \(formatDate($0))" } ?? ""
            let url = citation.url ?? ""
            return "\(title)\(site.isEmpty ? "" : ", \(site)"), \(accessed), \(url)."

        case .newspaper:
            let title = "\"\(citation.title)\""
            let paper = citation.containerTitle ?? ""
            let date = formatDate(citation.publicationDate)
            let url = JS.truthy(citation.url).map { ", \($0)" } ?? ""
            return "\(author), \(title) \(paper), \(date)\(url)."

        case .thesis:
            let title = "\"\(citation.title)\""
            let institution = citation.publisher ?? ""
            let yr = year(citation.publicationDate)
            return "\(author), \(title) (PhD diss., \(institution), \(yr))\(pageRef)."

        case .other:
            let hasContainer = JS.truthy(citation.containerTitle) != nil
            let title = hasContainer ? "\"\(citation.title)\"" : citation.title
            let container = JS.truthy(citation.containerTitle).map { ", \($0)" } ?? ""
            let yr = year(citation.publicationDate)
            return "\(author), \(title)\(container) (\(yr))\(pageRef)."
        }
    }

    /// Chicago footnote with an embedded quote: `Footnote info, page: "quoted text."`
    public static func footnoteWithQuote(_ citation: CitationData, quote: String, pageNumber: String? = nil) -> String {
        let base = chicagoFootnote(citation, pageNumber: pageNumber, isSubsequent: false)
        let withoutPeriod = String(base.dropLast())
        let cleanQuote = JS.collapseWhitespace(quote)
        let displayQuote = cleanQuote.count > 150 ? String(cleanQuote.prefix(147)) + "..." : cleanQuote
        return "\(withoutPeriod): \"\(displayQuote).\""
    }

    /// Chicago short inline form: `(Author, Short Title, page)`.
    public static func chicagoInline(_ citation: CitationData, pageNumber: String? = nil) -> String {
        let author = citation.authors.first?.lastName ?? "Unknown"
        let short = shortTitle(citation.title)
        let page = JS.truthy(pageNumber).map { ", \($0)" } ?? ""
        if isQuotedTitleType(citation.sourceType) {
            return "(\(author), \"\(short)\"\(page))"
        }
        return "(\(author), \(short)\(page))"
    }

    public static func chicagoBibliography(_ citation: CitationData) -> String {
        let author = formatAuthorsForBibliography(citation.authors)

        switch citation.sourceType {
        case .book:
            let title = JS.truthy(citation.subtitle).map { "\(citation.title): \($0)" } ?? citation.title
            let edition = JS.truthy(citation.edition).map { " \($0) ed." } ?? ""
            let place = citation.publicationPlace ?? ""
            let publisher = citation.publisher ?? ""
            let yr = year(citation.publicationDate)
            let pubInfo = !place.isEmpty && !publisher.isEmpty ? "\(place): \(publisher), \(yr)" : yr
            return "\(author). \(title).\(edition) \(pubInfo)."

        case .journal:
            let title = "\"\(citation.title).\""
            let journal = citation.containerTitle ?? ""
            let vol = citation.volume ?? ""
            let issue = JS.truthy(citation.issue).map { ", no. \($0)" } ?? ""
            let yr = year(citation.publicationDate)
            let pages = pageSpan(citation, both: { ": \($0)-\($1)" }, startOnly: { ": \($0)" })
            let doi = JS.truthy(citation.doi).map { " https://doi.org/\($0)." } ?? ""
            return "\(author). \(title) \(journal) \(vol)\(issue) (\(yr))\(pages).\(doi)"

        case .chapter:
            let chapterTitle = "\"\(citation.title).\""
            let bookTitle = citation.containerTitle ?? ""
            let editors = editorsList(citation).map {
                "Edited by " + $0.map { "\($0.firstName) \($0.lastName)" }.joined(separator: " and ") + ". "
            } ?? ""
            let pages: String
            if let start = JS.truthy(citation.pageStart), let end = JS.truthy(citation.pageEnd) {
                pages = "\(start)-\(end). "
            } else {
                pages = ""
            }
            let place = citation.publicationPlace ?? ""
            let publisher = citation.publisher ?? ""
            let yr = year(citation.publicationDate)
            let pubInfo = !place.isEmpty && !publisher.isEmpty ? "\(place): \(publisher), \(yr)" : yr
            return "\(author). \(chapterTitle) In \(bookTitle). \(editors)\(pages)\(pubInfo)."

        case .website:
            let title = "\"\(citation.title).\""
            let site = citation.containerTitle ?? ""
            let accessed = JS.truthy(citation.accessDate).map { "Accessed \(formatDate($0)). " } ?? ""
            let url = citation.url ?? ""
            return "\(site). \(title) \(accessed)\(url)."

        case .newspaper:
            let title = "\"\(citation.title).\""
            let paper = citation.containerTitle ?? ""
            let date = formatDate(citation.publicationDate)
            let url = JS.truthy(citation.url).map { " \($0)" } ?? ""
            return "\(author). \(title) \(paper), \(date).\(url)"

        case .thesis:
            let title = "\"\(citation.title).\""
            let institution = citation.publisher ?? ""
            let yr = year(citation.publicationDate)
            return "\(author). \(title) PhD diss., \(institution), \(yr)."

        case .other:
            let hasContainer = JS.truthy(citation.containerTitle) != nil
            let title = hasContainer ? "\"\(citation.title).\"" : "\(citation.title)."
            let container = JS.truthy(citation.containerTitle).map { " \($0)." } ?? ""
            let yr = year(citation.publicationDate)
            return "\(author). \(title)\(container) \(yr)."
        }
    }

    private static func pageSpan(
        _ citation: CitationData,
        both: (String, String) -> String,
        startOnly: (String) -> String
    ) -> String {
        if let start = JS.truthy(citation.pageStart), let end = JS.truthy(citation.pageEnd) {
            return both(start, end)
        }
        if let start = JS.truthy(citation.pageStart) {
            return startOnly(start)
        }
        return ""
    }

    // MARK: - MLA 9th edition

    private static func formatMLADate(_ dateString: String?) -> String {
        guard let dateString = JS.truthy(dateString) else { return "" }
        let parts = JS.split(dateString, on: "-")
        if parts.count == 1 { return parts[0] }

        let year = parts[0]
        let monthName = month(parts[1], names: mlaMonthAbbreviations)
        if let day = day(parts), !monthName.isEmpty { return "\(day) \(monthName) \(year)" }
        if !monthName.isEmpty { return "\(monthName) \(year)" }
        return year
    }

    private static func formatMLAAuthorsInText(_ authors: Authors) -> String {
        if authors.isEmpty { return "" }
        if authors.count == 1 { return authors[0].lastName }
        if authors.count == 2 { return "\(authors[0].lastName) and \(authors[1].lastName)" }
        return "\(authors[0].lastName) et al."
    }

    private static func formatMLAAuthorsWorksCited(_ authors: Authors) -> String {
        if authors.isEmpty { return "" }
        let first = authors[0]
        if authors.count == 1 {
            return "\(first.lastName), \(first.firstName)\(suffix(first))"
        }
        if authors.count == 2 {
            let second = authors[1]
            return "\(first.lastName), \(first.firstName)\(suffix(first)), and \(second.firstName) \(second.lastName)"
        }
        return "\(first.lastName), \(first.firstName)\(suffix(first)), et al."
    }

    private static func stripURLScheme(_ url: String) -> String {
        JS.replace(url, pattern: "^https?://", global: false) { _, _ in "" }
    }

    private static func isQuotedInTextTitleType(_ type: SourceType) -> Bool {
        type == .journal || type == .chapter || type == .website || type == .newspaper
    }

    /// MLA in-text: `(Author Page)` or `(Author)`; falls back to a short title.
    public static func mlaInText(_ citation: CitationData, pageNumber: String? = nil) -> String {
        let author = formatMLAAuthorsInText(citation.authors)
        let page = JS.truthy(pageNumber).map { " \($0)" } ?? ""
        if !author.isEmpty { return "(\(author)\(page))" }

        let short = shortTitle(citation.title)
        if isQuotedInTextTitleType(citation.sourceType) {
            return "(\"\(short)\"\(page))"
        }
        return "(\(short)\(page))"
    }

    public static func mlaWorksCited(_ citation: CitationData) -> String {
        let author = formatMLAAuthorsWorksCited(citation.authors)
        let lead = author.isEmpty ? "" : "\(author). "

        switch citation.sourceType {
        case .book:
            let title = JS.truthy(citation.subtitle).map { "\(citation.title): \($0)" } ?? citation.title
            let edition = JS.truthy(citation.edition).map { " \($0) ed.," } ?? ""
            let publisher = JS.truthy(citation.publisher).map { " \($0)," } ?? ""
            let yr = year(citation.publicationDate)
            return "\(lead)\(title).\(edition)\(publisher) \(yr)."

        case .journal:
            let articleTitle = "\"\(citation.title).\""
            let journal = citation.containerTitle ?? ""
            let vol = JS.truthy(citation.volume).map { "vol. \($0)" } ?? ""
            let issue = JS.truthy(citation.issue).map { "no. \($0)" } ?? ""
            let yr = year(citation.publicationDate)
            let pages = pageSpan(citation, both: { "pp. \($0)-\($1)" }, startOnly: { "p. \($0)" })
            let parts = [vol, issue, yr, pages].filter { !$0.isEmpty }.joined(separator: ", ")
            let location: String
            if let doi = JS.truthy(citation.doi) {
                location = " doi:\(doi)"
            } else if let url = JS.truthy(citation.url) {
                location = " \(stripURLScheme(url))"
            } else {
                location = ""
            }
            return "\(lead)\(articleTitle) \(journal), \(parts).\(location.isEmpty ? "" : location + ".")"

        case .chapter:
            let chapterTitle = "\"\(citation.title).\""
            let bookTitle = citation.containerTitle ?? ""
            let editors = editorsList(citation).map {
                "edited by " + $0.map { "\($0.firstName) \($0.lastName)" }.joined(separator: " and ") + ", "
            } ?? ""
            let publisher = JS.truthy(citation.publisher).map { "\($0), " } ?? ""
            let yr = year(citation.publicationDate)
            let pages = pageSpan(citation, both: { "pp. \($0)-\($1)" }, startOnly: { "p. \($0)" })
            let parts = [editors + publisher + yr, pages].filter { !$0.isEmpty }.joined(separator: ", ")
            return "\(lead)\(chapterTitle) \(bookTitle), \(parts)."

        case .website:
            let title = "\"\(citation.title).\""
            let site = citation.containerTitle ?? ""
            let publisher: String
            if let value = JS.truthy(citation.publisher), value != citation.containerTitle {
                publisher = "\(value), "
            } else {
                publisher = ""
            }
            let date = formatMLADate(citation.publicationDate)
            let url = JS.truthy(citation.url).map(stripURLScheme) ?? ""
            let datePart = !date.isEmpty
                ? "\(publisher)\(date)"
                : JS.replace(publisher, pattern: ", $", global: false) { _, _ in "" }
            let separator = datePart.isEmpty ? "" : ", "
            if !site.isEmpty {
                return "\(lead)\(title) \(site), \(datePart)\(separator)\(url)."
            }
            return "\(lead)\(title) \(datePart)\(separator)\(url)."

        case .newspaper:
            let title = "\"\(citation.title).\""
            let paper = citation.containerTitle ?? ""
            let date = formatMLADate(citation.publicationDate)
            let pages = pageSpan(citation, both: { ", pp. \($0)-\($1)" }, startOnly: { ", p. \($0)" })
            let url = JS.truthy(citation.url).map { " \(stripURLScheme($0))" } ?? ""
            return "\(lead)\(title) \(paper), \(date)\(pages).\(url.isEmpty ? "" : url + ".")"

        case .thesis:
            let institution = citation.publisher ?? ""
            let yr = year(citation.publicationDate)
            return "\(lead)\(citation.title). \(institution), \(yr)."

        case .other:
            let hasContainer = JS.truthy(citation.containerTitle) != nil
            let title = hasContainer ? "\"\(citation.title).\"" : "\(citation.title)."
            let container = JS.truthy(citation.containerTitle).map { " \($0)," } ?? ""
            let yr = year(citation.publicationDate)
            return "\(lead)\(title)\(container) \(yr)."
        }
    }

    // MARK: - APA 7th edition

    private static func initials(_ firstName: String) -> String {
        if firstName.isEmpty { return "" }
        return JS.split(firstName, pattern: "[\\s-]+")
            .map { String($0.prefix(1)).uppercased() + "." }
            .joined(separator: " ")
    }

    private static func formatAPAAuthorsInText(_ authors: Authors) -> String {
        if authors.isEmpty { return "" }
        if authors.count == 1 { return authors[0].lastName }
        if authors.count == 2 { return "\(authors[0].lastName) & \(authors[1].lastName)" }
        return "\(authors[0].lastName) et al."
    }

    private static func apaName(_ person: PersonName) -> String {
        "\(person.lastName), \(initials(person.firstName))\(suffix(person))"
    }

    private static func formatAPAAuthorsReference(_ authors: Authors) -> String {
        if authors.isEmpty { return "" }
        if authors.count == 1 { return apaName(authors[0]) }

        if authors.count <= 20 {
            let formatted = authors.map(apaName)
            if formatted.count == 2 { return "\(formatted[0]), & \(formatted[1])" }
            return formatted.dropLast().joined(separator: ", ") + ", & " + formatted[formatted.count - 1]
        }

        let first19 = authors.prefix(19).map(apaName).joined(separator: ", ")
        return "\(first19), . . . \(apaName(authors[authors.count - 1]))"
    }

    private static func formatAPADate(_ dateString: String?) -> String {
        guard let dateString = JS.truthy(dateString) else { return "n.d." }
        let parts = JS.split(dateString, on: "-")
        if parts.count == 1 { return parts[0] }

        let year = parts[0]
        let monthName = month(parts[1], names: months)
        if let day = day(parts), !monthName.isEmpty { return "\(year), \(monthName) \(day)" }
        if !monthName.isEmpty { return "\(year), \(monthName)" }
        return year
    }

    /// Matches the web helper: capitalizes the first character and the character after each
    /// ": ". It does not lowercase the rest of the title.
    private static func toSentenceCase(_ title: String) -> String {
        if title.isEmpty { return "" }
        let first = JS.replace(title, pattern: "^(.)", global: false) { match, _ in match.uppercased() }
        return JS.replace(first, pattern: ": (.)") { _, group in ": \(group.uppercased())" }
    }

    private static func apaYear(_ citation: CitationData) -> String {
        let value = year(citation.publicationDate)
        return value.isEmpty ? "n.d." : value
    }

    /// APA in-text: `(Author, Year)` or `(Author, Year, p. X)`.
    public static func apaInText(_ citation: CitationData, pageNumber: String? = nil) -> String {
        let author = formatAPAAuthorsInText(citation.authors)
        let yr = apaYear(citation)
        let page = JS.truthy(pageNumber).map { ", p. \($0)" } ?? ""
        if !author.isEmpty { return "(\(author), \(yr)\(page))" }

        let short = shortTitle(citation.title)
        if isQuotedInTextTitleType(citation.sourceType) {
            return "(\"\(short),\" \(yr)\(page))"
        }
        return "(\(short), \(yr)\(page))"
    }

    public static func apaReference(_ citation: CitationData) -> String {
        let author = formatAPAAuthorsReference(citation.authors)
        let hasAuthor = !author.isEmpty
        let doi = JS.truthy(citation.doi).map { " https://doi.org/\($0)" } ?? ""
        let urlIfNoDOI = JS.truthy(citation.doi) == nil ? (JS.truthy(citation.url).map { " \($0)" } ?? "") : ""

        switch citation.sourceType {
        case .book:
            let yr = apaYear(citation)
            let title = JS.truthy(citation.subtitle).map {
                "\(toSentenceCase(citation.title)): \(toSentenceCase($0))"
            } ?? toSentenceCase(citation.title)
            let edition = JS.truthy(citation.edition).map { " (\($0) ed.)" } ?? ""
            let publisher = JS.truthy(citation.publisher).map { " \($0)." } ?? ""
            if hasAuthor {
                return "\(author) (\(yr)). \(title)\(edition).\(publisher)\(doi)\(urlIfNoDOI)"
            }
            return "\(title)\(edition). (\(yr)).\(publisher)\(doi)\(urlIfNoDOI)"

        case .journal:
            let yr = apaYear(citation)
            let title = toSentenceCase(citation.title)
            let journal = citation.containerTitle ?? ""
            let vol = citation.volume ?? ""
            let issue = JS.truthy(citation.issue).map { "(\($0))" } ?? ""
            let pages = pageSpan(citation, both: { ", \($0)-\($1)" }, startOnly: { ", \($0)" })
            if hasAuthor {
                return "\(author) (\(yr)). \(title). \(journal), \(vol)\(issue)\(pages).\(doi)\(urlIfNoDOI)"
            }
            return "\(title). (\(yr)). \(journal), \(vol)\(issue)\(pages).\(doi)\(urlIfNoDOI)"

        case .chapter:
            let yr = apaYear(citation)
            let title = toSentenceCase(citation.title)
            let bookTitle = JS.truthy(citation.containerTitle).map(toSentenceCase) ?? ""
            let editors = editorsList(citation).map { list in
                "In " + list.map { "\(initials($0.firstName)) \($0.lastName)" }.joined(separator: " & ")
                    + " (\(list.count == 1 ? "Ed." : "Eds.")), "
            } ?? "In "
            let pages = pageSpan(citation, both: { " (pp. \($0)-\($1))" }, startOnly: { " (p. \($0))" })
            let publisher = JS.truthy(citation.publisher).map { ". \($0)." } ?? "."
            if hasAuthor {
                return "\(author) (\(yr)). \(title). \(editors)\(bookTitle)\(pages)\(publisher)\(doi)"
            }
            return "\(title). (\(yr)). \(editors)\(bookTitle)\(pages)\(publisher)\(doi)"

        case .website:
            let date = formatAPADate(citation.publicationDate)
            let title = toSentenceCase(citation.title)
            let site = citation.containerTitle ?? ""
            let url = JS.truthy(citation.url).map { " \($0)" } ?? ""
            if hasAuthor {
                return site.isEmpty
                    ? "\(author) (\(date)). \(title).\(url)"
                    : "\(author) (\(date)). \(title). \(site).\(url)"
            }
            return site.isEmpty ? "\(title). (\(date)).\(url)" : "\(title). (\(date)). \(site).\(url)"

        case .newspaper:
            let date = formatAPADate(citation.publicationDate)
            let title = toSentenceCase(citation.title)
            let paper = citation.containerTitle ?? ""
            let pages = pageSpan(citation, both: { ", \($0)-\($1)" }, startOnly: { ", \($0)" })
            let url = JS.truthy(citation.url).map { " \($0)" } ?? ""
            if hasAuthor {
                return "\(author) (\(date)). \(title). \(paper)\(pages).\(url)"
            }
            return "\(title). (\(date)). \(paper)\(pages).\(url)"

        case .thesis:
            let yr = apaYear(citation)
            let title = toSentenceCase(citation.title)
            let institution = citation.publisher ?? ""
            let url = JS.truthy(citation.url).map { " \($0)" } ?? ""
            if hasAuthor {
                return "\(author) (\(yr)). \(title) [Doctoral dissertation, \(institution)].\(url)"
            }
            return "\(title). (\(yr)). [Doctoral dissertation, \(institution)].\(url)"

        case .other:
            let yr = apaYear(citation)
            let title = toSentenceCase(citation.title)
            let container = JS.truthy(citation.containerTitle).map { " \($0)." } ?? ""
            if hasAuthor {
                return "\(author) (\(yr)). \(title).\(container)\(doi)\(urlIfNoDOI)"
            }
            return "\(title). (\(yr)).\(container)\(doi)\(urlIfNoDOI)"
        }
    }

    // MARK: - Unified interface (matches the exported TS helpers)

    public static func inTextCitation(_ citation: CitationData, style: CitationStyle, pageNumber: String? = nil) -> String {
        switch style {
        case .mla: return mlaInText(citation, pageNumber: pageNumber)
        case .apa: return apaInText(citation, pageNumber: pageNumber)
        case .chicago: return chicagoInline(citation, pageNumber: pageNumber)
        }
    }

    public static func bibliographyEntry(_ citation: CitationData, style: CitationStyle) -> String {
        switch style {
        case .mla: return mlaWorksCited(citation)
        case .apa: return apaReference(citation)
        case .chicago: return chicagoBibliography(citation)
        }
    }

    /// Chicago returns a footnote; MLA/APA return their in-text citation (as on the web).
    public static func footnote(
        _ citation: CitationData,
        style: CitationStyle,
        pageNumber: String? = nil,
        isSubsequent: Bool = false
    ) -> String {
        if style == .chicago {
            return chicagoFootnote(citation, pageNumber: pageNumber, isSubsequent: isSubsequent)
        }
        return inTextCitation(citation, style: style, pageNumber: pageNumber)
    }

    /// Text to paste into a draft for a quote: a Chicago footnote with the quote embedded, or the
    /// quote followed by an MLA/APA parenthetical.
    public static func quoteCitation(_ citation: CitationData, quote: String, pageNumber: String?, style: CitationStyle) -> String {
        switch style {
        case .chicago:
            return footnoteWithQuote(citation, quote: quote, pageNumber: pageNumber)
        case .mla, .apa:
            let cleanQuote = JS.collapseWhitespace(quote)
            return "\"\(cleanQuote)\" \(inTextCitation(citation, style: style, pageNumber: pageNumber))"
        }
    }
}
