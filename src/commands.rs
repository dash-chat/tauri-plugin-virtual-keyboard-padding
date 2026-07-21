use tauri::{command, AppHandle, Runtime};

use crate::VirtualKeyboardExt;

#[command]
pub(crate) async fn hide<R: Runtime>(app: AppHandle<R>) -> crate::Result<()> {
  app.virtual_keyboard().hide()
}

#[command]
pub(crate) async fn show<R: Runtime>(app: AppHandle<R>) -> crate::Result<()> {
  app.virtual_keyboard().show()
}
