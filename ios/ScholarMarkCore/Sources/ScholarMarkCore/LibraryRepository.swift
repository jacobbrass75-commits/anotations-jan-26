import Foundation

/// Stores the library as one JSON file in Application Support. Writes are atomic, and on iOS the
/// file uses Data Protection (`completeUnlessOpen`). The file is included in the user's normal
/// device backups; nothing is sent to ScholarMark servers.
public struct LibraryRepository: Sendable {
    public enum RepositoryError: LocalizedError, Equatable {
        case unreadable(String)
        case newerSchema(found: Int, supported: Int)

        public var errorDescription: String? {
            switch self {
            case .unreadable(let reason):
                return "Your saved library could not be read (\(reason))."
            case .newerSchema(let found, let supported):
                return "Your library was saved by a newer version of ScholarMark (format \(found); this version reads \(supported)). Update the app to open it."
            }
        }
    }

    public let fileURL: URL

    public init(directory: URL) {
        fileURL = directory.appendingPathComponent("library.json", isDirectory: false)
    }

    public static func defaultDirectory(fileManager: FileManager = .default) throws -> URL {
        let base = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return base.appendingPathComponent("ScholarMark", isDirectory: true)
    }

    /// Returns an empty library when nothing has been saved yet.
    public func load() throws -> Library {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return Library() }

        let data: Data
        do {
            data = try Data(contentsOf: fileURL)
        } catch {
            throw RepositoryError.unreadable(error.localizedDescription)
        }

        struct VersionProbe: Decodable { var schemaVersion: Int? }
        if let probe = try? JSONDecoder().decode(VersionProbe.self, from: data),
           let version = probe.schemaVersion, version > Library.currentSchemaVersion {
            throw RepositoryError.newerSchema(found: version, supported: Library.currentSchemaVersion)
        }

        do {
            return try JSONDecoder().decode(Library.self, from: data)
        } catch {
            throw RepositoryError.unreadable("the file is damaged")
        }
    }

    public func save(_ library: Library) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        var toSave = library
        toSave.schemaVersion = Library.currentSchemaVersion
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(toSave)

        #if os(iOS)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUnlessOpen])
        #else
        try data.write(to: fileURL, options: [.atomic])
        #endif
    }

    /// Moves an unreadable library aside (never deletes it) so the app can start fresh.
    @discardableResult
    public func quarantineDamagedFile(now: Date = Date()) throws -> URL? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let stamp = Int(now.timeIntervalSince1970)
        let destination = fileURL.deletingLastPathComponent()
            .appendingPathComponent("library-unreadable-\(stamp).json", isDirectory: false)
        try FileManager.default.moveItem(at: fileURL, to: destination)
        return destination
    }

    /// Removes the library file (Settings → Delete all data).
    public func deleteAll() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }
}
