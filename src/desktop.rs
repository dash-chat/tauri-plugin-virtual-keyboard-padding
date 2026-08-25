use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<VirtualKeyboard<R>> {
  Ok(VirtualKeyboard(app.clone()))
}

/// Access to the virtual-keyboard APIs.
pub struct VirtualKeyboard<R: Runtime>(AppHandle<R>);

impl<R: Runtime> VirtualKeyboard<R> {
  pub fn hide(&self) -> crate::Result<()> {
    Ok(())
  }

  pub fn show(&self) -> crate::Result<()> {
    Ok(())
  }
}
