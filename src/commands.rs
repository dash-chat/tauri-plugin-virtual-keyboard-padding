use tauri::{command, AppHandle, Runtime};

use crate::VirtualKeyboardPaddingExt;

#[command]
pub(crate) async fn hide<R: Runtime>(app: AppHandle<R>) -> crate::Result<()> {
  app.virtual_keyboard_padding().hide()
}

#[command]
pub(crate) async fn show<R: Runtime>(app: AppHandle<R>) -> crate::Result<()> {
  app.virtual_keyboard_padding().show()
}
