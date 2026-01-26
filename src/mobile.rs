use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_virtual_keyboard_padding);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<VirtualKeyboardPadding<R>> {
  #[cfg(target_os = "android")]
  let handle = api.register_android_plugin("org.dashchat.virtualkeyboardpadding", "VirtualKeyboardPaddingPlugin")?;
  #[cfg(target_os = "ios")]
  let handle = api.register_ios_plugin(init_plugin_virtual_keyboard_padding)?;
  Ok(VirtualKeyboardPadding(handle))
}

/// Access to the virtual-keyboard-padding APIs.
pub struct VirtualKeyboardPadding<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> VirtualKeyboardPadding<R> {
  // pub fn ping(&self, payload: PingRequest) -> crate::Result<PingResponse> {
  //   self
  //     .0
  //     .run_mobile_plugin("ping", payload)
  //     .map_err(Into::into)
  // }
}
