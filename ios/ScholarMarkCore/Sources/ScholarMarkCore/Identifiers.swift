import Foundation

/// DOI parsing. DOIs are case-insensitive; we keep the registrant's casing but compare folded.
public enum DOI {
    private static let pattern = try! NSRegularExpression(
        pattern: "10\\.\\d{4,9}/[^\\s\"<>]+",
        options: [.caseInsensitive]
    )

    /// Finds the first DOI in free text, a `doi:` string, or a URL such as
    /// `https://doi.org/10.1000/xyz` or `https://publisher.com/doi/full/10.1000/xyz`.
    public static func extract(from text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let exact = normalize(trimmed) { return exact }

        // In a URL only the path can hold the DOI; this keeps `?query` and `#fragment` out.
        if let url = WebAddress.parse(trimmed),
           let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            return firstMatch(in: components.path)
        }
        return firstMatch(in: trimmed.removingPercentEncoding ?? trimmed)
    }

    private static func firstMatch(in text: String) -> String? {
        let ns = text as NSString
        guard let match = pattern.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else {
            return nil
        }
        return normalize(ns.substring(with: match.range))
    }

    /// Strips resolver prefixes and trailing punctuation picked up from prose. Returns nil when
    /// the value is not a DOI.
    public static func normalize(_ raw: String) -> String? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        for prefix in ["https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:", "doi.org/"] {
            if value.lowercased().hasPrefix(prefix) {
                value = String(value.dropFirst(prefix.count))
                break
            }
        }
        value = value.trimmingCharacters(in: .whitespaces)

        // Trailing sentence punctuation is never part of a copied DOI in practice.
        while let last = value.last, ".,;:'\"".contains(last) {
            value.removeLast()
        }
        // Drop a trailing ")" or "]" only when it is unbalanced, e.g. "(see 10.1000/xyz)".
        // DOIs such as 10.1016/S0140-6736(20)30183-5 keep their parentheses.
        for (open, close) in [("(", ")"), ("[", "]")] {
            while value.hasSuffix(close),
                  value.filter({ String($0) == close }).count > value.filter({ String($0) == open }).count {
                value.removeLast()
            }
        }

        let ns = value as NSString
        guard let match = pattern.firstMatch(in: value, range: NSRange(location: 0, length: ns.length)),
              match.range.location == 0, match.range.length == ns.length else {
            return nil
        }
        return value
    }

    public static func resolverURL(for doi: String) -> URL? {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "?#%")
        guard let encoded = doi.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: "https://doi.org/\(encoded)")
    }

    public static func matches(_ lhs: String?, _ rhs: String?) -> Bool {
        guard let lhs, let rhs, !lhs.isEmpty, !rhs.isEmpty else { return false }
        return lhs.lowercased() == rhs.lowercased()
    }
}

public enum WebAddress {
    /// Parses user input into an http(s) URL. Bare domains like `example.com/page` get `https://`.
    public static func parse(_ raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains(where: { $0.isWhitespace }) else { return nil }

        let candidate: String
        let lower = trimmed.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            candidate = trimmed
        } else if trimmed.contains("://") {
            return nil  // Some other scheme (ftp://, file://).
        } else if DOI.normalize(trimmed) != nil {
            return nil  // "10.1000/xyz" is a DOI, not host "10.1000".
        } else if trimmed.contains("."), !trimmed.contains("@"), !lower.hasPrefix("doi:"),
                  let firstDot = trimmed.firstIndex(of: "."), firstDot != trimmed.startIndex {
            candidate = "https://\(trimmed)"
        } else {
            return nil
        }

        guard let components = URLComponents(string: candidate),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = components.host, host.contains("."), !host.hasPrefix("."), !host.hasSuffix(".") else {
            return nil
        }
        return components.url
    }

    /// Mirrors `normalizeUrl` in `server/webClipRoutes.ts`: drops the `#fragment`.
    public static func normalize(_ url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }
        components.fragment = nil
        return components.string ?? url.absoluteString
    }

    /// App Transport Security blocks plain HTTP, so lookups are attempted over HTTPS.
    public static func secureFetchURL(for url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "http" else { return url }
        components.scheme = "https"
        return components.url ?? url
    }

    public static func matches(_ lhs: String?, _ rhs: String?) -> Bool {
        guard let lhs, let rhs, let left = URL(string: lhs), let right = URL(string: rhs) else { return false }
        func key(_ url: URL) -> String {
            var value = normalize(url).lowercased()
            if value.hasPrefix("http://") { value = "https://" + value.dropFirst("http://".count) }
            if value.hasPrefix("https://www.") { value = "https://" + value.dropFirst("https://www.".count) }
            while value.hasSuffix("/") { value.removeLast() }
            return value
        }
        return key(left) == key(right)
    }
}

/// What the student pasted into the capture box.
public enum CaptureInput: Equatable, Sendable {
    case doi(String, pageURL: URL?)
    case webPage(URL)
    case title(String)
    case empty

    public static func classify(_ raw: String) -> CaptureInput {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .empty }

        let url = WebAddress.parse(trimmed)
        if let doi = DOI.extract(from: trimmed) {
            // Keep a publisher page URL, but not a bare resolver link.
            let host = url?.host?.lowercased() ?? ""
            let pageURL = (host == "doi.org" || host == "dx.doi.org") ? nil : url
            return .doi(doi, pageURL: pageURL)
        }
        if let url { return .webPage(url) }
        return .title(trimmed)
    }

    public var summary: String {
        switch self {
        case .doi(let doi, _): return "DOI \(doi)"
        case .webPage(let url): return "Web page on \(url.host ?? url.absoluteString)"
        case .title: return "Title (enter details manually)"
        case .empty: return ""
        }
    }

    public var canLookUp: Bool {
        switch self {
        case .doi, .webPage: return true
        case .title, .empty: return false
        }
    }

    /// A starting citation when lookup is skipped or fails, so nothing the student typed is lost.
    public func manualDraft(accessDate: String) -> CitationData {
        switch self {
        case .doi(let doi, let pageURL):
            return CitationData(
                sourceType: .journal,
                url: pageURL.map(WebAddress.normalize) ?? DOI.resolverURL(for: doi)?.absoluteString,
                doi: doi
            )
        case .webPage(let url):
            return CitationData(
                sourceType: .website,
                containerTitle: url.host.map(SiteName.fromHost),
                url: WebAddress.normalize(url),
                accessDate: accessDate
            )
        case .title(let title):
            return CitationData(sourceType: .book, title: title)
        case .empty:
            return CitationData(sourceType: .website)
        }
    }
}

enum SiteName {
    /// "www.example.com" -> "example.com"
    static func fromHost(_ host: String) -> String {
        host.lowercased().hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}

/// Port of `parseAuthorName` in `server/webClipRoutes.ts`, used for meta-tag authors and the
/// "quick add authors" field.
public enum AuthorNameParser {
    public static func parse(_ name: String?) -> [PersonName] {
        guard let name, !name.isEmpty else { return [] }

        let withoutBy = JS.replace(name, pattern: "^by\\s+", options: [.caseInsensitive], global: false) { _, _ in "" }
        let normalized = JS.replace(withoutBy, pattern: "\\s+") { _, _ in " " }
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.isEmpty { return [] }

        let pieces = normalized.contains(" and ")
            ? splitCaseInsensitive(normalized, pattern: "\\s+and\\s+")
            : JS.split(normalized, pattern: "\\s*;\\s*")

        return pieces
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .map(parseSingle)
            .filter { !$0.lastName.isEmpty }
    }

    private static func splitCaseInsensitive(_ string: String, pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return [string]
        }
        let ns = string as NSString
        var pieces: [String] = []
        var cursor = 0
        for match in regex.matches(in: string, range: NSRange(location: 0, length: ns.length)) {
            pieces.append(ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))
            cursor = match.range.location + match.range.length
        }
        pieces.append(ns.substring(from: cursor))
        return pieces
    }

    private static func parseSingle(_ author: String) -> PersonName {
        if author.contains(",") {
            let parts = author.split(separator: ",", omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            if let last = parts.first, parts.count > 1 {
                return PersonName(firstName: parts.dropFirst().joined(separator: " "), lastName: last)
            }
        }

        let parts = author.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if parts.count == 1 { return PersonName(firstName: "", lastName: parts[0]) }
        return PersonName(firstName: parts.dropLast().joined(separator: " "), lastName: parts.last ?? "")
    }
}

/// Normalizes the many date formats seen in metadata to the `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`
/// strings the citation generator expects.
public enum PublicationDate {
    private static let leadingNumeric = try! NSRegularExpression(
        pattern: "^(\\d{4})(?:[-/.](\\d{1,2}))?(?:[-/.](\\d{1,2}))?(?![\\d])"
    )
    private static let embeddedISO = try! NSRegularExpression(pattern: "(\\d{4})-(\\d{2})-(\\d{2})")
    private static let isoShape = try! NSRegularExpression(pattern: "^\\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\\d|3[01]))?)?$")

    public static func normalize(_ raw: String?) -> String? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        let ns = trimmed as NSString
        let fullRange = NSRange(location: 0, length: ns.length)

        if let match = leadingNumeric.firstMatch(in: trimmed, range: fullRange) {
            return compose(
                year: ns.substring(with: match.range(at: 1)),
                month: optionalGroup(match, 2, in: ns),
                day: optionalGroup(match, 3, in: ns)
            )
        }
        if let match = embeddedISO.firstMatch(in: trimmed, range: fullRange) {
            return compose(
                year: ns.substring(with: match.range(at: 1)),
                month: ns.substring(with: match.range(at: 2)),
                day: ns.substring(with: match.range(at: 3))
            )
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        let fullFormats = ["MMMM d, yyyy", "MMM d, yyyy", "d MMMM yyyy", "d MMM yyyy", "EEE, d MMM yyyy HH:mm:ss Z"]
        for format in fullFormats {
            formatter.dateFormat = format
            if let date = formatter.date(from: trimmed) { return isoDay(date, timeZone: formatter.timeZone) }
        }
        for format in ["MMMM yyyy", "MMM yyyy"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: trimmed) {
                formatter.dateFormat = "yyyy-MM"
                return formatter.string(from: date)
            }
        }
        return nil
    }

    /// True for the shapes the generator handles cleanly.
    public static func isWellFormed(_ value: String) -> Bool {
        let ns = value as NSString
        return isoShape.firstMatch(in: value, range: NSRange(location: 0, length: ns.length)) != nil
    }

    /// `YYYY-MM-DD` for `date` in `timeZone` (the device's zone by default, for "accessed today").
    public static func isoDay(_ date: Date, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func optionalGroup(_ match: NSTextCheckingResult, _ index: Int, in ns: NSString) -> String? {
        let range = match.range(at: index)
        return range.location == NSNotFound ? nil : ns.substring(with: range)
    }

    private static func compose(year: String, month: String?, day: String?) -> String {
        guard let month, let monthValue = Int(month), (1...12).contains(monthValue) else { return year }
        let paddedMonth = String(format: "%02d", monthValue)
        guard let day, let dayValue = Int(day), (1...31).contains(dayValue) else { return "\(year)-\(paddedMonth)" }
        return "\(year)-\(paddedMonth)-\(String(format: "%02d", dayValue))"
    }
}
