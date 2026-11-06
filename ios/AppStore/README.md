# App Store Connect listing kit (ScholarMark for iOS 0.1.0)

Everything App Store Connect asks for that can be prepared before Apple Developer signing and
App Store Connect access are ready. **Nothing here has been entered into App Store Connect.**
Every claim was checked against the app's source at the commit that added this folder. Apple's
rules were checked against Apple's own pages on 2026-11-06 (links below).

- `metadata/`: the listing text, one file per field. It uses
  [fastlane deliver](https://docs.fastlane.tools/actions/deliver/)'s folder layout, so a tool can
  upload it later. Until then, paste each file into the matching App Store Connect field.
- [`privacy-and-age-rating.md`](privacy-and-age-rating.md): App Privacy answers, age rating
  questionnaire answers, export compliance, and the privacy policy gap, each with evidence.
- Screenshots: captured from the real app in simulators (see [Screenshots](#screenshots)).

Check the text after any edit (Node 18+, no install):

```bash
node ios/Tools/check-app-store-metadata.mjs
```

```bash
node --test ios/Tools/app-store-tools.test.mjs
```

The `listing` job in `.github/workflows/ios.yml` runs both on every pull request that touches `ios/`.
The `app` job also builds an unsigned Release archive for a generic iOS device and checks its
platform, architecture, bundle ID and version, privacy manifest, app icon, and that screenshot
mode is absent (see [`ios/README.md`](../README.md#verification-status)).

## Field reference

Limits are Apple's. "Now" is the length of the checked-in text, as measured by the checker.

| App Store Connect field | File | Apple's limit | Now |
|---|---|---|---|
| Name | `metadata/en-US/name.txt` | 2–30 characters | 11 |
| Subtitle | `metadata/en-US/subtitle.txt` | 30 characters | 27 |
| Promotional text | `metadata/en-US/promotional_text.txt` | 170 characters; can be changed without a new submission | 154 |
| Description | `metadata/en-US/description.txt` | 4000 characters, plain text (no HTML) | 2269 |
| Keywords | `metadata/en-US/keywords.txt` | 100 bytes, comma-separated, each keyword more than two characters; no other app or company names | 97 bytes |
| What's New | (none) | 4000 characters; not available for an app's first version | n/a |
| Support URL | `metadata/en-US/support_url.txt` | full URL with protocol; must lead to real contact information | `https://app.scholarmark.ai/support` |
| Marketing URL (optional) | `metadata/en-US/marketing_url.txt` | full URL with protocol | `https://scholarmark.ai/` |
| Privacy Policy URL | `metadata/en-US/privacy_url.txt` | required for iOS apps | `https://app.scholarmark.ai/privacy` (see [policy gap](privacy-and-age-rating.md#privacy-policy-url)) |
| Copyright | `metadata/copyright.txt` | year, then owner; App Store Connect adds the © | `2026 ScholarMark` |
| Primary category | `metadata/primary_category.txt` | | Education (matches `LSApplicationCategoryType` `public.app-category.education` in `project.yml`) |
| Secondary category (optional) | `metadata/secondary_category.txt` | | Reference |
| App Review notes | `metadata/review_information/notes.txt` | 4000 bytes | 2075 bytes |
| Sign-in required | (none) | demo account needed only if the app requires login | **No**: the app has no sign-in |
| Screenshots | `build/AppStoreScreenshots/` (generated) | 1–10 per device size; `.jpeg`, `.jpg`, or `.png`; no alpha or transparency | 7 per size |

Sources:
[App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
(name, subtitle, privacy policy URL, bundle ID, SKU, categories, age rating),
[Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
(promotional text, description, keywords, What's New, support and marketing URLs, copyright,
review notes),
[Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications),
[App privacy](https://developer.apple.com/help/app-store-connect/reference/app-privacy/app-privacy-details),
and [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) 2.3.3
(screenshots show the app in use) and 2.3.7 (names, keywords, and no prices in metadata).

### How the copy was checked

- **No claims beyond this build.** The checker fails customer-facing text that mentions sync,
  cloud or iCloud, sign-in, AI, PDFs, a share extension, or prices, unless the sentence says
  the app does not do it. The description states the limits plainly: no web account sync, no sync
  between devices, no PDFs.
- **Features named in the copy, and where they are in the code:**
  - DOI and link lookup: `MetadataLookup.swift`.
  - Projects, Inbox, and per-project styles: `Library.swift`, `LibraryView.swift`.
  - Quote categories: `QuoteCategory` (Key quote, Argument, Evidence, Methodology, Note).
  - Search over title, container, author, notes, and quote text: `ProjectDetailView.swift`.
  - Chicago 17th (bibliography, footnote, shortened note), MLA 9th, and APA 7th:
    `SourceDetailView.swift` and `SettingsView.swift`.
  - Required fields vs. suggestions: `CompletenessReview.swift` and `ReviewView.swift`.
  - Live preview and duplicate warning in the editor: `CitationEditorView.swift`.
  - Export formats: `ExportFormat` (text bibliography, Markdown, BibTeX, RIS, JSON backup).
  - Share sheet: `ShareLink`.
  - On-device storage that is included in device backups: `LibraryRepository.swift`.
  - In-app privacy policy link (Guideline 5.1.1(i)): Settings → Privacy, `AppLinks.swift`. See the
    [submission checklist](privacy-and-age-rating.md#privacy-policy-url): the policy section must be
    approved and deployed first.
- **Keywords** leave out the app name (Apple already indexes it) and other products' names.
  The in-app footer mentions Zotero, EndNote, and Mendeley, but the listing says "your reference
  manager" instead.
- **Review notes** use a real DOI (`10.1038/nature12373`, the same example the app shows) so the
  reviewer can try a lookup, and give an offline path in case the reviewer's network blocks doi.org.

## Screenshots

Apple requires at least one screenshot for **iPhone with Dynamic Island (medium display)**,
1206 × 2622 or 1179 × 2556 (portrait). Because the app runs on iPad (`TARGETED_DEVICE_FAMILY` is
`1,2`), it also requires at least one for the **iPad 13" display**, 2064 × 2752 or 2048 × 2732.
Each device size takes up to 10. Apple scales the highest required resolution down for smaller
devices when the UI is consistent. The capture also produces the optional 6.9" iPhone size
(1320 × 2868) so the largest iPhones get native-resolution images.

`ios/Tools/capture-app-store-screenshots.sh` builds the **Debug** app, launches each scene below in
iPhone 17 Pro, iPhone 17 Pro Max, and iPad Pro 13-inch (M5) simulators, and saves
`build/AppStoreScreenshots/<size>/<NN>-<scene>.png`. It sets a 9:41 status bar with full signal
and battery, and uses light appearance. It finishes by running
`check-app-store-screenshots.mjs --flatten`, which checks every PNG against Apple's accepted
sizes and removes any alpha channel.

| # | Scene | What it shows |
|---|---|---|
| 01 | `library` | Inbox and three projects with their citation styles and source counts |
| 02 | `project` | A Chicago project's sources, with quote counts, notes, and missing-field badges |
| 03 | `source` | A journal article's draft Chicago citations, notes, and three categorized quotes with pages |
| 04 | `review` | Review tab listing two sources with missing required fields |
| 05 | `export` | Export sheet with the project bibliography preview |
| 06 | `capture` | Capture screen with a DOI pasted, ready for "Look up details" |
| 07 | `settings` | "Stored only on this iPhone or iPad", backup export, and the privacy note with its Privacy Policy link |

**Sample data is synthetic.** It comes from `LibraryStore.screenshotSample()` in
`ios/ScholarMark/Support/ScreenshotMode.swift`. Every author, title, and journal is invented. URLs
use the reserved `example.org`, `example.com`, and `example.edu` domains. DOIs use the `10.5555`
test prefix. The mode is enabled only by the `-ScholarMarkScreenshot <scene>` launch argument,
keeps everything in memory, and is wrapped in `#if DEBUG`, so the App Store (Release) build cannot
enter it. The screenshots are unedited renders of the real UI. Text overlays are allowed
(guideline 2.3.3) but none are added.

Run it on a Mac with Xcode 26+ and Node 18+ (about 10 minutes, most of it simulator boot):

```bash
ios/Tools/capture-app-store-screenshots.sh
```

The script never deletes files. The output directory (default `build/AppStoreScreenshots`, or
the first argument) must not exist yet or must be empty; otherwise the script stops before
building. It also refuses a symbolic link or a regular file. To capture again, move or delete
the earlier run yourself, or pass a new directory:

```bash
ios/Tools/capture-app-store-screenshots.sh build/AppStoreScreenshots-2
```

In CI, the `screenshots` job in `.github/workflows/ios.yml` runs the same script only on manual
runs, so ordinary iOS pull requests do not wait for it. Use Actions → iOS → Run workflow, choose
the branch, and tick **Also capture App Store screenshots**, or run:

```bash
gh workflow run ios.yml --ref <branch> -f capture_screenshots=true
```

It uploads the PNGs as the `app-store-screenshots-<run id>-<attempt>` artifact, kept for 14 days.
A manual run also repeats the normal build and test jobs.

Before uploading, look at every image. The scenes open by simulated navigation, so a slow
simulator can catch a screen mid-transition; rerun with `SETTLE_SECONDS=8` (and a new output directory) if one looks off.
To check images from anywhere:

```bash
node ios/Tools/check-app-store-screenshots.mjs --require iphone-6.3,ipad-13 build/AppStoreScreenshots
```

## Still needed from the publisher

These need an Apple account, a legal decision, or production access, so they were not done here:

1. **Apple Developer Program**: team, signing certificate, and an explicit App ID. Change
   `PRODUCT_BUNDLE_IDENTIFIER` (`ai.scholarmark.ios`) if you will register a different one. The
   bundle ID cannot change after the first build is uploaded.
2. **App Store Connect record**: platform iOS, name, primary language English (U.S.), bundle ID,
   and a SKU (letters, numbers, hyphens, periods, and underscores; cannot start with a hyphen,
   period, or underscore). Check that the name "ScholarMark" is available. If it is taken,
   `ScholarMark: Citation Notes` is 27 characters.
3. **Version number**: the build is `0.1.0 (1)` (`MARKETING_VERSION` and
   `CURRENT_PROJECT_VERSION` in `project.yml`). That is what the product page will show. Raise
   it to `1.0` first if you prefer.
4. **Privacy policy**: the policy at the Privacy Policy URL does not mention the iOS app yet.
   [Draft wording to review](privacy-and-age-rating.md#privacy-policy-url) is provided; publishing
   it is your decision.
5. **Confirm the support and privacy URLs load** from a public network. This environment could not
   reach `scholarmark.ai` or `app.scholarmark.ai`. The routes exist in `client/src/App.tsx`, and
   the support page shows `support@scholarmark.ai`.
6. **Copyright owner**: `2026 ScholarMark` matches the website footer. Replace it with the
   legal entity's name if that differs.
7. **Answer and submit**: App Privacy, the age rating questionnaire, Content Rights, and export
   compliance, using `privacy-and-age-rating.md`. Each one is your attestation to Apple.
8. **App Review contact**: name, email, and a phone number in international format (`+1…`).
9. **Pricing and availability**: the app has no in-app purchases. The price tier and countries
   are yours to choose. EU distribution also needs your Digital Services Act trader status on the
   account.
10. **Archive and upload** a Release build with your team's signing: Xcode → Product → Archive →
    Distribute App. CI builds only for the simulator, with ad-hoc signing. Then attach the build to
    the version, upload the screenshots, and submit.
11. **Optional**: Accessibility Nutrition Labels. Declare them only after the on-device VoiceOver
    and Dynamic Type audit that `ios/README.md` lists as not done yet.
