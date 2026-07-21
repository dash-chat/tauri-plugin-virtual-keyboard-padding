use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<VirtualKeyboardPadding<R>> {
  Ok(VirtualKeyboardPadding(app.clone()))
}

/// Access to the virtual-keyboard-padding APIs.
pub struct VirtualKeyboardPadding<R: Runtime>(AppHandle<R>);

impl<R: Runtime> VirtualKeyboardPadding<R> {
  pub fn hide(&self) -> crate::Result<()> {
    Ok(())
  }

  pub fn show(&self) -> crate::Result<()> {
    Ok(())
  }
}
