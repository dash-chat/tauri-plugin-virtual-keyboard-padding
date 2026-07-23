import { watcher } from 'signalium';

import { hideCaret, restoreCaret } from './caret';
import { hideKeyboard } from './commands';
import { keyboard, onKeyboardWillHide, onKeyboardWillShow } from './keyboard';

// Approximates iOS's keyboard animation curve so the content tracks its edge.
const CURVE = 'cubic-bezier(0.38, 0.7, 0.125, 1)';

const nodes = new Set<HTMLElement>();

// Bumped per flip so a glide that's been superseded doesn't run its tail work.
let flipGeneration = 0;

/**
 * Put the focused node back in plain layout space once the glide lands, and give
 * the caret back.
 *
 * Dropping the transform also clears the transition, so a later layout change
 * can't inherit it and animate when it shouldn't.
 *
 * `transitionend` is the exact landing moment; the timeout is only a backstop
 * for when it can't fire (the transform never changed, or the glide was
 * superseded before finishing).
 */
function scheduleSettle(
  layered: Iterable<HTMLElement>,
  durationMs: number,
  generation: number,
) {
  const removers: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = () => {
    clearTimeout(timer);
    removers.forEach(remove => remove());
    removers.length = 0;
    // A newer glide owns the caret now, and will restore it from its own settle.
    if (generation !== flipGeneration) return;
    for (const node of layered) {
      // Clear the transition first so dropping the transform is instant — it's
      // the identity, so there is nothing to animate away.
      node.style.transition = '';
      node.style.transform = '';
    }
    // Flush the untransformed layout before the caret is drawn again.
    void document.documentElement.getBoundingClientRect();
    restoreCaret();
  };

  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.propertyName === 'transform') run();
  };

  for (const node of layered) {
    node.addEventListener('transitionend', onTransitionEnd);
    removers.push(() =>
      node.removeEventListener('transitionend', onTransitionEnd),
    );
  }
  timer = setTimeout(run, durationMs + 50);
}

/**
 * Animate a keyboard-driven layout change without ever animating a reflow.
 *
 * `--keyboard-inset-height` is changed in one shot, so the layout (including a
 * `column-reverse` message list) reflows exactly once — there's no per-frame
 * reflow to lag and tremble. We then FLIP the registered nodes: measure where
 * each sat, apply the inverse `transform` so it looks unmoved, then transition
 * the transform away so it *glides* to its new spot on the compositor, in sync
 * with the native keyboard.
 */
function flip(durationMs: number) {
  const generation = ++flipGeneration;
  // WKWebView mis-renders a text caret whose ancestor is mid-transform. Keeping
  // the node that holds the focused caret on its own GPU layer — translate3d
  // rather than translateY — renders it stable throughout the glide;
  // `scheduleSettle` takes the layer away again once the glide lands.
  const active = document.activeElement;
  const layered = new Set<HTMLElement>();
  nodes.forEach(n => {
    if (active instanceof HTMLElement && n.contains(active)) layered.add(n);
  });
  // Unconditional, so a glide that ends with nothing focused still hands the
  // caret back to whichever element the previous one blanked.
  restoreCaret();
  if (layered.size > 0 && active instanceof HTMLElement) hideCaret(active);

  const firsts = new Map<HTMLElement, number>();
  // First: current visual position (accounts for a transform still in flight).
  nodes.forEach(n => firsts.set(n, n.getBoundingClientRect().top));
  // Drop any in-flight transform so the next read is the true post-layout spot.
  nodes.forEach(n => {
    n.style.transition = 'none';
    n.style.transform = '';
  });
  // Last: the single reflow to the final layout.
  applyInset();
  // Invert: put each node back where it visually was.
  nodes.forEach(n => {
    const last = n.getBoundingClientRect().top;
    const delta = (firsts.get(n) ?? last) - last;
    n.style.transform = layered.has(n)
      ? `translate3d(0, ${delta}px, 0)`
      : delta
        ? `translateY(${delta}px)`
        : '';
  });
  // Flush so the inverted transform becomes the transition's start value.
  void document.documentElement.getBoundingClientRect();
  // Play: glide to the final position on the compositor.
  nodes.forEach(n => {
    n.style.transition = `transform ${durationMs}ms ${CURVE}`;
    n.style.transform = layered.has(n) ? 'translate3d(0, 0, 0)' : '';
  });
  if (layered.size > 0) scheduleSettle(layered, durationMs, generation);
}

// The keyboard and a below-keyboard surface (e.g. a media panel) share one
// bottom slot: the surface takes it over when open (a "keyboard" of its own
// height), otherwise the keyboard owns it. --keyboard-inset-height reflects whichever
// is active, so everything registered above is lifted the same way either way.
let keyboardHeight = 0;
let surfaceOpen = false;
let surfaceHeight = 0;
let lastDurationMs = 250;

// When the surface closes while handing focus to an input, a keyboard is rising
// to reclaim the slot — but its native `willShow` arrives a few frames later.
// Until then we hold the reserved inset instead of dipping to 0, so the elements
// above stay pinned through the swap rather than falling and springing back.
let pendingKeyboard = false;
let pendingKeyboardTimer: ReturnType<typeof setTimeout> | undefined;
const SWAP_BACKSTOP_MS = 500;

function clearPendingKeyboard() {
  pendingKeyboard = false;
  clearTimeout(pendingKeyboardTimer);
}

function editableFocused() {
  const el = document.activeElement;
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable)
  );
}

function applyInset() {
  const px = surfaceOpen || pendingKeyboard ? surfaceHeight : keyboardHeight;
  document.documentElement.style.setProperty('--keyboard-inset-height', `${px}px`);
}

// Register the FLIP with the keyboard events on module load. Pure and SSR-safe —
// `onKeyboardWill*` just add callbacks to the listener sets — and idempotent,
// since a module evaluates once. The listeners stay inert until the native events
// start pumping into those sets, so nothing here needs a platform gate.
onKeyboardWillShow(({ height, durationMs }) => {
  keyboardHeight = height;
  lastDurationMs = durationMs;
  clearPendingKeyboard();
  if (!surfaceOpen) flip(durationMs);
});
onKeyboardWillHide(({ durationMs }) => {
  keyboardHeight = 0;
  lastDurationMs = durationMs;
  clearPendingKeyboard();
  if (!surfaceOpen) flip(durationMs);
});

/** Report a surface opening/closing below the keyboard: while open it owns the
 *  bottom slot at `height`, in the keyboard's place, and the FLIP glides
 *  everything registered above to match. */
function setBelowKeyboardSurface(open: boolean) {
  surfaceHeight = keyboard.reservedHeight.value;
  if (open === surfaceOpen) return;
  surfaceOpen = open;
  // Closing straight into a focused input (the surface→keyboard swap): hold the
  // reserved inset until `willShow` lands so nothing dips. A backstop clears the
  // hold in case no keyboard rises (e.g. a hardware keyboard is attached).
  if (!open && keyboardHeight === 0 && editableFocused()) {
    pendingKeyboard = true;
    clearTimeout(pendingKeyboardTimer);
    pendingKeyboardTimer = setTimeout(() => {
      pendingKeyboard = false;
      flip(lastDurationMs);
    }, SWAP_BACKSTOP_MS);
    return;
  }
  clearPendingKeyboard();
  flip(lastDurationMs);
}

/**
 * Keep a node rendered above the keyboard: across a keyboard or below-keyboard
 * surface transition it glides to its new spot on the compositor, instead of
 * being re-laid-out every frame (which is what makes a message list tremble).
 *
 * Returns an unregister function.
 */
export function registerAboveKeyboard(node: HTMLElement): () => void {
  nodes.add(node);
  return () => {
    nodes.delete(node);
  };
}

export interface BelowKeyboardSurface {
  /** Open/close the surface, gliding everything registered above it. */
  setOpen(open: boolean): void;
  destroy(): void;
}

/**
 * Render a node below the keyboard — the counterpart to `registerAboveKeyboard`.
 * The bits above the keyboard glide up; this node is revealed in the freed space,
 * standing in for the keyboard. Opening over a live keyboard retracts the keyboard
 * so this node takes its place.
 *
 * Only the node's height is managed here, animated between 0 and the keyboard's
 * reserved height. Positioning it over the keyboard's region is the caller's job:
 * pin it to the viewport bottom (`position: fixed`), and keep it out of any node
 * passed to `registerAboveKeyboard` — a registered ancestor's transform would drag
 * this node along instead of leaving it pinned, and would break `position: fixed`.
 */
export function registerBelowKeyboard(node: HTMLElement): BelowKeyboardSurface {
  // The height is animated to and from 0, so content taller than the current
  // height has to be clipped rather than spill past it.
  node.style.overflow = 'hidden';

  let open = false;
  let destroyed = false;

  const sync = () => {
    const reserved = keyboard.reservedHeight.value;
    node.style.height = open ? `${reserved}px` : '0px';
    setBelowKeyboardSurface(open);
  };

  // Re-sync if the reserved height is learned/changes while mounted.
  const w = watcher(() => {
    keyboard.reservedHeight.value;
  });
  const unsubscribe = w.addListener(sync);
  sync();

  return {
    setOpen(next: boolean) {
      if (destroyed || next === open) return;
      open = next;
      sync();
      // Opening straight over a live keyboard: drop focus and retract it so this
      // surface — not the keyboard — owns the slot.
      if (open && keyboard.isOpen.value) {
        (document.activeElement as HTMLElement | null)?.blur();
        void hideKeyboard();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      if (open) setBelowKeyboardSurface(false);
    },
  };
}
