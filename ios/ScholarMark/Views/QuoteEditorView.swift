import SwiftUI
import ScholarMarkCore

struct QuoteEditorView: View {
    @Environment(\.dismiss) private var dismiss
    let onSave: (SourceQuote) -> Void

    @State private var quote: SourceQuote
    @FocusState private var textFocused: Bool
    private let isNew: Bool

    init(quote: SourceQuote, onSave: @escaping (SourceQuote) -> Void) {
        self.onSave = onSave
        _quote = State(initialValue: quote)
        isNew = quote.text.isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Exact words from the source", text: $quote.text, axis: .vertical)
                        .lineLimit(4...14)
                        .focused($textFocused)
                } header: {
                    Text("Quote")
                } footer: {
                    Text("Copy the wording exactly so your citation stays accurate.")
                }

                Section {
                    TextField("Page (e.g. 42 or 42–43)", text: Binding(
                        get: { quote.page ?? "" },
                        set: { quote.page = $0.isEmpty ? nil : $0 }
                    ))
                    .keyboardType(.numbersAndPunctuation)
                    Picker("Category", selection: $quote.category) {
                        ForEach(QuoteCategory.allCases) { Text($0.displayName).tag($0) }
                    }
                    TextField("Why it matters for your argument", text: Binding(
                        get: { quote.note ?? "" },
                        set: { quote.note = $0.isEmpty ? nil : $0 }
                    ), axis: .vertical)
                    .lineLimit(2...6)
                }
            }
            .navigationTitle(isNew ? "Add quote" : "Edit quote")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(quote)
                        dismiss()
                    }
                    .disabled(quote.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear { textFocused = isNew }
        }
    }
}

struct ProjectEditorView: View {
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let project: ResearchProject?
    let onSaved: (ResearchProject) -> Void

    @State private var name = ""
    @State private var details = ""
    @State private var style: CitationStyle = .chicago
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name (e.g. HIST 210 Research Paper)", text: $name)
                    TextField("Assignment, thesis, or research question", text: $details, axis: .vertical)
                        .lineLimit(2...6)
                }
                Section {
                    Picker("Citation style", selection: $style) {
                        ForEach(CitationStyle.allCases) { Text($0.displayName).tag($0) }
                    }
                } footer: {
                    Text("Used for citation previews, missing-field review, and exports in this project.")
                }
            }
            .navigationTitle(project == nil ? "New project" : "Edit project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(project == nil ? "Create" : "Save") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear {
                guard !loaded else { return }
                loaded = true
                name = project?.name ?? ""
                details = project?.details ?? ""
                style = project?.citationStyle ?? store.library.defaultCitationStyle
            }
        }
    }

    private func save() {
        if var existing = project {
            existing.name = name
            existing.details = details.trimmingCharacters(in: .whitespacesAndNewlines)
            existing.citationStyle = style
            store.update { $0.updateProject(existing) }
            onSaved(existing)
        } else {
            onSaved(store.addProject(name: name, details: details, style: style))
        }
        dismiss()
    }
}
