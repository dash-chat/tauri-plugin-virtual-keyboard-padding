import { signal, watcher, type ReadonlySignal } from 'signalium';

import { hideCaret, restoreCaret } from './caret';
import { showKeyboard } from './commands';
import {
  hideKeyboard,
  isEditable,
  keyboard,
  onKeyboardWillHide,
  onKeyboardWillShow,
  setBandFloor,
} from './keyboard';

const IS_ANDROID =
  typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

// Matches each OS's IME animation so the content tracks the keyboard's edge.
// On Android the reported durationMs can far exceed the IME's actual visual
// animation (observed ~100ms on OEM keyboards reporting 285ms), and willShow
// reaches JS a frame or two after the animation starts — so the glide is
// clamped short and uses an emphasized-decelerate curve that front-loads
// progress to make up the late start. Trailing the keyboard slightly is the
// safe direction (it hides behind the keyboard); leading would paint a
// background band, so the clamp is chosen to stay just behind. iOS keeps the
// historical approximation of its keyboard curve and its reported duration.
const CURVE = IS_ANDROID
  ? 'cubic-bezier(0.2, 0, 0, 1)'
  : 'cubic-bezier(0.38, 0.7, 0.125, 1)';
const ANDROID_MAX_GLIDE_MS = 160;

function glideDuration(durationMs: number): number {
  return IS_ANDROID ? Math.min(durationMs, ANDROID_MAX_GLIDE_MS) : durationMs;
}

const nodes = new Set<HTMLElement>();
const previewMeasureCallbacks = new Map<HTMLElement, () => void>();

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
  toClear: Iterable<HTMLElement>,
  durationMs: number,
  generation: number,
  applyInsetOnSettle = false,
) {
  const removers: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = () => {
    clearTimeout(timer);
    removers.forEach(remove => remove());
    removers.length = 0;
    // A newer glide owns the caret now, and will restore it from its own settle.
    if (generation !== flipGeneration) return;
    // A layout-at-end glide swaps the glided transforms for the real layout
    // here, in one paint: the reflow lands exactly where the transforms left
    // off.
    if (applyInsetOnSettle) applyInset();
    for (const node of toClear) {
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

  for (const node of toClear) {
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
 *
 * The one-shot reflow happens at whichever endpoint of the transition the
 * keyboard is up, so the layout only ever changes while the keyboard occludes
 * the region the change affects. `layoutAtEnd` is the show path: reflowing at
 * the start would snap unregistered bottom-anchored chrome to its final spot
 * and clip content against the already-shrunk page while the keyboard is still
 * rising. Instead the old layout persists through the glide — the final layout
 * is measured invisibly (apply → read → revert), transforms carry the nodes to
 * those targets, and the settle applies the reflow under the fully-risen
 * keyboard. Hide keeps the reflow up front: the layout has to grow immediately
 * so the region the keyboard vacates exists to glide down into.
 */
function flip(durationMs: number, layoutAtEnd = false) {
  durationMs = glideDuration(durationMs);
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
  const hadTransform = Array.from(nodes).some(
    n => n.style.transform !== '' && n.style.transform !== 'none',
  );
  nodes.forEach(n => firsts.set(n, n.getBoundingClientRect().top));
  // Drop any in-flight transform so the next read is the true post-layout spot.
  nodes.forEach(n => {
    n.style.transition = 'none';
    n.style.transform = '';
  });

  if (layoutAtEnd) {
    const doc = document.documentElement;
    // Where the old layout puts each node untransformed. Only differs from
    // `firsts` when a glide was in flight, so the extra layout pass is skipped
    // otherwise — this whole handler runs in the willShow hot path, and every
    // forced reflow here delays the frame that starts the glide.
    const oldTops = hadTransform ? new Map<HTMLElement, number>() : firsts;
    if (hadTransform) {
      nodes.forEach(n => oldTops.set(n, n.getBoundingClientRect().top));
    }
    // Measure the future without ever painting it: apply, read, revert.
    const prevInset = doc.style.getPropertyValue('--keyboard-inset-height');
    applyInset();
    const lasts = new Map<HTMLElement, number>();
    nodes.forEach(n => lasts.set(n, n.getBoundingClientRect().top));
    // The settled layout is real (and already flushed) right now and observers
    // will never see it before the glide ends — this is the one moment
    // registrants can derive state from it. try/catch so a throwing callback
    // can't skip the revert below and leave the inset applied early.
    previewMeasureCallbacks.forEach(cb => {
      try {
        cb();
      } catch (e) {
        console.error(e);
      }
    });
    // Revert and set the start state together — one flush establishes both as
    // the transition's before-change style.
    doc.style.setProperty('--keyboard-inset-height', prevInset);
    nodes.forEach(n => {
      const start = (firsts.get(n) ?? 0) - (oldTops.get(n) ?? 0);
      n.style.transform = layered.has(n)
        ? `translate3d(0, ${start}px, 0)`
        : start
          ? `translateY(${start}px)`
          : '';
    });
    void doc.getBoundingClientRect();
    // Play on the next frame: transitions backdate their start to the style
    // change's timestamp, so starting inside this (expensive) task would burn
    // the first chunk of the animation while the frame is still being
    // produced — the content would visibly teleport to wherever the timeline
    // already reached. A rAF starts the glide on a freshly-committed frame.
    requestAnimationFrame(() => {
      if (generation !== flipGeneration) return;
      nodes.forEach(n => {
        const oldTop = oldTops.get(n) ?? 0;
        const end = (lasts.get(n) ?? oldTop) - oldTop;
        n.style.transition = `transform ${durationMs}ms ${CURVE}`;
        n.style.transform = layered.has(n)
          ? `translate3d(0, ${end}px, 0)`
          : end
            ? `translateY(${end}px)`
            : '';
      });
      scheduleSettle(nodes, durationMs, generation, true);
    });
    return;
  }

  // Last: the single reflow to the final layout. All reads before all writes —
  // interleaving them forces one reflow per node.
  applyInset();
  const lasts = new Map<HTMLElement, number>();
  nodes.forEach(n => lasts.set(n, n.getBoundingClientRect().top));
  // Invert: put each node back where it visually was.
  nodes.forEach(n => {
    const last = lasts.get(n) ?? 0;
    const delta = (firsts.get(n) ?? last) - last;
    n.style.transform = layered.has(n)
      ? `translate3d(0, ${delta}px, 0)`
      : delta
        ? `translateY(${delta}px)`
        : '';
  });
  // Flush so the inverted transform becomes the transition's start value.
  void document.documentElement.getBoundingClientRect();
  // Play on the next frame — same reason as the show path: transitions
  // backdate their start to the style change's timestamp, and this handler's
  // reflows plus the app's resize observers make the frame late, so an
  // in-task start burns the first chunk of the animation and the content
  // visibly teleports through it. The inverse transforms painted this frame
  // keep everything looking unmoved until the glide begins.
  requestAnimationFrame(() => {
    if (generation !== flipGeneration) return;
    nodes.forEach(n => {
      n.style.transition = `transform ${durationMs}ms ${CURVE}`;
      n.style.transform = layered.has(n) ? 'translate3d(0, 0, 0)' : '';
    });
    scheduleSettle(nodes, durationMs, generation);
  });
}

// The keyboard, below-keyboard surfaces (e.g. a media panel), and slot holds
// share one bottom slot: while any claim is active the slot owns the reserved
// height in the keyboard's place, otherwise the keyboard owns it.
// --keyboard-inset-height reflects whichever is active, so everything
// registered above is lifted the same way either way.
let keyboardHeight = 0;
const slotClaims = new Set<object>();
let surfaceHeight = 0;
let lastDurationMs = 250;

function slotClaimed(): boolean {
  return slotClaims.size > 0;
}

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

// A below-keyboard surface released into the swap hold: it stays at full height
// — visible under the rising keyboard — until the keyboard has covered it, then
// collapses and notifies its owner (which unmounts the content).
let heldSurface: { node: HTMLElement; onHidden?: () => void } | null = null;
let heldSurfaceTimer: ReturnType<typeof setTimeout> | undefined;

function dropHeldSurface(node?: HTMLElement) {
  if (node && heldSurface?.node !== node) return;
  heldSurface = null;
  clearTimeout(heldSurfaceTimer);
}

/** Collapse the held surface once the keyboard has had `delayMs` to cover it.
 * The hold stays registered until the collapse actually runs, so a re-open in
 * the delay window (`dropHeldSurface`) can still cancel it — nulling it up
 * front would leave an orphaned timer that collapses the re-opened surface. */
function resolveHeldSurface(delayMs: number) {
  const held = heldSurface;
  if (!held) return;
  clearTimeout(heldSurfaceTimer);
  heldSurfaceTimer = setTimeout(() => {
    if (heldSurface !== held) return;
    heldSurface = null;
    held.node.style.height = '0px';
    held.onHidden?.();
  }, delayMs);
}

function editableFocused() {
  return isEditable(document.activeElement);
}

function applyInset() {
  const px = slotClaimed() || pendingKeyboard ? surfaceHeight : keyboardHeight;
  document.documentElement.style.setProperty('--keyboard-inset-height', `${px}px`);
}

// The keyboard-aware sibling of env(safe-area-inset-bottom): the bottom space
// the app must not lay out into — the slot inset while occupied (the inset
// always covers the safe area when active), the home-indicator inset
// otherwise. Flips in the same reflow as the inset. Injected as CSS so env()
// resolves natively; module load evaluates once, so this never doubles up.
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent =
    ':root{--keyboard-safe-bottom:max(var(--keyboard-inset-height,0px),env(safe-area-inset-bottom,0px))}';
  document.head.appendChild(style);
}

// Register the FLIP with the keyboard events on module load. Pure and SSR-safe —
// `onKeyboardWill*` just add callbacks to the listener sets — and idempotent,
// since a module evaluates once. The listeners stay inert until the native events
// start pumping into those sets, so nothing here needs a platform gate.
onKeyboardWillShow(({ height, durationMs }) => {
  keyboardHeight = height;
  lastDurationMs = durationMs;
  clearPendingKeyboard();
  // The keyboard reclaiming the slot covers the held surface as it rises;
  // collapse it once the animation has passed over it.
  resolveHeldSurface(glideDuration(durationMs) + 50);
  if (!slotClaimed()) flip(durationMs, true);
});
onKeyboardWillHide(({ durationMs }) => {
  keyboardHeight = 0;
  lastDurationMs = durationMs;
  clearPendingKeyboard();
  resolveHeldSurface(0);
  if (!slotClaimed()) flip(durationMs);
});

/** Add or drop one claimant's claim on the bottom slot: while any claim is
 *  active the slot owns the reserved height in the keyboard's place, and the
 *  FLIP glides everything registered above to match. Returns true when the
 *  release entered the swap hold — the slot stays reserved for the rising
 *  keyboard. */
function setSlotClaim(claim: object, active: boolean): boolean {
  surfaceHeight = keyboard.reservedHeight.value;
  const wasClaimed = slotClaimed();
  if (active) slotClaims.add(claim);
  else slotClaims.delete(claim);
  if (slotClaimed() === wasClaimed) return false;
  // Claiming retracts a live keyboard so the slot — not the keyboard — owns
  // the space.
  if (active) hideKeyboard();
  // Releasing straight into a focused input (the slot→keyboard swap): hold the
  // reserved inset until `willShow` lands so nothing dips, and summon the
  // keyboard explicitly — on Android a programmatic focus() does not raise the
  // IME, so without the native show the hold would just sit out its backstop
  // as an empty slot. A backstop clears the hold in case no keyboard rises
  // anyway (e.g. a hardware keyboard is attached).
  if (!active && keyboardHeight === 0 && editableFocused()) {
    pendingKeyboard = true;
    clearTimeout(pendingKeyboardTimer);
    pendingKeyboardTimer = setTimeout(() => {
      pendingKeyboard = false;
      resolveHeldSurface(0);
      flip(lastDurationMs);
    }, SWAP_BACKSTOP_MS);
    void showKeyboard();
    return true;
  }
  clearPendingKeyboard();
  flip(lastDurationMs);
  return false;
}

/**
 * Keep a node rendered above the keyboard: across a keyboard or below-keyboard
 * surface transition it glides to its new spot on the compositor, instead of
 * being re-laid-out every frame (which is what makes a message list tremble).
 *
 * Returns an unregister function.
 */
export function registerAboveKeyboard(
  node: HTMLElement,
  opts?: {
    /** On keyboard show the one-shot reflow is deferred to the end of the
     * glide, so geometry-derived state (e.g. a navbar opacity keyed on scroll
     * metrics) would lag the whole animation. This runs while the glide's
     * final layout is applied invisibly for measurement, before the animation
     * starts — read geometry freely, but write only paint-level styles
     * (opacity, color): a layout-affecting write would corrupt the
     * measurement. */
    onPreviewLayoutMeasure?: () => void;
  },
): () => void {
  nodes.add(node);
  if (opts?.onPreviewLayoutMeasure) {
    previewMeasureCallbacks.set(node, opts.onPreviewLayoutMeasure);
  }
  return () => {
    nodes.delete(node);
    previewMeasureCallbacks.delete(node);
  };
}

export interface BelowKeyboardSurface {
  /** Open/close the surface, gliding everything registered above it. */
  setOpen(open: boolean): void;
  /** Whether the surface's region is visible — open, or released into a swap
   * hold and not yet covered by the risen keyboard. Keep the surface's content
   * mounted while true so it doesn't visibly vanish mid-swap. */
  visible: ReadonlySignal<boolean>;
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

  const claim = {};
  let open = false;
  let destroyed = false;

  const visible = signal(false);
  const hidden = () => {
    visible.value = false;
  };

  const sync = () => {
    const reserved = keyboard.reservedHeight.value;
    if (open) {
      // Re-opening cancels a pending covered-collapse from a previous swap.
      dropHeldSurface(node);
      visible.value = true;
      node.style.height = `${reserved}px`;
      setSlotClaim(claim, true);
      return;
    }
    const held = setSlotClaim(claim, false);
    if (held) {
      // Swap hold: keep the surface at full height, visible under the rising
      // keyboard; the willShow/backstop resolution collapses it once covered.
      heldSurface = { node, onHidden: hidden };
      return;
    }
    // A hold in progress owns the height until its resolution collapses it —
    // a re-sync (e.g. reservedHeight changing) must not cut it short.
    if (heldSurface?.node === node) return;
    node.style.height = '0px';
    hidden();
  };

  // Re-sync if the reserved height is learned/changes while mounted.
  const w = watcher(() => {
    keyboard.reservedHeight.value;
  });
  const unsubscribe = w.addListener(sync);
  sync();

  return {
    visible,
    setOpen(next: boolean) {
      if (destroyed || next === open) return;
      open = next;
      sync();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      dropHeldSurface(node);
      if (open) setSlotClaim(claim, false);
    },
  };
}

export interface KeyboardSlotHold {
  /** Give the slot back. `restoreFocus` refocuses the element that was focused
   * at hold time and summons the keyboard into the still-held slot, so nothing
   * above dips during the swap. Idempotent. */
  release(opts?: { restoreFocus?: boolean }): void;
}

const inertHold: KeyboardSlotHold = { release() {} };

/**
 * Retract the keyboard without giving up its slot: `--keyboard-inset-height`
 * keeps the reserved height and the background band keeps the keyboard's
 * region painted, so the layout above stays put with no surface of its own —
 * e.g. under an overlay that dims the chat but must not collapse the composer.
 * When the keyboard is closed there is no space to preserve and the returned
 * hold is inert, so callers can hold and release unconditionally.
 */
export function holdKeyboardSlot(): KeyboardSlotHold {
  if (!keyboard.isOpen.value) return inertHold;
  // Captured before the claim blurs it, to give focus back on release.
  const active = document.activeElement;
  const focused = active instanceof HTMLElement ? active : null;
  const claim = {};
  setSlotClaim(claim, true);
  setBandFloor(surfaceHeight);
  let released = false;
  return {
    release({ restoreFocus = false } = {}) {
      if (released) return;
      released = true;
      setBandFloor(0);
      // Focus first: the claim release then sees the focused editable and holds
      // the inset until the rising keyboard's `willShow` reclaims it.
      if (restoreFocus && focused) {
        focused.focus({ preventScroll: true });
        void showKeyboard();
      }
      setSlotClaim(claim, false);
    },
  };
}
