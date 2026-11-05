import Foundation

/// Small helpers that reproduce the JavaScript string semantics `server/citationGenerator.ts`
/// relies on (truthiness, `split`, `parseInt`, regex replace), so the Swift port produces the
/// same text as the web app.
enum JS {
    /// JS truthiness for optional strings: nil and "" are falsy.
    static func truthy(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    /// `str.split(literal)` — keeps empty pieces like JavaScript does.
    static func split(_ string: String, on separator: Character) -> [String] {
        string.split(separator: separator, omittingEmptySubsequences: false).map(String.init)
    }

    /// `parseInt(str, 10)`: optional leading whitespace and sign, then leading digits.
    /// Returns nil where JavaScript would return NaN.
    static func parseInt(_ string: String) -> Int? {
        var scalars = Substring(string).drop(while: { $0.isWhitespace })
        var sign = 1
        if let first = scalars.first, first == "-" || first == "+" {
            sign = first == "-" ? -1 : 1
            scalars = scalars.dropFirst()
        }
        let digits = scalars.prefix(while: { $0.isASCII && $0.isNumber })
        guard !digits.isEmpty, let value = Int(digits) else { return nil }
        return sign * value
    }

    /// `str.split(/regex/)` — keeps empty leading/trailing pieces.
    static func split(_ string: String, pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [string] }
        let ns = string as NSString
        var pieces: [String] = []
        var cursor = 0
        for match in regex.matches(in: string, range: NSRange(location: 0, length: ns.length)) {
            if match.range.length == 0 { continue }
            pieces.append(ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))
            cursor = match.range.location + match.range.length
        }
        pieces.append(ns.substring(from: cursor))
        return pieces
    }

    /// `str.replace(/regex/g, fn)` where `fn` receives the first capture group.
    static func replace(
        _ string: String,
        pattern: String,
        options: NSRegularExpression.Options = [],
        global: Bool = true,
        transform: (_ match: String, _ group1: String) -> String
    ) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return string }
        let ns = string as NSString
        var matches = regex.matches(in: string, range: NSRange(location: 0, length: ns.length))
        if !global, let first = matches.first { matches = [first] }
        guard !matches.isEmpty else { return string }

        var result = ""
        var cursor = 0
        for match in matches {
            result += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let whole = ns.substring(with: match.range)
            let group = match.numberOfRanges > 1 && match.range(at: 1).location != NSNotFound
                ? ns.substring(with: match.range(at: 1))
                : ""
            result += transform(whole, group)
            cursor = match.range.location + match.range.length
        }
        result += ns.substring(from: cursor)
        return result
    }

    /// `str.trim().replace(/\s+/g, " ")`
    static func collapseWhitespace(_ string: String) -> String {
        replace(string.trimmingCharacters(in: .whitespacesAndNewlines), pattern: "\\s+") { _, _ in " " }
    }
}
