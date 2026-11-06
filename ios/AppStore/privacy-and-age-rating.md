# App Privacy, age rating, and export compliance inputs

These are the answers this build supports, with the code each one rests on. You submit them in
App Store Connect as your own attestation, so read the evidence before you do. Re-check this file
whenever the app gains a network call, an SDK, an account, or user-to-user features.

Apple pages used (checked 2026-11-06):
- [App privacy details](https://developer.apple.com/app-store/app-privacy-details/)
- [App privacy reference](https://developer.apple.com/help/app-store-connect/reference/app-privacy/app-privacy-details)
- [Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating)
- [Age ratings values and definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions)

## What the app does with data (evidence)

| Behavior | Where | Fact |
|---|---|---|
| Storage | `ScholarMarkCore/.../LibraryRepository.swift` | One JSON file in Application Support, written atomically with Data Protection (`completeFileProtectionUnlessOpen`). It is part of normal device backups. Nothing is sent to ScholarMark servers. |
| Network | `ScholarMarkCore/.../MetadataLookup.swift` | The only `URLSession` use in the app. It runs only when the user taps **Look up details**. A DOI goes to `https://doi.org/<doi>` with `Accept: application/vnd.citationstyles.csl+json`; doi.org can redirect to the registration agency (for example Crossref or DataCite) that serves the record. A pasted link is fetched from that site, upgraded to HTTPS. If the page names a DOI, that DOI is then looked up at doi.org. The User-Agent is `ScholarMark-iOS/0.1 (citation lookup)`. No account, token, cookie, or device identifier is added. |
| Links | `SourceDetailView.swift` | **Open source** is a SwiftUI `Link`, so the system opens the URL in the default browser. The app has no web view. |
| Sharing | `ExportView.swift`, `SettingsView.swift`, `SourceDetailView.swift` | Citations and export files reach other apps only through the system share sheet (`ShareLink`) or the clipboard, when the user chooses. |
| SDKs | `Package.swift`, `project.yml` | No third-party packages. The app links only Apple frameworks and the local `ScholarMarkCore` package. |
| Accounts, ads, analytics | whole `ios/` tree | None. |
| Required-reason APIs | whole `ios/` tree | No `UserDefaults`/`@AppStorage`, file timestamp, system boot time, disk space, or active keyboard APIs. This matches `PrivacyInfo.xcprivacy`, which declares no tracking, no tracking domains, no collected data, and no accessed API types. |
| Screenshot mode | `Support/ScreenshotMode.swift` | `#if DEBUG` only, launch-argument triggered, in-memory. It is not in the Release build. |

## App Privacy (App Store Connect → App Privacy)

| Question | Answer this build supports |
|---|---|
| Privacy Policy URL | `https://app.scholarmark.ai/privacy`. Add an iOS section first ([below](#privacy-policy-url)). |
| User Privacy Choices URL (optional) | Leave empty. The app has no server-side data to manage. |
| Do you or your third-party partners collect data from this app? | **No, we do not collect data from this app.** The product page will show "Data Not Collected". |
| Tracking | **No.** No data is linked with third-party data for advertising or shared with data brokers. The manifest sets `NSPrivacyTracking` to false. |

Why "No" fits Apple's definition: Apple defines "collect" as "transmitting data off the device in
a way that allows you and/or your third-party partners to access it for a period longer than what
is necessary to service the transmitted request in real time." ScholarMark (the developer) has no
server in this flow and receives nothing. The app integrates no SDK that sends data anywhere.
doi.org, the DOI registration agencies, and the sites a user pastes do receive an ordinary web
request: the DOI or URL, the device's IP address, and the User-Agent above. That happens only
because the user asked to look up that address, the same as opening it in a browser. Those
services are not partners integrated into the app. If your counsel reads "third-party partners"
more broadly, the closest disclosure would be **Browsing History** or **Other Data** (the
DOI/URL), **not linked to identity**, **not used for tracking**, purpose **App Functionality**.
Decide this before you submit; it is not a technical question.

## Privacy Policy URL

App Store Connect requires a privacy policy URL for iOS apps. The current policy
(`client/src/pages/Privacy.tsx`, last updated November 5, 2026) covers the web app, the Chrome
extension, and the MCP connector. It does not mention the iOS app. Its "What ScholarMark
Collects" list also describes account and server-side data that the iOS app never sends, so a
reviewer or user could read it as applying to the app.

Draft wording for your review. **Not published; this changes a legal document**:

> **ScholarMark for iPhone and iPad.** The iOS app works without a ScholarMark account and does
> not send your library to ScholarMark. Projects, sources, notes, and quotes are stored on your
> device and are included in your device backups. When you tap Look up details, the app sends the
> DOI you entered to doi.org (which may pass the request to the DOI's registration agency), or
> requests the web page you pasted from that site, to read its citation details. Those services
> receive the address you asked for and standard request information such as your IP address. The
> app contains no analytics, advertising, or tracking. To remove the app's data, use Settings →
> Delete all projects and sources, or delete the app.

## Age rating (App Store Connect → App Information → Age Ratings)

The questionnaire has three parts: in-app controls and capabilities, then content descriptors
rated None, Infrequent, or Frequent, then age categories and override.

| Questionnaire item | Answer | Why |
|---|---|---|
| Parental Controls | No | None in the app. |
| Age Assurance | No | No age check or Declared Age Range API. |
| Unrestricted Web Access | **No** | Apple: "Users can navigate to any webpage within the app or freely browse the web." The app has no web view. Lookups download a page only to read its metadata, and **Open source** hands the link to the system browser. |
| User-Generated Content | No | Notes and quotes stay on the device and are never distributed to other users. |
| Messaging and Chat | No | None. |
| Advertising | No | None. |
| Social Media (and the under-13 variant) | No | None. |
| Profanity or Crude Humor | None | The app ships no content. Everything shown is the user's own entries or bibliographic records they look up. |
| Horror/Fear Themes | None | Same. |
| Alcohol, Tobacco, or Drug Use or References | None | Same. |
| Medical or Treatment Information | None | Not a health app. |
| Health or Wellness Topics | None | Same. |
| Mature or Suggestive Themes | None | No app-provided content. |
| Sexual Content or Nudity / Graphic Sexual Content and Nudity | None | Same. |
| Cartoon or Fantasy Violence / Realistic Violence / Prolonged Graphic or Sadistic Realistic Violence | None | Same. |
| Guns or Other Weapons | None | Same. |
| Gambling / Simulated Gambling | None | Same. |
| Contests | None | Same. |
| Loot Boxes | None | No purchases at all. |
| Age Categories and Override | Not Applicable | See the notes below. |
| Age Suitability URL (optional) | Leave empty | |

With every item No or None, Apple's table puts the app at **4+**. App Store Connect calculates
the rating; this file only predicts it.

Notes for your decision:
- **Made for Kids:** do not choose it. Apple says that once an app in the Kids category is
  approved, the choice "cannot be changed and all subsequent updates will need to follow the Kids
  category guidelines."
- **Override to a higher rating** is optional. Apple requires it only "If your app has a EULA with
  minimum age requirements that exceed the rating that Apple calculated." The iOS app uses Apple's
  standard EULA, and ScholarMark's Terms (`client/src/pages/Terms.tsx`) state no minimum age. The
  web privacy policy says "ScholarMark is not intended for children under 13". If you want the
  store rating to reflect that audience, override to **13+**. The answers above stay the same
  either way.
- Apple notes that ratings can differ by OS version (iOS 26 and later vs. earlier). Check both
  panels after saving.

## Other declarations

| Item | Answer this build supports | Evidence |
|---|---|---|
| Export compliance (encryption) | Uses only exempt encryption (standard HTTPS through the OS). No documentation upload. | `Config/ScholarMark-Info.plist` sets `ITSAppUsesNonExemptEncryption` to `false`, so App Store Connect should not ask per build. |
| Content Rights ("contains, shows, or accesses third-party content") | **Yes** is the accurate reading: the app accesses DOI records and user-chosen web pages to read citation metadata. Confirm you have the rights you need. | `MetadataLookup.swift`. Apple asks you to confirm rights, which is a legal call. |
| In-App Purchases / external purchase links | None | No StoreKit and no checkout links in `ios/`. |
| Regulated Medical Device declaration | Not required | Apple asks only for Health & Fitness or Medical apps, or apps with frequent medical content. |
| Sign-in required | No | No accounts. |
