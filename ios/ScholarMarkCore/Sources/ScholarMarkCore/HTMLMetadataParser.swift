import Foundation

/// Extracts citation metadata from a web page's `<meta>` tags.
///
/// Priority: Highwire Press `citation_*` tags (what academic publishers expose for Google
/// Scholar), then Dublin Core, then Open Graph and the generic tags the ScholarMark Chrome
/// extension reads (`og:site_name`, `author`, `article:published_time`, `publication_date`,
/// `date`), then `<title>`.
public enum HTMLMetadataParser {
    public struct MetaTags: Sendable {
        /// Lower-cased name/property -> values in document order.
        public var values: [String: [String]] = [:]
        public var documentTitle: String?
        public var canonicalURL: String?

        public func first(_ keys: String...) -> String? {
            for key in keys {
                if let value = values[key]?.first(where: { !$0.isEmpty }) { return value }
            }
            return nil
        }

        public func all(_ key: String) -> [String] {
            values[key]?.filter { !$0.isEmpty } ?? []
        }
    }

    private static let metaTag = try! NSRegularExpression(pattern: "<meta\\b[^>]*>", options: [.caseInsensitive])
    private static let linkTag = try! NSRegularExpression(pattern: "<link\\b[^>]*>", options: [.caseInsensitive])
    private static let attribute = try! NSRegularExpression(
        pattern: "([a-zA-Z_:.-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))"
    )
    private static let titleTag = try! NSRegularExpression(
        pattern: "<title\\b[^>]*>(.*?)</title>",
        options: [.caseInsensitive, .dotMatchesLineSeparators]
    )

    public static func metaTags(in html: String) -> MetaTags {
        var tags = MetaTags()
        let ns = html as NSString
        let range = NSRange(location: 0, length: ns.length)

        for match in metaTag.matches(in: html, range: range) {
            let attributes = parseAttributes(ns.substring(with: match.range))
            guard let key = (attributes["name"] ?? attributes["property"] ?? attributes["itemprop"])?.lowercased(),
                  let content = attributes["content"] else { continue }
            tags.values[key, default: []].append(HTMLText.clean(content))
        }

        for match in linkTag.matches(in: html, range: range) {
            let attributes = parseAttributes(ns.substring(with: match.range))
            if attributes["rel"]?.lowercased() == "canonical", let href = attributes["href"] {
                tags.canonicalURL = HTMLText.decodeEntities(href)
                break
            }
        }

        if let match = titleTag.firstMatch(in: html, range: range) {
            let title = HTMLText.clean(ns.substring(with: match.range(at: 1)))
            tags.documentTitle = title.isEmpty ? nil : title
        }
        return tags
    }

    private static func parseAttributes(_ tag: String) -> [String: String] {
        let ns = tag as NSString
        var result: [String: String] = [:]
        for match in attribute.matches(in: tag, range: NSRange(location: 0, length: ns.length)) {
            let name = ns.substring(with: match.range(at: 1)).lowercased()
            for group in 2...4 where match.range(at: group).location != NSNotFound {
                result[name] = ns.substring(with: match.range(at: group))
                break
            }
        }
        return result
    }

    /// Builds a citation from page metadata. `pageURL` is the address the student captured.
    public static func citation(fromHTML html: String, pageURL: URL, accessDate: String) -> CitationData {
        citation(from: metaTags(in: html), pageURL: pageURL, accessDate: accessDate)
    }

    public static func citation(from tags: MetaTags, pageURL: URL, accessDate: String) -> CitationData {
        let journalTitle = tags.first("citation_journal_title", "prism.publicationname")
        let conferenceTitle = tags.first("citation_conference_title")
        let bookTitle = tags.first("citation_book_title", "citation_inbook_title")
        let institution = tags.first("citation_dissertation_institution", "citation_technical_report_institution")
        let ogType = tags.first("og:type")?.lowercased()

        let sourceType: SourceType
        if institution != nil, tags.first("citation_dissertation_institution") != nil {
            sourceType = .thesis
        } else if journalTitle != nil {
            sourceType = .journal
        } else if bookTitle != nil || conferenceTitle != nil {
            sourceType = .chapter
        } else if ogType == "book" || tags.first("citation_isbn") != nil {
            sourceType = .book
        } else {
            sourceType = .website
        }

        let rawTitle = tags.first("citation_title", "dc.title", "og:title", "twitter:title") ?? tags.documentTitle ?? ""
        let siteName = tags.first("og:site_name", "application-name")
            ?? pageURL.host.map(SiteName.fromHost)

        var authors = tags.all("citation_author").flatMap { AuthorNameParser.parse($0) }
        if authors.isEmpty { authors = tags.all("dc.creator").flatMap { AuthorNameParser.parse($0) } }
        if authors.isEmpty, let author = tags.first("author", "article:author", "parsely-author", "sailthru.author"),
           !author.lowercased().hasPrefix("http") {
            authors = AuthorNameParser.parse(author)
        }

        let rawDate = tags.first(
            "citation_publication_date", "citation_date", "citation_online_date", "citation_cover_date",
            "dc.date", "dc.date.issued", "dcterms.issued", "prism.publicationdate",
            "article:published_time", "publication_date", "date"
        )

        let containerTitle: String?
        switch sourceType {
        case .journal: containerTitle = journalTitle
        case .chapter: containerTitle = bookTitle ?? conferenceTitle
        case .website, .newspaper, .other: containerTitle = siteName
        case .book, .thesis: containerTitle = nil
        }

        let publisher: String?
        switch sourceType {
        case .thesis: publisher = institution
        default: publisher = tags.first("citation_publisher", "dc.publisher")
        }

        var doi = tags.first("citation_doi", "prism.doi", "bepress_citation_doi").flatMap(DOI.extract(from:))
        if doi == nil {
            doi = tags.all("dc.identifier").lazy.compactMap(DOI.extract(from:)).first
        }

        let citation = CitationData(
            sourceType: sourceType,
            authors: authors,
            title: Self.stripSiteSuffix(from: rawTitle, siteName: siteName),
            containerTitle: containerTitle,
            publisher: publisher,
            publicationPlace: nil,
            publicationDate: PublicationDate.normalize(rawDate),
            volume: tags.first("citation_volume", "prism.volume"),
            issue: tags.first("citation_issue", "prism.number"),
            pageStart: tags.first("citation_firstpage", "prism.startingpage"),
            pageEnd: tags.first("citation_lastpage", "prism.endingpage"),
            url: WebAddress.normalize(pageURL),
            accessDate: sourceType == .website ? accessDate : nil,
            doi: doi
        )
        return citation.cleaned()
    }

    /// "Article name | Site" -> "Article name" when the suffix is the site name.
    static func stripSiteSuffix(from title: String, siteName: String?) -> String {
        guard let siteName, !siteName.isEmpty else { return title }
        for separator in [" | ", " - ", " – ", " — ", " :: "] {
            let suffix = separator + siteName
            if title.lowercased().hasSuffix(suffix.lowercased()), title.count > suffix.count {
                return String(title.dropLast(suffix.count))
            }
        }
        return title
    }
}

enum HTMLText {
    private static let tagPattern = try! NSRegularExpression(pattern: "<[^>]+>")

    private static let namedEntities: [String: String] = [
        "&amp;": "&", "&quot;": "\"", "&apos;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">",
        "&nbsp;": " ", "&ndash;": "–", "&mdash;": "—", "&lsquo;": "‘", "&rsquo;": "’",
        "&ldquo;": "“", "&rdquo;": "”", "&hellip;": "…",
    ]

    /// Strips tags (Crossref titles contain JATS `<i>`, `<sub>`), decodes entities, collapses space.
    static func clean(_ raw: String) -> String {
        // Strip twice: meta content often carries entity-encoded markup (`&lt;i&gt;`).
        JS.collapseWhitespace(stripTags(decodeEntities(stripTags(raw))))
    }

    private static func stripTags(_ text: String) -> String {
        let ns = text as NSString
        return tagPattern.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: ns.length), withTemplate: "")
    }

    static func decodeEntities(_ raw: String) -> String {
        guard raw.contains("&") else { return raw }
        let numericDecoded = JS.replace(raw, pattern: "&#(x?[0-9a-fA-F]+);") { match, group in
            let isHex = group.hasPrefix("x") || group.hasPrefix("X")
            let digits = isHex ? String(group.dropFirst()) : group
            guard let value = UInt32(digits, radix: isHex ? 16 : 10), let scalar = Unicode.Scalar(value) else {
                return match
            }
            return String(Character(scalar))
        }
        var result = numericDecoded
        // `&amp;` last so "&amp;lt;" decodes to "&lt;" rather than "<".
        for (entity, replacement) in namedEntities where entity != "&amp;" {
            result = result.replacingOccurrences(of: entity, with: replacement, options: .caseInsensitive)
        }
        return result.replacingOccurrences(of: "&amp;", with: "&", options: .caseInsensitive)
    }
}
