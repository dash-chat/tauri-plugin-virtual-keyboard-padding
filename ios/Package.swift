// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-virtual-keyboard-padding",
    platforms: [
        .iOS(.v13),
    ],
    products: [
        .library(
            name: "tauri-plugin-virtual-keyboard-padding",
            type: .static,
            targets: ["tauri-plugin-virtual-keyboard-padding"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-virtual-keyboard-padding",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
