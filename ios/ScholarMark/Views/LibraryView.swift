import SwiftUI
import ScholarMarkCore

/// Navigation targets shared by the Library and Review stacks.
enum LibraryRoute: Hashable {
    case scope(ProjectScope)
    case source(UUID)
}

struct LibraryView: View {
    @Environment(LibraryStore.self) private var store
    @State private var path: [LibraryRoute] = []
    @State private var showingNewProject = false
    @State private var showingCapture = false
    @State private var projectPendingDeletion: ResearchProject?

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    NavigationLink(value: LibraryRoute.scope(.inbox)) {
                        ScopeRow(
                            title: "Inbox",
                            subtitle: "Captured sources not yet in a project",
                            systemImage: "tray",
                            count: store.library.sources(in: .inbox).count
                        )
                    }
                }

                Section("Projects") {
                    if store.library.projects.isEmpty {
                        Text("Create a project for each paper or class to keep its sources, notes, and citation style together.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        Button("New project", systemImage: "folder.badge.plus") { showingNewProject = true }
                    }
                    ForEach(store.library.sortedProjects) { project in
                        NavigationLink(value: LibraryRoute.scope(.project(project.id))) {
                            ScopeRow(
                                title: project.name,
                                subtitle: "\(project.citationStyle.displayName)\(project.details.isEmpty ? "" : " · \(project.details)")",
                                systemImage: "folder",
                                count: store.library.sources(in: .project(project.id)).count
                            )
                        }
                        .swipeActions {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                projectPendingDeletion = project
                            }
                        }
                    }
                }
            }
            .navigationTitle("ScholarMark")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Capture source", systemImage: "plus") { showingCapture = true }
                }
                ToolbarItem(placement: .secondaryAction) {
                    Button("New project", systemImage: "folder.badge.plus") { showingNewProject = true }
                }
            }
            .navigationDestination(for: LibraryRoute.self) { route in
                switch route {
                case .scope(let scope): ProjectDetailView(scope: scope)
                case .source(let id): SourceDetailView(sourceID: id)
                }
            }
            .sheet(isPresented: $showingNewProject) {
                ProjectEditorView(project: nil) { project in
                    path.append(.scope(.project(project.id)))
                }
            }
            .sheet(isPresented: $showingCapture) {
                CaptureSourceView(initialScope: .inbox) { source in
                    path.append(.source(source.id))
                }
            }
            .confirmationDialog(
                "Delete \u{201C}\(projectPendingDeletion?.name ?? "")\u{201D}?",
                isPresented: Binding(get: { projectPendingDeletion != nil }, set: { if !$0 { projectPendingDeletion = nil } }),
                titleVisibility: .visible,
                presenting: projectPendingDeletion
            ) { project in
                Button("Delete project, keep sources in Inbox") {
                    store.update { $0.deleteProject(project.id, keepSources: true) }
                }
                Button("Delete project and its sources", role: .destructive) {
                    store.update { $0.deleteProject(project.id, keepSources: false) }
                }
            }
        }
    }
}

private struct ScopeRow: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let count: Int

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Text("\(count)")
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)
                .accessibilityLabel("\(count) sources")
        }
    }
}

#Preview {
    LibraryView().environment(LibraryStore.preview())
}
