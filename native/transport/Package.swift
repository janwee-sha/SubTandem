// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SubTandemTransport",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "subtandem-transport", targets: ["SubTandemTransport"])
    ],
    targets: [
        .systemLibrary(name: "CCurl", path: "Sources/CCurl"),
        .executableTarget(name: "SubTandemTransport", dependencies: ["CCurl"])
    ]
)
