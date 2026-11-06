import SwiftUI
import ScholarMarkCore

struct SettingsView: View {
    @Environment(LibraryStore.self) private var store
    @State private var confirmingDelete = false
    @State private var backupFile: URL?

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Default citation style", selection: Binding(
                        get: { store.library.defaultCitationStyle },
                        set: { style in store.update { $0.defaultCitationStyle = style } }
                    )) {
                        ForEach(CitationStyle.allCases) { Text($0.displayName).tag($0) }
                    }
                } footer: {
                    Text("Used for the Inbox and as the starting style for new projects.")
                }

                Section {
                    Label("Stored only on this iPhone or iPad", systemImage: "iphone")
                    LabeledContent("Projects", value: "\(store.library.projects.count)")
                    LabeledContent("Sources", value: "\(store.library.sources.count)")
                    LabeledContent("Quotes", value: "\(store.library.sources.reduce(0) { $0 + $1.quotes.count })")
                    if let backupFile {
                        ShareLink(item: backupFile) {
                            Label("Export full library backup (JSON)", systemImage: "externaldrive")
                        }
                    }
                } header: {
                    Text("Your library")
                } footer: {
                    Text("This version does not sync with your ScholarMark web account. Your library is saved on this device (and in your normal device backups). Use Export to move sources into ScholarMark on the web, a reference manager, or your notes.")
                }

                Section {
                    Text("When you tap Look up, the app sends the DOI to doi.org, or fetches the page you pasted, to read its citation details. Lookups never send your library, notes, or quotes. No account, tracking, or analytics.")
                        .font(.callout)
                    // Opens in the system browser only when tapped; the app makes no request for it.
                    Link(destination: AppLinks.privacyPolicy) {
                        Label("Privacy Policy", systemImage: "hand.raised")
                    }
                    .accessibilityHint("Opens the ScholarMark privacy policy in your browser.")
                } header: {
                    Text("Privacy")
                }

                Section {
                    Button("Delete all projects and sources", role: .destructive) { confirmingDelete = true }
                        .disabled(store.library.sources.isEmpty && store.library.projects.isEmpty)
                }

                Section {
                    LabeledContent("Version", value: appVersion)
                    Text("Citation formatting matches ScholarMark on the web (Chicago 17th, MLA 9th, APA 7th). Always check your instructor's requirements.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } header: {
                    Text("About")
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Delete everything?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete all data", role: .destructive) { store.deleteEverything() }
            } message: {
                Text("This removes every project, source, note, and quote from this device. It cannot be undone. Export a backup first if you might need it.")
            }
            .task(id: libraryRevision) {
                backupFile = writeBackup()
            }
        }
    }

    /// Changes whenever anything in the library is added, removed, or edited.
    private var libraryRevision: String {
        let sourceStamp = store.library.sources.map(\.updatedAt).max()?.timeIntervalSince1970 ?? 0
        let projectStamp = store.library.projects.map(\.updatedAt).max()?.timeIntervalSince1970 ?? 0
        return "\(store.library.sources.count)-\(store.library.projects.count)-\(sourceStamp)-\(projectStamp)"
    }

    private func writeBackup() -> URL? {
        guard !store.library.sources.isEmpty || !store.library.projects.isEmpty else { return nil }
        let text = Exporter.libraryBackup(store.library)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Exports", isDirectory: true)
        let url = directory.appendingPathComponent("ScholarMark library backup.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}

#Preview {
    SettingsView().environment(LibraryStore.preview())
}
