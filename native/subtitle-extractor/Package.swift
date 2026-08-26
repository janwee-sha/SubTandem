// swift-tools-version: 6.0
import Foundation
import PackageDescription

let ffmpegPrefix = ProcessInfo.processInfo.environment["SUBTANDEM_FFMPEG_PREFIX"] ?? ""
let ffmpegInclude = "\(ffmpegPrefix)/include"
let ffmpegLibrary = "\(ffmpegPrefix)/lib"

let package = Package(
    name: "SubTandemSubtitleExtractor",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "subtandem-subtitle-extractor", targets: ["SubTandemSubtitleExtractor"])
    ],
    targets: [
        .systemLibrary(name: "CFFmpeg", path: "Sources/CFFmpeg"),
        .executableTarget(
            name: "SubTandemSubtitleExtractor",
            dependencies: ["CFFmpeg"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .unsafeFlags(["-Xcc", "-I\(ffmpegInclude)"])
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-L", ffmpegLibrary,
                    "-lavformat", "-lavcodec", "-lavutil", "-lz",
                    "-framework", "CoreFoundation",
                    "-framework", "CoreMedia",
                    "-framework", "Security",
                    "-framework", "VideoToolbox"
                ])
            ]
        ),
        .testTarget(
            name: "SubTandemSubtitleExtractorTests",
            dependencies: ["SubTandemSubtitleExtractor"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .unsafeFlags(["-Xcc", "-I\(ffmpegInclude)"])
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-L", ffmpegLibrary,
                    "-lavformat", "-lavcodec", "-lavutil", "-lz",
                    "-framework", "CoreFoundation",
                    "-framework", "CoreMedia",
                    "-framework", "Security",
                    "-framework", "VideoToolbox"
                ])
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
