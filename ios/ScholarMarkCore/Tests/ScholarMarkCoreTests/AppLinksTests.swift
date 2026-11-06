import XCTest
@testable import ScholarMarkCore

final class AppLinksTests: XCTestCase {
    func testPrivacyPolicyLinkOpensTheIOSSectionOverHTTPS() {
        let url = AppLinks.privacyPolicy
        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "app.scholarmark.ai")
        XCTAssertEqual(url.path, "/privacy")
        XCTAssertEqual(url.fragment, "ios")
        XCTAssertNil(url.query)
    }
}
