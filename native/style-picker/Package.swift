// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SubTandemStylePicker",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "subtandem-style-picker", targets: ["SubTandemStylePicker"])
    ],
    targets: [
        .executableTarget(
            name: "SubTandemStylePicker",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("CoreText"),
                .linkedFramework("Network"),
                .linkedFramework("Security")
            ]
        ),
        .testTarget(
            name: "SubTandemStylePickerTests",
            dependencies: ["SubTandemStylePicker"]
        )
    ],
    swiftLanguageModes: [.v6]
)
