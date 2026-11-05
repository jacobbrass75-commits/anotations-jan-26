import SwiftUI
import ScholarMarkCore

struct SourceDetailView: View {
    @Environment(LibraryStore.self) private var store
    let sourceID: UUID

    @State private var style: CitationStyle?
    @State private var editingCitation = false
    @State private var editingQuote: SourceQuote?
    @State private var confirmingDelete = false

    var body: some View {
        if let source = store.library.source(sourceID) {
            detail(source)
        } else {
            ContentUnavailableView("Source deleted", systemImage: "doc.badge.ellipsis")
        }
    }

    private func detail(_ source: ResearchSource) -> some View {
        let projectStyle = store.library.style(for: source)
        let activeStyle = style ?? projectStyle
        let citation = source.citation
        let issues = CompletenessReview.issues(for: citation, style: activeStyle)

        return List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Label(citation.sourceType.displayName, systemImage: citation.sourceType.systemImage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(citation.displayTitle)
                        .font(.title3.weight(.semibold))
                    if !citation.authors.isEmpty {
                        Text(citation.authors.map(\.displayName).joined(separator: ", "))
                            .foregroundStyle(.secondary)
                    }
                    Text(store.library.displayName(for: ProjectScope(projectID: source.projectID)))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .padding(.vertical, 4)
            }

            Section {
                Picker("Style", selection: Binding(get: { activeStyle }, set: { style = $0 })) {
                    ForEach(CitationStyle.allCases) { Text($0.displayName).tag($0) }
                }
                .pickerStyle(.segmented)

                CitationBlock(
                    heading: activeStyle.bibliographyHeading,
                    text: CitationGenerator.bibliographyEntry(citation, style: activeStyle)
                )
                CitationBlock(
                    heading: activeStyle.shortCitationLabel,
                    text: CitationGenerator.footnote(citation, style: activeStyle)
                )
                if activeStyle == .chicago {
                    CitationBlock(
                        heading: "Shortened note (later references)",
                        text: CitationGenerator.chicagoFootnote(citation, isSubsequent: true)
                    )
                }
            } header: {
                Text("Draft citation")
            } footer: {
                if activeStyle != projectStyle {
                    Text("This project uses \(projectStyle.displayName). Exports use the project style.")
                } else {
                    Text("Formatted the same way as ScholarMark on the web. Check against your instructor's guide before submitting.")
                }
            }

            if !issues.isEmpty {
                Section("Needs attention") {
                    ForEach(issues) { issue in
                        Button {
                            editingCitation = true
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(issue.field.label(for: citation.sourceType)).font(.subheadline.weight(.semibold))
                                    Text(issue.message).font(.caption).foregroundStyle(.secondary)
                                }
                            } icon: {
                                Image(systemName: issue.severity == .required ? "exclamationmark.circle.fill" : "lightbulb")
                                    .foregroundStyle(issue.severity == .required ? .orange : .yellow)
                            }
                        }
                        .foregroundStyle(Color.primary)
                        .accessibilityHint("Opens the citation editor")
                    }
                }
            }

            Section("Notes") {
                NotesEditor(sourceID: source.id, savedText: source.notes)
            }

            Section {
                ForEach(source.quotes) { quote in
                    QuoteRow(quote: quote, citation: citation, style: activeStyle)
                        .contentShape(.rect)
                        .onTapGesture { editingQuote = quote }
                        .swipeActions {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                store.update { $0.deleteQuote(quote.id, in: source.id) }
                            }
                        }
                }
                Button("Add quote", systemImage: "plus") {
                    editingQuote = SourceQuote(text: "")
                }
            } header: {
                Text("Quotes")
            } footer: {
                if !source.quotes.isEmpty {
                    Text("Long-press a quote to copy it with its citation.")
                }
            }

            Section {
                Button("Edit citation details", systemImage: "pencil") { editingCitation = true }
                if let link = citation.url.flatMap(URL.init(string:)) {
                    Link(destination: link) {
                        Label("Open source", systemImage: "safari")
                    }
                }
                ShareLink(item: CitationGenerator.bibliographyEntry(citation, style: activeStyle)) {
                    Label("Share citation", systemImage: "square.and.arrow.up")
                }
                MoveToMenu(sourceID: source.id, current: ProjectScope(projectID: source.projectID))
                Button("Delete source", systemImage: "trash", role: .destructive) { confirmingDelete = true }
            }
        }
        .navigationTitle(citation.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editingCitation) {
            NavigationStack {
                CitationEditorView(
                    initial: citation,
                    style: activeStyle,
                    duplicateCheck: { store.library.duplicate(of: $0, excluding: source.id) }
                ) { updated in
                    store.update { $0.updateSource(source.id) { $0.citation = updated } }
                }
                .navigationTitle("Edit citation")
            }
        }
        .sheet(item: $editingQuote) { quote in
            QuoteEditorView(quote: quote) { saved in
                store.update { $0.upsertQuote(saved, in: source.id) }
            }
        }
        .confirmationDialog("Delete this source?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete source and its quotes", role: .destructive) {
                store.update { $0.deleteSource(source.id) }
            }
        }
    }
}

private struct CitationBlock: View {
    let heading: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(heading)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            Text(text)
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            CopyButton(text: text)
                .font(.callout)
                .buttonStyle(.borderless)
        }
        .padding(.vertical, 4)
    }
}

private struct QuoteRow: View {
    let quote: SourceQuote
    let citation: CitationData
    let style: CitationStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\u{201C}\(quote.text)\u{201D}")
                .italic()
            HStack {
                Text(quote.category.displayName)
                if let page = quote.page { Text("p. \(page)") }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if let note = quote.note {
                Text(note).font(.callout)
            }
        }
        .padding(.vertical, 2)
        .contextMenu {
            CopyButton(
                text: CitationGenerator.quoteCitation(citation, quote: quote.text, pageNumber: quote.page, style: style),
                label: "Copy with \(style.displayName) citation"
            )
            CopyButton(text: quote.text, label: "Copy quote only")
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Tap to edit. Long-press to copy with citation.")
    }
}

/// Inline notes field that saves shortly after typing stops and when leaving the screen.
private struct NotesEditor: View {
    @Environment(LibraryStore.self) private var store
    let sourceID: UUID
    let savedText: String

    @State private var draft = ""
    @State private var loaded = false

    var body: some View {
        TextField("Summary, how you will use it, page refs…", text: $draft, axis: .vertical)
            .lineLimit(3...12)
            .onAppear {
                if !loaded {
                    draft = savedText
                    loaded = true
                }
            }
            .task(id: draft) {
                guard loaded, draft != savedText else { return }
                try? await Task.sleep(for: .milliseconds(700))
                guard !Task.isCancelled else { return }
                commit()
            }
            .onDisappear(perform: commit)
    }

    private func commit() {
        guard loaded, draft != savedText else { return }
        let text = draft
        store.update { $0.updateSource(sourceID) { $0.notes = text } }
    }
}

#Preview {
    let store = LibraryStore.preview()
    return NavigationStack {
        SourceDetailView(sourceID: store.library.sources.first!.id)
    }
    .environment(store)
}
