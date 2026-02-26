use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<VirtualKeyboardPadding<R>> {
  let handle = api.register_android_plugin("org.dashchat.virtualkeyboardpadding", "VirtualKeyboardPaddingPlugin")?;
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
