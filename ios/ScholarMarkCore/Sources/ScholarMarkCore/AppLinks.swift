import Foundation

/// Web pages the app opens in the system browser. Opening one is the browser's request, made
/// only when the user taps the link; the app itself never fetches these URLs.
public enum AppLinks {
    /// The iOS section of the privacy policy. App Review Guideline 5.1.1(i) requires a privacy
    /// policy link inside the app. Keep the base in step with
    /// `AppStore/metadata/en-US/privacy_url.txt` (checked by `Tools/app-store-tools.test.mjs`).
    public static let privacyPolicy = URL(string: "https://app.scholarmark.ai/privacy#ios")!
}
