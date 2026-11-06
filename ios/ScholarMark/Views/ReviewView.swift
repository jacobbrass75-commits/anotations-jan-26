import SwiftUI
import ScholarMarkCore

/// Every source with missing or malformed citation fields, grouped by project.
struct ReviewView: View {
    @Environment(LibraryStore.self) private var store
    @State private var includeRecommended = false

    private struct ReviewGroup: Identifiable {
        let scope: ProjectScope
        let name: String
        let style: CitationStyle
        let items: [(source: ResearchSource, issues: [FieldIssue])]
        var id: ProjectScope { scope }
    }

    private var groups: [ReviewGroup] {
        let scopes = [ProjectScope.inbox] + store.library.sortedProjects.map { ProjectScope.project($0.id) }
        return scopes.compactMap { scope -> ReviewGroup? in
            let style = store.library.style(for: scope)
            let items = store.library.sources(in: scope).compactMap { source -> (source: ResearchSource, issues: [FieldIssue])? in
                let issues = CompletenessReview.issues(for: source.citation, style: style)
                    .filter { includeRecommended || $0.severity == .required }
                return issues.isEmpty ? nil : (source, issues)
            }
            return items.isEmpty ? nil : ReviewGroup(scope: scope, name: store.library.displayName(for: scope), style: style, items: items)
        }
    }

    var body: some View {
        NavigationStack {
            let groups = self.groups
            List {
                Section {
                    Toggle("Include suggestions", isOn: $includeRecommended)
                } footer: {
                    Text("Required fields would leave gaps in the citation. Suggestions make it stronger (DOIs, issue numbers, page ranges).")
                }

                ForEach(groups) { group in
                    Section("\(group.name) · \(group.style.displayName)") {
                        ForEach(group.items, id: \.source.id) { item in
                            NavigationLink(value: LibraryRoute.source(item.source.id)) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.source.citation.displayTitle)
                                        .font(.headline)
                                        .lineLimit(2)
                                    Text(item.issues.map { $0.field.label(for: item.source.citation.sourceType) }.joined(separator: ", "))
                                        .font(.caption)
                                        .foregroundStyle(item.issues.contains(where: { $0.severity == .required }) ? Color.orange : Color.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .overlay {
                if groups.isEmpty {
                    ContentUnavailableView(
                        store.library.sources.isEmpty ? "Nothing to review yet" : "Citations look complete",
                        systemImage: "checkmark.seal",
                        description: Text(store.library.sources.isEmpty
                            ? "Captured sources with missing citation fields will show up here."
                            : "No source is missing a field its citation style needs.")
                    )
                }
            }
            .navigationTitle("Review")
            .navigationDestination(for: LibraryRoute.self) { route in
                switch route {
                case .scope(let scope): ProjectDetailView(scope: scope)
                case .source(let id): SourceDetailView(sourceID: id)
                }
            }
        }
    }
}

// Preview data is DEBUG-only, and #Preview bodies are compiled in Release too.
#if DEBUG
#Preview {
    ReviewView().environment(LibraryStore.preview())
}
#endif
