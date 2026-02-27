use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod error;

pub use error::{Error, Result};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_virtual_keyboard_padding);

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("virtual-keyboard-padding")
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
