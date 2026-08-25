// On iOS the caret is not painted with the web content: it's tracked and drawn by
// a separate selection system in the UI process, which learns where content sits
// from viewport updates the web process sends. A compositor transform moves the
// text without producing one of those updates, so the caret is left behind at a
// stale rect until some later event re-syncs the two — visible as a caret that
// lands offset and then snaps into place.
//
// WebKit's own answer to this, for the equivalent position:fixed case, is to hide
// the caret while the content is moving rather than try to keep it correct
// (https://bugs.webkit.org/show_bug.cgi?id=138201). We do the same: blank it for
// the length of a glide and restore it once the node is back in plain layout.
//
// Only one element is ever blanked at a time — the focused one — so the previous
// value is kept in a module-level pair rather than per-node state.
let hiddenOn: HTMLElement | null = null;
let colorBefore = '';

/** Blank the caret on `el`, remembering whatever `caret-color` it had inline. */
export function hideCaret(el: HTMLElement) {
  if (hiddenOn === el) return;
  restoreCaret();
  hiddenOn = el;
  colorBefore = el.style.caretColor;
  el.style.caretColor = 'transparent';
}

/** Give the caret back to whichever element `hideCaret` blanked. No-op if none. */
export function restoreCaret() {
  if (!hiddenOn) return;
  hiddenOn.style.caretColor = colorBefore;
  hiddenOn = null;
  colorBefore = '';
}
