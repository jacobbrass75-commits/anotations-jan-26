import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Abstraction over URLSession so lookups can be tested without the network.
public protocol HTTPDataLoading: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

public struct URLSessionLoader: HTTPDataLoading {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await session.data(for: request)
    }
}

public enum MetadataLookupError: LocalizedError, Equatable {
    case nothingToLookUp
    case doiNotFound(String)
    case pageNotFound
    case httpStatus(Int)
    case notAWebPage
    case unreadableResponse
    case network(String)

    public var errorDescription: String? {
        switch self {
        case .nothingToLookUp:
            return "Enter a URL or DOI to look up."
        case .doiNotFound(let doi):
            return "doi.org has no record for \(doi). Check the DOI or enter the details manually."
        case .pageNotFound:
            return "That page could not be found (404). Check the address or enter the details manually."
        case .httpStatus(let status):
            return "The site answered with an error (HTTP \(status)). You can still enter the details manually."
        case .notAWebPage:
            return "That link is not a web page (it may be a PDF or file). Enter the details manually."
        case .unreadableResponse:
            return "The response could not be read. Enter the details manually."
        case .network(let message):
            return "Lookup failed: \(message)"
        }
    }
}

/// User-initiated metadata lookups. The only data sent is the DOI (to doi.org) or the URL the
/// student pasted (to that site). No ScholarMark account or credentials are involved.
public struct MetadataLookupService: Sendable {
    public static let userAgent = "ScholarMark-iOS/0.1 (citation lookup)"
    static let maxHTMLBytes = 2_000_000

    private let loader: HTTPDataLoading
    private let accessDate: @Sendable () -> String

    public init(
        loader: HTTPDataLoading = URLSessionLoader(),
        accessDate: @escaping @Sendable () -> String = { PublicationDate.isoDay(Date()) }
    ) {
        self.loader = loader
        self.accessDate = accessDate
    }

    public func lookUp(_ input: CaptureInput) async throws -> CitationData {
        switch input {
        case .doi(let doi, let pageURL):
            var citation = try await lookUpDOI(doi)
            if let pageURL, citation.url == nil {
                citation.url = WebAddress.normalize(pageURL)
            }
            return citation
        case .webPage(let url):
            return try await lookUpWebPage(url)
        case .title, .empty:
            throw MetadataLookupError.nothingToLookUp
        }
    }

    public func lookUpDOI(_ doi: String) async throws -> CitationData {
        guard let url = DOI.resolverURL(for: doi) else { throw MetadataLookupError.nothingToLookUp }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("application/vnd.citationstyles.csl+json", forHTTPHeaderField: "Accept")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")

        let (data, response) = try await load(request)
        if let status = (response as? HTTPURLResponse)?.statusCode {
            if status == 404 { throw MetadataLookupError.doiNotFound(doi) }
            guard (200..<300).contains(status) else { throw MetadataLookupError.httpStatus(status) }
        }
        do {
            var citation = try CSLJSONMapper.citation(fromCSLJSON: data, accessDate: accessDate())
            if citation.doi == nil { citation.doi = doi }
            return citation
        } catch {
            throw MetadataLookupError.unreadableResponse
        }
    }

    public func lookUpWebPage(_ url: URL) async throws -> CitationData {
        var request = URLRequest(url: WebAddress.secureFetchURL(for: url), timeoutInterval: 20)
        request.setValue("text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", forHTTPHeaderField: "Accept")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")

        let (data, response) = try await load(request)
        if let http = response as? HTTPURLResponse {
            if http.statusCode == 404 { throw MetadataLookupError.pageNotFound }
            guard (200..<300).contains(http.statusCode) else { throw MetadataLookupError.httpStatus(http.statusCode) }
            if let type = http.value(forHTTPHeaderField: "Content-Type")?.lowercased(),
               !type.contains("html"), !type.contains("xml") {
                throw MetadataLookupError.notAWebPage
            }
        }

        let html = Self.decodeHTML(data.prefix(Self.maxHTMLBytes))
        let today = accessDate()
        var citation = HTMLMetadataParser.citation(fromHTML: html, pageURL: url, accessDate: today)

        // Publisher pages often carry a DOI; doi.org metadata is more complete than meta tags.
        if let doi = citation.doi, let registered = try? await lookUpDOI(doi) {
            var merged = registered
            merged.url = citation.url
            citation = merged
        }
        if citation.title.isEmpty, let host = url.host {
            citation.title = SiteName.fromHost(host)
        }
        return citation
    }

    private func load(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await loader.data(for: request)
        } catch let error as MetadataLookupError {
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw MetadataLookupError.network(error.localizedDescription)
        }
    }

    static func decodeHTML(_ data: Data) -> String {
        if let utf8 = String(data: data, encoding: .utf8) { return utf8 }
        // A truncated multi-byte sequence at the cut point makes UTF-8 decoding fail; back off.
        for trim in 1...3 where data.count > trim {
            if let utf8 = String(data: data.dropLast(trim), encoding: .utf8) { return utf8 }
        }
        // Older sites still serve Windows-1252 / Latin-1.
        if let legacy = String(data: data, encoding: .windowsCP1252) { return legacy }
        return String(decoding: data, as: UTF8.self)
    }
}
