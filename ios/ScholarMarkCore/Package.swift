// swift-tools-version: 5.10
import PackageDescription

// Foundation-only core for the ScholarMark iOS companion. Kept free of SwiftUI/UIKit so
// `swift test` runs on any Mac (no simulator) and the logic stays unit-testable.
let package = Package(
    name: "ScholarMarkCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "ScholarMarkCore", targets: ["ScholarMarkCore"]),
    ],
    targets: [
        .target(name: "ScholarMarkCore"),
        .testTarget(name: "ScholarMarkCoreTests", dependencies: ["ScholarMarkCore"]),
    ]
)
