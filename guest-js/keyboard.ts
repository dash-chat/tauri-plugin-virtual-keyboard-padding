import { addPluginListener } from '@tauri-apps/api/core';
import { signal, reactiveSignal, type ReadonlySignal } from 'signalium';

const FALLBACK_HEIGHT = 270;
const STORAGE_KEY = 'virtual-keyboard:keyboard-height';

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
const maxHeight = signal(0);
let tracking = false;
let band: HTMLElement | null = null;

const willShowListeners = new Set<(event: KeyboardWillShowEvent) => void>();
const willHideListeners = new Set<(event: KeyboardWillHideEvent) => void>();

function setState(nextHeight: number, nextOpen: boolean) {
  height.value = nextHeight;
  open.value = nextOpen;
  if (band) band.style.height = `${nextHeight}px`;
}

/** Paint the keyboard's region with the app surface (via the `--keyboard-fill`
 * CSS variable the app sets) so the keyboard's rounded corners blend into the
 * app instead of revealing the transparent-webview base. Sits behind the app
 * content and is zero-height whenever the keyboard is down, so it never covers a
 * full-bleed surface behind the webview — e.g. a QR scanner's camera feed. */
function ensureKeyboardBand() {
  if (typeof document === 'undefined' || !document.body || band) return;
  band = document.createElement('div');
  band.style.cssText =
    'position:fixed;bottom:0;inset-inline:0;height:0;' +
    'background:var(--keyboard-fill,transparent);pointer-events:none;';
  document.body.prepend(band);
  band.style.height = `${height.value}px`;
}

function adoptHeight(candidate: number) {
  if (candidate <= maxHeight.value) return;
  maxHeight.value = candidate;
  localStorage.setItem(STORAGE_KEY, String(candidate));
}

function listen<T>(event: string, handler: (payload: T) => void) {
  // Desktop builds have no native side to register listeners with; the state
  // then simply stays closed.
  addPluginListener('virtual-keyboard', event, handler).catch(() => {});
}

/** Start maintaining the keyboard state from the plugin's native events.
 * Idempotent; call once at startup. */
export function trackKeyboardHeight() {
  if (tracking || typeof window === 'undefined') return;
  tracking = true;
  ensureKeyboardBand();
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  if (stored > 0) maxHeight.value = stored;
  listen<KeyboardWillShowEvent>('willShow', event => {
    adoptHeight(event.height);
    setState(event.height, true);
    for (const listener of willShowListeners) listener(event);
  });
  listen<KeyboardWillHideEvent>('willHide', event => {
    setState(0, false);
    for (const listener of willHideListeners) listener(event);
  });
  listen<{ height: number }>('didShow', event => {
    adoptHeight(event.height);
    setState(event.height, true);
  });
  listen('didHide', () => setState(0, false));
  listen<{ height: number }>('change', event => {
    if (event.height > 0) adoptHeight(event.height);
    setState(event.height, event.height > 0);
  });
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
  reservedHeight: reactiveSignal(() => maxHeight.value || FALLBACK_HEIGHT),
};

// Start tracking automatically on import — no app call needed. Idempotent and
// SSR-guarded, so an explicit trackKeyboardHeight() elsewhere is a harmless no-op.
trackKeyboardHeight();
