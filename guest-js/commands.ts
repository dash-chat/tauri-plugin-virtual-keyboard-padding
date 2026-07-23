import { invoke } from '@tauri-apps/api/core';

/** Raw native hide — internal. Use `hideKeyboard` from `keyboard.ts`, which
 * also blurs the focused input so the keyboard doesn't immediately rise
 * again. */
export function hideKeyboardCommand(): Promise<void> {
  return invoke('plugin:virtual-keyboard|hide');
}

/** Summon the soft keyboard for the currently focused input. The input must
 * already hold focus so an IME connection exists. No-op on desktop and iOS
 * (iOS only shows the keyboard on user-initiated focus). */
export function showKeyboard(): Promise<void> {
  return invoke('plugin:virtual-keyboard|show');
}
