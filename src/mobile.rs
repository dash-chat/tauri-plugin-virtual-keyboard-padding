use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

#[cfg(target_os = "android")]
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<VirtualKeyboardPadding<R>> {
  let handle = api.register_android_plugin("org.dashchat.virtualkeyboardpadding", "VirtualKeyboardPaddingPlugin")?;
  Ok(VirtualKeyboardPadding(handle))
}

#[cfg(target_os = "ios")]
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<VirtualKeyboardPadding<R>> {
  let handle = api.register_ios_plugin(super::init_plugin_virtual_keyboard_padding)?;
  Ok(VirtualKeyboardPadding(handle))
}

/// Access to the virtual-keyboard-padding APIs.
pub struct VirtualKeyboardPadding<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> VirtualKeyboardPadding<R> {}
