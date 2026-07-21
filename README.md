# Tauri Plugin: Virtual Keyboard

A Tauri plugin that integrates the mobile soft keyboard with the webview: the webview keeps its full size (the keyboard overlays it), and the plugin reports the keyboard to the page and lets it control the keyboard natively.

This plugin addresses [tauri-apps/tauri#10631](https://github.com/tauri-apps/tauri/issues/10631).

## Platform Support

| Platform | Supported                       |
|----------|---------------------------------|
| Android  | Yes                             |
| iOS      | Yes (`show` command is a no-op) |
| Desktop  | Commands/events are no-ops      |

## Installation

Add the plugin to your `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-virtual-keyboard = { git = "https://github.com/dash-chat/tauri-plugin-virtual-keyboard" }
```

Register it in your Tauri application:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_virtual_keyboard::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Grant the commands in a capability file:

```json
"permissions": ["virtual-keyboard:default"]
```

Add the JS API to your frontend:

```json
"tauri-plugin-virtual-keyboard-api": "github:dash-chat/tauri-plugin-virtual-keyboard#<commit>"
```

## How It Works

The plugin never resizes the webview; the keyboard overlays it. Instead it:

1. Maintains a `--keyboard-height` CSS variable on `document.documentElement`, updated **per frame** during keyboard animations (Android: `WindowInsetsAnimationCompat` progress; iOS: display-link interpolation over the keyboard notification's duration). Lay your app out against it, e.g. `padding-bottom: var(--keyboard-height, 0px)` on the app shell.
2. Emits keyboard events consumed by the JS API: `willShow { height, durationMs }` (before the open animation, with the target height in CSS px), `willHide { durationMs }`, `didShow { height }`, `didHide`, and `change { height }` for non-animated changes.
3. Exposes native `hide`/`show` commands (`WindowInsetsControllerCompat.hide/show(ime())` on Android, `endEditing` on iOS) so the app never has to manipulate the keyboard through DOM focus tricks.

On iOS it additionally disables WKWebView's own keyboard scroll handling, locks the scroll view, and removes the "Done" input-accessory toolbar.

## JS API

The keyboard state is exposed as [signalium](https://github.com/pzuraq/signalium) signals (`signalium` is a peer dependency), so reads are reactive inside `reactive()`/`watcher()` contexts:

```ts
import {
  hideKeyboard,
  showKeyboard,
  trackKeyboardHeight,
  keyboard,
  onKeyboardWillShow,
  onKeyboardWillHide,
} from 'tauri-plugin-virtual-keyboard-api';

trackKeyboardHeight(); // once at startup

keyboard.height.value;         // CSS px, settles at animation endpoints
keyboard.isOpen.value;
keyboard.reservedHeight.value; // largest height seen, persisted; fallback before first open

await hideKeyboard();          // retract via the OS
await showKeyboard();          // summon for the currently focused input (Android)
```

## License

MIT OR Apache-2.0
