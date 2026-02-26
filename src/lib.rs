use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(desktop)]
mod desktop;
#[cfg(target_os = "android")]
mod mobile;

mod error;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::VirtualKeyboardPadding;
#[cfg(target_os = "android")]
use mobile::VirtualKeyboardPadding;

// /// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the virtual-keyboard-padding APIs.
// pub trait VirtualKeyboardPaddingExt<R: Runtime> {
//   fn virtual_keyboard_padding(&self) -> &VirtualKeyboardPadding<R>;
// }

// impl<R: Runtime, T: Manager<R>> crate::VirtualKeyboardPaddingExt<R> for T {
//   fn virtual_keyboard_padding(&self) -> &VirtualKeyboardPadding<R> {
//     self.state::<VirtualKeyboardPadding<R>>().inner()
//   }
// }

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("virtual-keyboard-padding")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let virtual_keyboard_padding = mobile::init(app, api)?;
                app.manage(virtual_keyboard_padding);
            }
            #[cfg(desktop)]
            {
                let virtual_keyboard_padding = desktop::init(app, api)?;
                app.manage(virtual_keyboard_padding);
            }
            Ok(())
        })
        .build()
}
