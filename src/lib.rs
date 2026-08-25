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
use desktop::VirtualKeyboard;
#[cfg(mobile)]
use mobile::VirtualKeyboard;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_virtual_keyboard);

pub trait VirtualKeyboardExt<R: Runtime> {
    fn virtual_keyboard(&self) -> &VirtualKeyboard<R>;
}

impl<R: Runtime, T: Manager<R>> VirtualKeyboardExt<R> for T {
    fn virtual_keyboard(&self) -> &VirtualKeyboard<R> {
        self.state::<VirtualKeyboard<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("virtual-keyboard")
        .invoke_handler(tauri::generate_handler![commands::hide, commands::show])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let virtual_keyboard = mobile::init(app, api)?;
            #[cfg(target_os = "ios")]
            let virtual_keyboard = mobile::init(app, api)?;
            #[cfg(desktop)]
            let virtual_keyboard = desktop::init(app, api)?;

            app.manage(virtual_keyboard);
            Ok(())
        })
        .build()
}
