import SwiftUI
import ScholarMarkCore

struct ExportView: View {
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let scope: ProjectScope

    @State private var style: CitationStyle?
    @State private var format: ExportFormat = .bibliography
    @State private var exportFile: URL?
    @State private var fileError: String?

    var body: some View {
        let sources = store.library.sources(in: scope)
        let title = store.library.displayName(for: scope)
        let activeStyle = style ?? store.library.style(for: scope)
        let text = Exporter.export(
            sources,
            format: format,
            style: activeStyle,
            title: title,
            details: store.library.project(scope.projectID)?.details ?? ""
        )
        let incomplete = sources.filter {
            CompletenessReview.requiredIssueCount(for: $0.citation, style: activeStyle) > 0
        }.count

        NavigationStack {
            Form {
                Section {
                    Picker("Format", selection: $format) {
                        ForEach(ExportFormat.allCases) { Text($0.displayName).tag($0) }
                    }
                    if format.usesCitationStyle {
                        Picker("Citation style", selection: Binding(get: { activeStyle }, set: { style = $0 })) {
                            ForEach(CitationStyle.allCases) { Text($0.displayName).tag($0) }
                        }
                    }
                } footer: {
                    if incomplete > 0 {
                        Label("\(incomplete) of \(sources.count) sources are missing required fields. See the Review tab.", systemImage: "exclamationmark.circle")
                            .foregroundStyle(.orange)
                    }
                }

                Section {
                    CopyButton(text: text, label: "Copy to clipboard")
                    if let exportFile {
                        ShareLink(item: exportFile) {
                            Label("Share or save file…", systemImage: "square.and.arrow.up")
                        }
                    } else if let fileError {
                        Label(fileError, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                } footer: {
                    Text("Share to Files, Mail, Notes, or a reference manager. RIS and BibTeX import into Zotero, EndNote, Mendeley, and LaTeX.")
                }

                Section("Preview") {
                    ScrollView(.horizontal) {
                        Text(text)
                            .font(format.usesCitationStyle ? Font.callout : Font.caption.monospaced())
                            .textSelection(.enabled)
                            .fixedSize(horizontal: format != .bibliography && format != .markdownNotes, vertical: false)
                    }
                }
            }
            .navigationTitle("Export \(title)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task(id: "\(format.rawValue)|\(activeStyle.rawValue)|\(text.hashValue)") {
                writeFile(text: text, title: title, style: activeStyle)
            }
        }
    }

    /// Writes the export to a temporary file so it can be shared with a real file name.
    private func writeFile(text: String, title: String, style: CitationStyle) {
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Exports", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(Exporter.fileName(title: title, format: format, style: style))
            try Data(text.utf8).write(to: url, options: .atomic)
            exportFile = url
            fileError = nil
        } catch {
            exportFile = nil
            fileError = "Could not prepare the file: \(error.localizedDescription)"
        }
    }
}

// Preview data is DEBUG-only, and #Preview bodies are compiled in Release too.
#if DEBUG
#Preview {
    let store = LibraryStore.preview()
    return ExportView(scope: .project(store.library.projects[0].id))
        .environment(store)
}
#endif
