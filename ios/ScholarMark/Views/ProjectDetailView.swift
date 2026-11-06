import SwiftUI
import ScholarMarkCore

struct ProjectDetailView: View {
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let scope: ProjectScope

    @State private var searchText = ""
    @State private var showingCapture = false
    @State private var showingExport = false
    @State private var showingProjectEditor = false
    @State private var capturedSourceID: UUID?

    private var project: ResearchProject? { store.library.project(scope.projectID) }

    private var sources: [ResearchSource] {
        let all = store.library.sources(in: scope)
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return all }
        return all.filter { source in
            let c = source.citation
            let haystack = ([c.title, c.containerTitle ?? "", source.notes] + c.authors.map(\.displayName) + source.quotes.map(\.text))
                .joined(separator: " ")
            return haystack.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        if case .project = scope, project == nil {
            ContentUnavailableView("Project deleted", systemImage: "folder.badge.minus")
        } else {
            content
        }
    }

    private var content: some View {
        let style = store.library.style(for: scope)
        return List {
            if let project, !project.details.isEmpty {
                Section {
                    Text(project.details)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                ForEach(sources) { source in
                    NavigationLink(value: LibraryRoute.source(source.id)) {
                        SourceRow(source: source, requiredIssues: store.requiredIssueCount(for: source))
                    }
                    .swipeActions {
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            store.update { $0.deleteSource(source.id) }
                        }
                    }
                    .contextMenu {
                        CopyButton(text: CitationGenerator.bibliographyEntry(source.citation, style: style), label: "Copy \(style.displayName) citation")
                        MoveToMenu(sourceID: source.id, current: scope)
                    }
                }
            } header: {
                if !sources.isEmpty {
                    Text("\(sources.count) source\(sources.count == 1 ? "" : "s") · \(style.displayName)")
                }
            }
        }
        .overlay {
            if store.library.sources(in: scope).isEmpty {
                ContentUnavailableView {
                    Label("No sources yet", systemImage: "text.badge.plus")
                } description: {
                    Text("Paste a URL or DOI to capture a source, or enter its details by hand.")
                } actions: {
                    Button("Capture source") { showingCapture = true }
                        .buttonStyle(.borderedProminent)
                }
            } else if sources.isEmpty {
                ContentUnavailableView.search(text: searchText)
            }
        }
        .searchable(text: $searchText, prompt: "Search titles, authors, notes")
        .navigationTitle(store.library.displayName(for: scope))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Capture source", systemImage: "plus") { showingCapture = true }
            }
            ToolbarItem(placement: .secondaryAction) {
                Button("Export", systemImage: "square.and.arrow.up") { showingExport = true }
                    .disabled(store.library.sources(in: scope).isEmpty)
            }
            if project != nil {
                ToolbarItem(placement: .secondaryAction) {
                    Button("Edit project", systemImage: "pencil") { showingProjectEditor = true }
                }
            }
        }
        .sheet(isPresented: $showingCapture) {
            CaptureSourceView(initialScope: scope) { source in
                capturedSourceID = source.id
            }
        }
        .sheet(isPresented: $showingExport) {
            ExportView(scope: scope)
        }
        .sheet(isPresented: $showingProjectEditor) {
            ProjectEditorView(project: project) { _ in }
        }
        .navigationDestination(item: $capturedSourceID) { id in
            SourceDetailView(sourceID: id)
        }
        #if DEBUG
        .task {
            // App Store screenshot run (see Support/ScreenshotMode.swift). Waits for the push
            // transition to finish so the sheet is not dropped.
            guard ScreenshotScene.shouldRun("export", for: .export) else { return }
            try? await Task.sleep(for: .seconds(1))
            showingExport = true
        }
        #endif
    }
}

struct SourceRow: View {
    let source: ResearchSource
    let requiredIssues: Int

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: source.citation.sourceType.systemImage)
                .foregroundStyle(.secondary)
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(source.citation.displayTitle)
                    .font(.headline)
                    .lineLimit(2)
                let byline = source.citation.bylineSummary
                if !byline.isEmpty {
                    Text(byline)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                HStack(spacing: 8) {
                    if !source.quotes.isEmpty {
                        Label("\(source.quotes.count)", systemImage: "quote.opening")
                            .accessibilityLabel("\(source.quotes.count) quotes")
                    }
                    if !source.notes.isEmpty {
                        Label("Notes", systemImage: "note.text")
                    }
                    if requiredIssues > 0 {
                        Label("\(requiredIssues) missing", systemImage: "exclamationmark.circle")
                            .foregroundStyle(.orange)
                            .accessibilityLabel("\(requiredIssues) required citation fields missing")
                    }
                }
                .font(.caption)
                .labelStyle(.titleAndIcon)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

struct MoveToMenu: View {
    @Environment(LibraryStore.self) private var store
    let sourceID: UUID
    let current: ProjectScope

    var body: some View {
        Menu("Move to", systemImage: "folder") {
            if current != .inbox {
                Button("Inbox", systemImage: "tray") { store.update { $0.moveSource(sourceID, to: .inbox) } }
            }
            ForEach(store.library.sortedProjects.filter { $0.id != current.projectID }) { project in
                Button(project.name, systemImage: "folder") {
                    store.update { $0.moveSource(sourceID, to: .project(project.id)) }
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        ProjectDetailView(scope: .inbox)
    }
    .environment(LibraryStore.preview())
}
