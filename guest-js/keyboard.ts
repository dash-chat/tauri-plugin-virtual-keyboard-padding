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

const willShowListeners = new Set<(event: KeyboardWillShowEvent) => void>();
const willHideListeners = new Set<(event: KeyboardWillHideEvent) => void>();

function setState(nextHeight: number, nextOpen: boolean) {
  height.value = nextHeight;
  open.value = nextOpen;
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
 * in CSS px and settle at the animation endpoints; per-frame layout should
 * consume the --keyboard-height CSS variable the plugin maintains instead. */
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
