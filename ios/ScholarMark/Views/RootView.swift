import SwiftUI
import ScholarMarkCore

struct RootView: View {
    @Environment(LibraryStore.self) private var store

    var body: some View {
        TabView {
            Tab("Library", systemImage: "books.vertical") {
                LibraryView()
            }
            Tab("Review", systemImage: "checklist") {
                ReviewView()
            }
            .badge(store.sourcesNeedingReview)
            Tab("Settings", systemImage: "gearshape") {
                SettingsView()
            }
        }
        .safeAreaInset(edge: .top) {
            if let problem = store.loadProblem {
                StorageProblemBanner(message: problem, canStartFresh: true)
            } else if let problem = store.saveProblem {
                StorageProblemBanner(message: problem, canStartFresh: false)
            }
        }
    }
}

private struct StorageProblemBanner: View {
    @Environment(LibraryStore.self) private var store
    let message: String
    let canStartFresh: Bool
    @State private var confirming = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
            if canStartFresh {
                Text("Changes are not being saved so the existing file is not overwritten.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Set the file aside and start fresh") { confirming = true }
                    .font(.callout.weight(.semibold))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.yellow.opacity(0.2), in: .rect(cornerRadius: 12))
        .padding(.horizontal)
        .confirmationDialog("Start with an empty library?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Set aside and start fresh", role: .destructive) { store.startFreshAfterLoadProblem() }
        } message: {
            Text("The unreadable file is renamed and kept in the app's storage; it is not deleted.")
        }
    }
}

#Preview {
    RootView().environment(LibraryStore.preview())
}
