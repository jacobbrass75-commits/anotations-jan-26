import SwiftUI

@main
struct ScholarMarkApp: App {
    @State private var store = ScholarMarkApp.makeStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
        }
    }

    @MainActor
    private static func makeStore() -> LibraryStore {
        #if DEBUG
        // App Store screenshot runs only (see Support/ScreenshotMode.swift): synthetic, in memory.
        if ScreenshotScene.current != nil { return LibraryStore.screenshotSample() }
        #endif
        return LibraryStore.live()
    }
}
