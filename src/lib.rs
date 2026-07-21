use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::VirtualKeyboardPadding;
#[cfg(mobile)]
use mobile::VirtualKeyboardPadding;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_virtual_keyboard_padding);

pub trait VirtualKeyboardPaddingExt<R: Runtime> {
    fn virtual_keyboard_padding(&self) -> &VirtualKeyboardPadding<R>;
}

impl<R: Runtime, T: Manager<R>> VirtualKeyboardPaddingExt<R> for T {
    fn virtual_keyboard_padding(&self) -> &VirtualKeyboardPadding<R> {
        self.state::<VirtualKeyboardPadding<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("virtual-keyboard-padding")
        .invoke_handler(tauri::generate_handler![commands::hide, commands::show])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let virtual_keyboard_padding = mobile::init(app, api)?;
            #[cfg(target_os = "ios")]
            let virtual_keyboard_padding = mobile::init(app, api)?;
            #[cfg(desktop)]
            let virtual_keyboard_padding = desktop::init(app, api)?;

            app.manage(virtual_keyboard_padding);
            Ok(())
        })
        .build()
}
