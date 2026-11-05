import SwiftUI

@main
struct ScholarMarkApp: App {
    @State private var store = LibraryStore.live()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
        }
    }
}
