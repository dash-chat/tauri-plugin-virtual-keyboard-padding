# Tauri Plugin: Virtual Keyboard

A Tauri plugin that automatically adjusts the WebView padding when the virtual keyboard appears on Android, preventing input fields from being obscured.

This plugin addresses [tauri-apps/tauri#10631](https://github.com/tauri-apps/tauri/issues/10631).

## Platform Support

| Platform | Supported |
|----------|-----------|
| Android  | Yes       |
| iOS      | No        |
| Desktop  | No        |

## Installation

Add the plugin to your `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-virtual-keyboard = { git = "https://github.com/dash-chat/tauri-plugin-virtual-keyboard" }
```

## Usage

Register the plugin in your Tauri application:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_virtual_keyboard::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

That's it! The plugin automatically handles keyboard insets - no additional API calls required.

## How It Works

The plugin uses Android's `WindowInsetsCompat` API to detect when the IME (Input Method Editor / virtual keyboard) appears. When the keyboard is shown, it:

1. Applies bottom padding to the root view equal to the keyboard height
2. Scrolls the WebView to the top to ensure proper layout

This ensures that input fields remain visible and accessible when the virtual keyboard is displayed.

## License

MIT OR Apache-2.0
