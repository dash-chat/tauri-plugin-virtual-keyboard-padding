import { signal, reactiveSignal, type ReadonlySignal } from 'signalium';

import { hideKeyboardCommand } from './commands';

const FALLBACK_HEIGHT = 270;
// -v2: earlier versions persisted willShow target heights, which can overshoot
// the settled IME inset (observed on Gboard); stored v1 values may be poisoned.
const STORAGE_KEY = 'virtual-keyboard:keyboard-height-v2';

export interface KeyboardWillShowEvent {
  /** Target keyboard height in CSS px. */
  height: number;
  durationMs: number;
}

export interface KeyboardWillHideEvent {
  durationMs: number;
}

const height = signal(0);
const open = signal(false);
const settledHeight = signal(0);
let tracking = false;
let band: HTMLElement | null = null;
let bandFloor = 0;

const willShowListeners = new Set<(event: KeyboardWillShowEvent) => void>();
const willHideListeners = new Set<(event: KeyboardWillHideEvent) => void>();
const settledListeners = new Set<(height: number) => void>();

function bandHeight(): number {
  return Math.max(height.value, bandFloor);
}

/** Keep the band painted at least `px` tall even while the keyboard is down —
 * a held slot's region must stay covered after the keyboard retracts from it.
 * Pass 0 to let the band follow the keyboard again. Module-internal (used by
 * the layout slot), not part of the public API. */
export function setBandFloor(px: number) {
  bandFloor = px;
  if (band) band.style.height = `${bandHeight()}px`;
}

function setState(nextHeight: number, nextOpen: boolean) {
  height.value = nextHeight;
  open.value = nextOpen;
  if (band) {
    band.style.height = `${bandHeight()}px`;
    // Re-sample on each show so the band follows theme/route changes for free.
    // Deferred: the hit-test forces layout, and this runs in the willShow hot
    // path where every ms delays the frame that starts the glide. The band is
    // behind the keyboard when sampling lands, so a late color is invisible.
    if (nextHeight > 0) {
      requestAnimationFrame(() => {
        if (band && height.value > 0) band.style.background = detectFillColor();
      });
    }
  }
}

/** Sample the app surface the keyboard's region overlaps, so the band can match
 * it without the app pushing a color. Hit-tests just above the keyboard's top
 * edge and returns the first full-width opaque background in the stack there.
 * Uses `elementsFromPoint` (front-to-back), not an ancestor walk, so it still
 * finds the page surface when it sits *behind* a transparent composer bar rather
 * than being its ancestor — and the full-width test steps past inset, colored
 * message bubbles. */
function detectFillColor(): string {
  if (typeof document === 'undefined') return 'transparent';
  const x = Math.floor(window.innerWidth / 2);
  const y = window.innerHeight - height.value - 2;
  for (const el of document.elementsFromPoint(x, y)) {
    const bg = getComputedStyle(el).backgroundColor;
    const opaque = bg !== '' && bg !== 'transparent' && !bg.endsWith(', 0)');
    const fullWidth =
      el.getBoundingClientRect().width >= window.innerWidth * 0.9;
    if (opaque && fullWidth) return bg;
  }
  return 'transparent';
}

/** Paint the keyboard's region with the app surface (detected from the content
 * behind it) so the keyboard's rounded corners blend into the app instead of
 * revealing the transparent-webview base. Sits behind the app content and is
 * zero-height whenever the keyboard is down, so it never covers a full-bleed
 * surface behind the webview — e.g. a QR scanner's camera feed. */
function ensureKeyboardBand() {
  if (typeof document === 'undefined' || !document.body || band) return;
  band = document.createElement('div');
  band.style.cssText =
    'position:fixed;bottom:0;inset-inline:0;height:0;' +
    'background:transparent;pointer-events:none;';
  document.body.prepend(band);
  band.style.height = `${bandHeight()}px`;
}

/** Adopt a settled keyboard height as the reserved height. Only settled
 * heights (didShow/change) qualify — the willShow target can overshoot where
 * the IME actually settles. The latest settled value wins, not a running
 * maximum: one over-reported settle would otherwise stick forever. */
function adoptHeight(candidate: number) {
  if (candidate <= 0 || candidate === settledHeight.value) return;
  settledHeight.value = candidate;
  localStorage.setItem(STORAGE_KEY, String(candidate));
}

/** Notify layout of a settled height (didShow/change). Synchronous — the
 * layout must re-run its inset in the same task, not on a scheduler tick. */
function notifySettled(height: number) {
  for (const listener of settledListeners) listener(height);
}

let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** Adopt and forward a settled report only if it survives a debounce window.
 * When a reopen lands between the hide and show animations of a keyboard
 * swap, the insets dispatch in the gap still carries the animation hint —
 * acting on it immediately glides the layout to a height the keyboard never
 * takes AND poisons the settled height that willShow targets reconcile
 * against. A will-show/will-hide animation cancels the pending report: the
 * animation's own didShow/didHide supersedes it. */
function queueSettled(height: number) {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    adoptHeight(height);
    notifySettled(height);
  }, 120);
}

function cancelQueuedSettled() {
  clearTimeout(settleTimer);
}

/** Subscribe to settled keyboard heights (didShow/change), which can differ
 * from the willShow target the glide was driven by. Module-internal (used by
 * the layout side), not part of the public API. */
export function onKeyboardHeightSettled(
  listener: (height: number) => void,
): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

const nativeHandlers = new Map<string, (payload: never) => void>();

// Entry point for the native sides' direct evaluations (see each platform
// plugin's `emit`): the Tauri plugin event channel delivers with enough
// latency that a willShow sent through it arrives after the IME animation it
// announces has already finished; the direct call lands within a frame or
// two.
if (typeof window !== 'undefined') {
  (
    window as { __VIRTUAL_KEYBOARD_EVENT__?: (event: string, payload: unknown) => void }
  ).__VIRTUAL_KEYBOARD_EVENT__ = (event, payload) => {
    nativeHandlers.get(event)?.(payload as never);
  };
}

function listen<T>(event: string, handler: (payload: T) => void) {
  // Desktop builds have no native side, so nothing ever calls the hook and
  // the state simply stays closed.
  nativeHandlers.set(event, handler as (payload: never) => void);
}

/** Best guess of where the IME will settle. The willShow target comes from
 * the insets-animation hint, which Gboard sometimes over-reports by ~34 CSS px
 * relative to the settled inset — gliding to it overshoots and visibly
 * resettles once didShow corrects. When the target is close to the last
 * settled height, trust the settled one; a clearly different target (another
 * IME, orientation change) wins. */
function reconcileTarget(target: number): number {
  const settled = settledHeight.value;
  if (settled > 0 && Math.abs(target - settled) < 60) return settled;
  return target;
}

/** Start maintaining the keyboard state from the plugin's native events.
 * Idempotent; call once at startup. */
export function trackKeyboardHeight() {
  if (tracking || typeof window === 'undefined') return;
  tracking = true;
  ensureKeyboardBand();
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  if (stored > 0) settledHeight.value = stored;
  listen<KeyboardWillShowEvent>('willShow', event => {
    cancelQueuedSettled();
    const reconciled = { ...event, height: reconcileTarget(event.height) };
    setState(reconciled.height, true);
    for (const listener of willShowListeners) listener(reconciled);
  });
  listen<KeyboardWillHideEvent>('willHide', event => {
    cancelQueuedSettled();
    setState(0, false);
    for (const listener of willHideListeners) listener(event);
  });
  listen<{ height: number }>('didShow', event => {
    setState(event.height, true);
    queueSettled(event.height);
  });
  listen('didHide', () => setState(0, false));
  listen<{ height: number }>('change', event => {
    setState(event.height, event.height > 0);
    queueSettled(event.height);
  });
}

/** Whether `el` is a text-entry element — one whose focus summons the
 * keyboard. */
export function isEditable(el: unknown): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  );
}

let lastEditable: HTMLElement | null = null;

/** The editable that most recently held focus — it may hold it still, or have
 * just been blurred out from under the app: Android's native long-press
 * processing blurs the focused input a few ms before the `contextmenu` event
 * reaches the page, so a slot hold taken from a long-press reads
 * `document.activeElement` too late. Module-internal (used by the layout
 * slot), not part of the public API. */
export function lastFocusedEditable(): HTMLElement | null {
  return lastEditable;
}

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', event => {
    if (isEditable(event.target)) lastEditable = event.target;
  });
}

/** Keep taps inside `node` from moving focus off an editable, so the chrome
 * around an input — buttons, panels, a scroll-to-bottom control — can be
 * tapped without dismissing the keyboard. `mousedown`, not `pointerdown`:
 * preventing `pointerdown`'s default suppresses the synthesized `click` on
 * iOS, so the tapped control would never activate. Returns an unregister
 * function. */
export function keepKeyboardOpen(node: HTMLElement): () => void {
  const onMousedown = (event: MouseEvent) => {
    if (!isEditable(event.target)) event.preventDefault();
  };
  node.addEventListener('mousedown', onMousedown);
  return () => node.removeEventListener('mousedown', onMousedown);
}

/** Hide an open keyboard, blurring the focused input so it doesn't
 * immediately rise again the next time the window regains focus. No-op while
 * the keyboard is closed, so a focused input never loses its caret on
 * platforms with no soft keyboard. `keepFocus` skips the blur — the input
 * keeps its caret, at the risk of the OS summoning the keyboard back on the
 * next window-focus event. */
export function hideKeyboard({ keepFocus = false } = {}) {
  if (!open.value) return;
  if (!keepFocus && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  void hideKeyboardCommand();
}

/** Subscribe to the native will-show notification, which arrives with the
 * target height and duration before the open animation starts. */
export function onKeyboardWillShow(
  listener: (event: KeyboardWillShowEvent) => void,
): () => void {
  willShowListeners.add(listener);
  return () => willShowListeners.delete(listener);
}

/** Subscribe to the native will-hide notification, which arrives with the
 * duration before the close animation starts. */
export function onKeyboardWillHide(
  listener: (event: KeyboardWillHideEvent) => void,
): () => void {
  willHideListeners.add(listener);
  return () => willHideListeners.delete(listener);
}

/** Keyboard state as signalium signals, fed by the native events. Heights are
 * in CSS px and settle at the animation endpoints. */
export const keyboard: {
  height: ReadonlySignal<number>;
  isOpen: ReadonlySignal<boolean>;
  /** The full keyboard height (largest seen, persisted), or a fallback before
   * any keyboard has been shown. */
  reservedHeight: ReadonlySignal<number>;
} = {
  height,
  isOpen: open,
  reservedHeight: reactiveSignal(() => settledHeight.value || FALLBACK_HEIGHT),
};

// Start tracking automatically on import — no app call needed. Idempotent and
// SSR-guarded, so an explicit trackKeyboardHeight() elsewhere is a harmless no-op.
trackKeyboardHeight();
