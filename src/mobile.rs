use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

#[cfg(target_os = "android")]
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<VirtualKeyboard<R>> {
  let handle = api.register_android_plugin("org.dashchat.virtualkeyboard", "VirtualKeyboardPlugin")?;
  Ok(VirtualKeyboard(handle))
}

#[cfg(target_os = "ios")]
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<VirtualKeyboard<R>> {
  let handle = api.register_ios_plugin(super::init_plugin_virtual_keyboard)?;
  Ok(VirtualKeyboard(handle))
}

/// Access to the virtual-keyboard APIs.
pub struct VirtualKeyboard<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> VirtualKeyboard<R> {
  pub fn hide(&self) -> crate::Result<()> {
    self.0.run_mobile_plugin("hide", ()).map_err(Into::into)
  }

  pub fn show(&self) -> crate::Result<()> {
    self.0.run_mobile_plugin("show", ()).map_err(Into::into)
  }
}
