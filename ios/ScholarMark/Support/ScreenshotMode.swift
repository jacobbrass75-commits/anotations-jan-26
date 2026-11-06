#if DEBUG
import Foundation
import ScholarMarkCore

/// Debug-only App Store screenshot scenes, driven by `ios/Tools/capture-app-store-screenshots.sh`.
///
/// Launching with `-ScholarMarkScreenshot <scene>` swaps in an in-memory library of synthetic
/// sample sources (nothing is read from or written to the device's saved library) and opens the
/// requested screen. None of this is compiled into Release builds, so the App Store binary cannot
/// enter this mode.
enum ScreenshotScene: String, CaseIterable {
    case library, project, source, review, export, capture, settings

    static let launchArgument = "-ScholarMarkScreenshot"

    /// The scene requested on the command line, if any.
    static let current: ScreenshotScene? = {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: launchArgument), index + 1 < arguments.count else { return nil }
        return ScreenshotScene(rawValue: arguments[index + 1])
    }()

    /// Fictional project the navigation scenes open. Matches `LibraryStore.screenshotSample()`.
    static let featuredProjectName = "HIST 210: Memory & the Archive"
    /// Typed into the capture field. 10.5555 is Crossref's test prefix, so it is not a real work.
    static let captureInput = "10.5555/jap.2022.0182"

    @MainActor private static var handled: Set<String> = []

    /// True the first time it is called for `step` while `scene` is the requested scene, so each
    /// navigation step happens once even if its view appears again.
    @MainActor
    static func shouldRun(_ step: String, for scenes: ScreenshotScene...) -> Bool {
        guard let current, scenes.contains(current), !handled.contains(step) else { return false }
        handled.insert(step)
        return true
    }
}

extension LibraryStore {
    /// In-memory store filled with synthetic sources for App Store screenshots. Every author,
    /// title, and journal is invented; URLs use reserved example domains and DOIs use the 10.5555
    /// test prefix. Some fields are left out on purpose so the Review tab has something to show.
    static func screenshotSample() -> LibraryStore {
        let store = LibraryStore(repository: nil)
        store.update { library in
            library.defaultCitationStyle = .chicago

            let english = library.addProject(name: "ENGL 102: Argument Essay", details: "Does a novel's setting shape its argument?", style: .mla)
            library.addSource(
                CitationData(
                    sourceType: .book,
                    authors: [PersonName(firstName: "Elena", lastName: "Voss")],
                    title: "Lanterns on the Water",
                    publisher: "Harbor House",
                    publicationPlace: "Boston",
                    publicationDate: "2015"
                ),
                to: .project(english.id),
                origin: .manual
            )

            let psych = library.addProject(name: "PSYC 101: Lab Report", details: "Sleep timing and recall", style: .apa)
            library.addSource(
                CitationData(
                    sourceType: .journal,
                    authors: [PersonName(firstName: "Samira", lastName: "Patel"), PersonName(firstName: "Jonah", lastName: "Kim")],
                    title: "Sleep Timing and Next-Day Recall in First-Year Students",
                    containerTitle: "Undergraduate Cognition Review",
                    publicationDate: "2024",
                    volume: "7",
                    issue: "1",
                    pageStart: "12",
                    pageEnd: "29",
                    doi: "10.5555/ucr.2024.007"
                ),
                to: .project(psych.id),
                origin: .doi
            )

            let history = library.addProject(name: ScreenshotScene.featuredProjectName, details: "How do community archives shape public memory?", style: .chicago)
            library.addSource(
                CitationData(
                    sourceType: .book,
                    authors: [PersonName(firstName: "Priya", lastName: "Raman")],
                    title: "The Shelf and the Street",
                    subtitle: "Neighborhood Collections in Practice",
                    publisher: "Fernhill University Press",
                    publicationPlace: "Chicago",
                    publicationDate: "2019"
                ),
                to: .project(history.id),
                origin: .manual
            )
            library.addSource(
                CitationData(
                    sourceType: .website,
                    title: "Oral History Collection Guide",
                    containerTitle: "Riverside Public Library",
                    url: "https://example.org/oral-history-guide",
                    accessDate: "2026-10-02"
                ),
                to: .project(history.id),
                origin: .webPage
            )
            // Missing publication date: shows up in Review as a required field.
            library.addSource(
                CitationData(
                    sourceType: .newspaper,
                    authors: [PersonName(firstName: "Tomas", lastName: "Reyes")],
                    title: "Volunteers Digitize a Century of Church Bulletins",
                    containerTitle: "The Lakeshore Ledger",
                    url: "https://example.com/news/church-bulletins"
                ),
                to: .project(history.id),
                origin: .webPage
            )
            // Missing institution: shows up in Review as a required field.
            library.addSource(
                CitationData(
                    sourceType: .thesis,
                    authors: [PersonName(firstName: "Leah", lastName: "Morgan")],
                    title: "Who Holds the Box? Custody and Trust in Small Archives",
                    publicationDate: "2021"
                ),
                to: .project(history.id),
                origin: .manual
            )

            // Added last so it is the most recent and leads the project list.
            let article = library.addSource(
                CitationData(
                    sourceType: .journal,
                    authors: [PersonName(firstName: "Mara", lastName: "Ellison"), PersonName(firstName: "Daniel", lastName: "Okafor")],
                    title: "Keeping the Record: Community Archives after 1970",
                    containerTitle: "Journal of Archival Practice",
                    publicationDate: "2022-03",
                    volume: "18",
                    issue: "2",
                    pageStart: "45",
                    pageEnd: "71",
                    doi: "10.5555/jap.2022.0182"
                ),
                to: .project(history.id),
                origin: .doi
            )
            library.upsertQuote(SourceQuote(
                text: "A community archive is less a storeroom than an argument about who belongs in the record.",
                page: "47",
                category: .keyQuote,
                note: "Opening claim for section 2."
            ), in: article.id)
            library.upsertQuote(SourceQuote(
                text: "Volunteer-run collections grew threefold between 1975 and 1990.",
                page: "58",
                category: .evidence,
                note: "Pair with the library survey."
            ), in: article.id)
            library.upsertQuote(SourceQuote(
                text: "Interviews were transcribed by the donors themselves.",
                page: "62",
                category: .methodology
            ), in: article.id)
            library.updateSource(article.id) {
                $0.notes = "Strongest source on who decides what gets kept. Use for the counterargument in section 3."
            }

            library.addSource(
                CitationData(
                    sourceType: .website,
                    title: "How to Read a Primary Source",
                    containerTitle: "Example University Writing Center",
                    url: "https://example.edu/writing/primary-sources",
                    accessDate: "2026-10-05"
                ),
                to: .inbox,
                origin: .webPage
            )
        }
        return store
    }
}
#endif
