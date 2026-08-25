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
"tauri-plugin-virtual-keyboard": "github:dash-chat/tauri-plugin-virtual-keyboard#<commit>"
```

## How It Works

The plugin never resizes the webview; the keyboard overlays it. Instead it:

1. Maintains a `--keyboard-inset-height` CSS variable on `document.documentElement`, set **once** per keyboard transition from the target height `willShow` reports. Lay your app out against it, e.g. `padding-bottom: var(--keyboard-inset-height, 0px)` on the app shell.

   One shot means the layout reflows exactly once, rather than once per frame — a per-frame reflow is what makes a long list (especially a `column-reverse` one) lag and tremble as the keyboard moves. The smooth motion comes instead from `registerAboveKeyboard`, which FLIPs the nodes you register onto the compositor so they *glide* into place in sync with the native keyboard. **Anything laid out against the variable but not registered jumps to its final position instead of tracking the keyboard.**

   Also injects `--keyboard-safe-bottom` — `max(--keyboard-inset-height, env(safe-area-inset-bottom))`, the bottom space the app must not lay out into: the keyboard/slot inset while occupied, the home-indicator safe area otherwise. The keyboard-aware replacement for `env(safe-area-inset-bottom)` in bottom padding.
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
} from 'tauri-plugin-virtual-keyboard';

// Tracking starts automatically on import; call this only if you need to be
// explicit about when it happens. Idempotent.
trackKeyboardHeight();

keyboard.height.value;         // CSS px, settles at animation endpoints
keyboard.isOpen.value;
keyboard.reservedHeight.value; // largest height seen, persisted; fallback before first open

await hideKeyboard();          // retract via the OS
await showKeyboard();          // summon for the currently focused input (Android)
```

### Layout

Keyboard-driven layout changes are animated by FLIP rather than by reflowing every
frame. The API is imperative (no framework dependency); wrap it in whatever your
framework calls a directive.

```ts
import {
  registerAboveKeyboard,
  registerBelowKeyboard,
} from 'tauri-plugin-virtual-keyboard';

// Glide this node when the keyboard (or a below-keyboard surface) moves.
const unregister = registerAboveKeyboard(node);

// Render a node in the keyboard's place — a media/emoji panel that takes the
// keyboard's slot. Opening over a live keyboard retracts the keyboard first.
// Only the height is managed; pin the node to the viewport bottom yourself.
const surface = registerBelowKeyboard(node);
surface.setOpen(true);
surface.destroy();
```

A below-keyboard node must not be inside a node passed to `registerAboveKeyboard`:
the registered ancestor's transform would drag it along instead of leaving it
pinned, and would break its `position: fixed`. Make them siblings.

## License

MIT OR Apache-2.0
