// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-virtual-keyboard",
    platforms: [
        .iOS(.v13),
    ],
    products: [
        .library(
            name: "tauri-plugin-virtual-keyboard",
            type: .static,
            targets: ["tauri-plugin-virtual-keyboard"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-virtual-keyboard",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
