import SwiftUI
import ScholarMarkCore

/// Capture flow: paste a URL, DOI, or title → optional lookup → review fields → save.
struct CaptureSourceView: View {
    @Environment(LibraryStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let initialScope: ProjectScope
    let onSaved: (ResearchSource) -> Void

    @State private var input = ""
    @State private var scope: ProjectScope
    @State private var lookupTask: Task<Void, Never>?
    @State private var isLookingUp = false
    @State private var lookupError: String?
    @State private var reviewDraft: ReviewDraft?
    @FocusState private var inputFocused: Bool

    init(initialScope: ProjectScope, initialInput: String = "", onSaved: @escaping (ResearchSource) -> Void) {
        self.initialScope = initialScope
        self.onSaved = onSaved
        _scope = State(initialValue: initialScope)
        _input = State(initialValue: initialInput)
    }

    private var classified: CaptureInput { CaptureInput.classify(input) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Paste a URL, DOI, or title", text: $input)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.webSearch)
                        .focused($inputFocused)
                        .submitLabel(.go)
                        .onSubmit(primaryAction)
                    PasteButton(payloadType: String.self) { strings in
                        if let first = strings.first {
                            input = first.trimmingCharacters(in: .whitespacesAndNewlines)
                        }
                    }
                    .labelStyle(.titleAndIcon)
                } footer: {
                    if classified != .empty {
                        Label(classified.summary, systemImage: icon(for: classified))
                    } else {
                        Text("Works with article and news links, doi.org links, bare DOIs like 10.1038/nature12373, or a book title.")
                    }
                }

                Section {
                    Picker("Save to", selection: $scope) {
                        Label("Inbox", systemImage: "tray").tag(ProjectScope.inbox)
                        ForEach(store.library.sortedProjects) { project in
                            Label(project.name, systemImage: "folder").tag(ProjectScope.project(project.id))
                        }
                    }
                }

                Section {
                    if classified.canLookUp {
                        Button {
                            startLookup()
                        } label: {
                            HStack {
                                Label("Look up details", systemImage: "magnifyingglass")
                                Spacer()
                                if isLookingUp { ProgressView() }
                            }
                        }
                        .disabled(isLookingUp)
                    }
                    Button("Enter details manually", systemImage: "square.and.pencil") {
                        openReview(classified.manualDraft(accessDate: PublicationDate.isoDay(Date())), origin: .manual)
                    }
                    .disabled(isLookingUp)
                } footer: {
                    if let lookupError {
                        Label(lookupError, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    } else if classified.canLookUp {
                        Text("Lookups contact doi.org or the page you pasted. No ScholarMark account is used, and nothing else leaves your device.")
                    }
                }
            }
            .navigationTitle("Capture source")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        lookupTask?.cancel()
                        dismiss()
                    }
                }
            }
            .navigationDestination(item: $reviewDraft) { draft in
                CitationEditorView(
                    initial: draft.citation,
                    style: store.library.style(for: scope),
                    saveTitle: "Save source",
                    duplicateCheck: { store.library.duplicate(of: $0) }
                ) { citation in
                    let source = store.addSource(citation, to: scope, origin: draft.origin)
                    onSaved(source)
                    dismiss()
                }
                .navigationTitle(draft.origin == .manual ? "New source" : "Check details")
                .navigationBarBackButtonHidden()
            }
            .onAppear { inputFocused = input.isEmpty }
            .onChange(of: input) { lookupError = nil }
            .onDisappear { lookupTask?.cancel() }
        }
    }

    private func icon(for input: CaptureInput) -> String {
        switch input {
        case .doi: return "number"
        case .webPage: return "globe"
        case .title: return "text.book.closed"
        case .empty: return "questionmark"
        }
    }

    private func primaryAction() {
        if classified.canLookUp {
            startLookup()
        } else if classified != .empty {
            openReview(classified.manualDraft(accessDate: PublicationDate.isoDay(Date())), origin: .manual)
        }
    }

    private func startLookup() {
        let target = classified
        guard target.canLookUp, !isLookingUp else { return }
        lookupError = nil
        isLookingUp = true
        inputFocused = false
        let service = store.lookupService

        lookupTask = Task {
            defer { isLookingUp = false }
            do {
                let citation = try await service.lookUp(target)
                guard !Task.isCancelled else { return }
                let origin: CaptureOrigin
                if case .doi = target { origin = .doi } else { origin = .webPage }
                openReview(citation, origin: origin)
            } catch is CancellationError {
                return
            } catch {
                lookupError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func openReview(_ citation: CitationData, origin: CaptureOrigin) {
        reviewDraft = ReviewDraft(citation: citation, origin: origin)
    }
}

/// Wrapper so a looked-up citation can drive `navigationDestination(item:)`.
private struct ReviewDraft: Identifiable, Hashable {
    let id = UUID()
    let citation: CitationData
    let origin: CaptureOrigin
}

#Preview {
    CaptureSourceView(initialScope: .inbox) { _ in }
        .environment(LibraryStore.preview())
}
