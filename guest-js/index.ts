import { invoke } from '@tauri-apps/api/core';

export {
  keyboard,
  onKeyboardChange,
  onKeyboardWillShow,
  onKeyboardWillHide,
  trackKeyboardHeight,
  type KeyboardWillShowEvent,
  type KeyboardWillHideEvent,
} from './keyboard';

/** Retract the soft keyboard via the OS. No-op on desktop. */
export function hideKeyboard(): Promise<void> {
  return invoke('plugin:virtual-keyboard|hide');
}

/** Summon the soft keyboard for the currently focused input. The input must
 * already hold focus so an IME connection exists. No-op on desktop and iOS
 * (iOS only shows the keyboard on user-initiated focus). */
export function showKeyboard(): Promise<void> {
  return invoke('plugin:virtual-keyboard|show');
}
