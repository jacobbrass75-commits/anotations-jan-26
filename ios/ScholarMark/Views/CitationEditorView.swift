import SwiftUI
import ScholarMarkCore

/// Form for every citation field the generator uses for the selected source type.
/// Embed in a NavigationStack; it supplies Cancel/Save toolbar buttons.
struct CitationEditorView: View {
    @Environment(\.dismiss) private var dismiss

    private let style: CitationStyle
    private let saveTitle: String
    private let duplicateCheck: (CitationData) -> ResearchSource?
    private let onSave: (CitationData) -> Void

    @State private var draft: CitationData
    /// Stable row identity so deleting or typing in a name never confuses the list.
    @State private var authors: [EditablePerson]
    @State private var editors: [EditablePerson]
    @State private var quickAuthors = ""

    init(
        initial: CitationData,
        style: CitationStyle,
        saveTitle: String = "Save",
        duplicateCheck: @escaping (CitationData) -> ResearchSource? = { _ in nil },
        onSave: @escaping (CitationData) -> Void
    ) {
        self.style = style
        self.saveTitle = saveTitle
        self.duplicateCheck = duplicateCheck
        self.onSave = onSave
        _draft = State(initialValue: initial)
        _authors = State(initialValue: initial.authors.map(EditablePerson.init))
        _editors = State(initialValue: (initial.editors ?? []).map(EditablePerson.init))
    }

    /// The citation as currently edited, cleaned the same way it will be saved.
    private var current: CitationData {
        var citation = draft
        citation.authors = authors.map(\.person)
        citation.editors = editors.isEmpty ? nil : editors.map(\.person)
        return citation.cleaned()
    }

    private var fields: [CitationField] { CitationField.fields(for: draft.sourceType) }

    var body: some View {
        let citation = current
        let issues = CompletenessReview.issues(for: citation, style: style)

        Form {
            Section {
                Picker("Type", selection: $draft.sourceType) {
                    ForEach(SourceType.allCases) { type in
                        Label(type.displayName, systemImage: type.systemImage).tag(type)
                    }
                }
            }

            Section {
                ForEach($authors) { $row in
                    PersonFields(person: $row.person, allowsOrganization: true)
                }
                .onDelete { authors.remove(atOffsets: $0) }

                Button("Add author", systemImage: "person.badge.plus") {
                    authors.append(EditablePerson(PersonName()))
                }
                TextField("Quick add: \u{201C}Smith, Jane; Doe, John\u{201D}", text: $quickAuthors)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .onSubmit(addQuickAuthors)
            } header: {
                Text("Authors")
            } footer: {
                IssueList(issues: issues.filter { $0.field == .authors }, sourceType: nil)
            }

            Section {
                ForEach(fields.filter { $0 != .authors && $0 != .editors }) { field in
                    fieldRow(field)
                }
            } header: {
                Text("Details")
            } footer: {
                IssueList(
                    issues: issues.filter { $0.field != .authors && $0.field != .editors },
                    sourceType: draft.sourceType
                )
            }

            if fields.contains(.editors) {
                Section {
                    ForEach($editors) { $row in
                        PersonFields(person: $row.person, allowsOrganization: false)
                    }
                    .onDelete { editors.remove(atOffsets: $0) }
                    Button("Add editor", systemImage: "person.badge.plus") {
                        editors.append(EditablePerson(PersonName()))
                    }
                } header: {
                    Text("Editors")
                } footer: {
                    IssueList(issues: issues.filter { $0.field == .editors }, sourceType: nil)
                }
            }

            if let duplicate = duplicateCheck(citation) {
                Section {
                    Label("You already saved \u{201C}\(duplicate.citation.displayTitle)\u{201D} with this DOI or URL.", systemImage: "doc.on.doc")
                        .font(.callout)
                        .foregroundStyle(.orange)
                }
            }

            Section("Preview (\(style.displayName))") {
                Text(CitationGenerator.bibliographyEntry(citation, style: style))
                    .font(.callout)
                    .textSelection(.enabled)
            }
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(saveTitle) {
                    addQuickAuthors()
                    onSave(current)
                    dismiss()
                }
                .disabled(citation.title.isEmpty)
            }
        }
    }

    @ViewBuilder
    private func fieldRow(_ field: CitationField) -> some View {
        let label = field.label(for: draft.sourceType)
        switch field {
        case .title:
            TextField(label, text: $draft.title, axis: .vertical)
        case .subtitle:
            OptionalTextField(label: label, value: $draft.subtitle)
        case .containerTitle:
            OptionalTextField(label: label, value: $draft.containerTitle)
        case .edition:
            OptionalTextField(label: "\(label) (e.g. 2nd)", value: $draft.edition)
        case .publisher:
            OptionalTextField(label: label, value: $draft.publisher)
        case .publicationPlace:
            OptionalTextField(label: label, value: $draft.publicationPlace)
        case .publicationDate:
            OptionalTextField(label: "\(label) (YYYY-MM-DD)", value: $draft.publicationDate, keyboard: .numbersAndPunctuation)
        case .volume:
            OptionalTextField(label: label, value: $draft.volume, keyboard: .numbersAndPunctuation)
        case .issue:
            OptionalTextField(label: label, value: $draft.issue, keyboard: .numbersAndPunctuation)
        case .pages:
            HStack {
                OptionalTextField(label: "First page", value: $draft.pageStart, keyboard: .numbersAndPunctuation)
                Text("–").foregroundStyle(.secondary)
                OptionalTextField(label: "Last page", value: $draft.pageEnd, keyboard: .numbersAndPunctuation)
            }
        case .doi:
            OptionalTextField(label: "\(label) (10.xxxx/…)", value: $draft.doi, keyboard: .URL)
        case .url:
            OptionalTextField(label: label, value: $draft.url, keyboard: .URL)
        case .accessDate:
            HStack {
                OptionalTextField(label: "\(label) (YYYY-MM-DD)", value: $draft.accessDate, keyboard: .numbersAndPunctuation)
                Button("Today") { draft.accessDate = PublicationDate.isoDay(Date()) }
                    .buttonStyle(.borderless)
            }
        case .authors, .editors:
            EmptyView()
        }
    }

    private func addQuickAuthors() {
        let parsed = AuthorNameParser.parse(quickAuthors)
        guard !parsed.isEmpty else { return }
        authors.removeAll { $0.person.isEmpty }
        authors.append(contentsOf: parsed.map(EditablePerson.init))
        quickAuthors = ""
    }
}

private struct EditablePerson: Identifiable {
    let id = UUID()
    var person: PersonName

    init(_ person: PersonName) {
        self.person = person
    }
}

private struct PersonFields: View {
    @Binding var person: PersonName
    let allowsOrganization: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TextField("First name", text: $person.firstName)
                    .textContentType(.givenName)
                TextField(allowsOrganization ? "Last name / organization" : "Last name", text: $person.lastName)
                    .textContentType(.familyName)
            }
            if allowsOrganization {
                OptionalTextField(label: "Suffix (Jr., III) – optional", value: $person.suffix)
                    .font(.caption)
            }
        }
        .textInputAutocapitalization(.words)
        .autocorrectionDisabled()
    }
}

/// Binds an optional string; empty text is stored as nil.
private struct OptionalTextField: View {
    let label: String
    @Binding var value: String?
    var keyboard: UIKeyboardType = .default

    var body: some View {
        TextField(label, text: Binding(get: { value ?? "" }, set: { value = $0.isEmpty ? nil : $0 }))
            .keyboardType(keyboard)
            .textInputAutocapitalization(keyboard == .default ? .sentences : .never)
            .autocorrectionDisabled(keyboard != .default)
    }
}

/// Footer list of missing/malformed fields. Pass `sourceType` to prefix each with its label.
private struct IssueList: View {
    let issues: [FieldIssue]
    let sourceType: SourceType?

    var body: some View {
        if !issues.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(issues) { issue in
                    Label {
                        Text(sourceType.map { "\(issue.field.label(for: $0)): \(issue.message)" } ?? issue.message)
                    } icon: {
                        Image(systemName: issue.severity == .required ? "exclamationmark.circle.fill" : "lightbulb")
                            .foregroundStyle(issue.severity == .required ? .orange : .yellow)
                    }
                    .font(.caption)
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        CitationEditorView(initial: CitationData(sourceType: .journal, title: "Draft"), style: .apa) { _ in }
    }
}
