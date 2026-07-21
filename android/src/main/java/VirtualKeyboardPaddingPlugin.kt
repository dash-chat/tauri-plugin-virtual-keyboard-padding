package org.dashchat.virtualkeyboardpadding

import android.view.View
import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import androidx.core.view.OnApplyWindowInsetsListener
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

// From https://github.com/tauri-apps/tauri/issues/10631

@TauriPlugin
class VirtualKeyboardPaddingPlugin(private val activity: Activity): Plugin(activity) {
    private var webView: WebView? = null

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
        val rootView = activity.window.decorView

        ViewCompat.setOnApplyWindowInsetsListener(rootView,
            OnApplyWindowInsetsListener { v: View?, windowInsets: WindowInsetsCompat? ->
                val systemBars = windowInsets!!.getInsets(WindowInsetsCompat.Type.systemBars())
                val ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime())

                if (ime.bottom > 0) {
                   webView.scrollTo(0, 0)
                }
            
                v!!.setPadding(0, 0, 0, ime.bottom)

                windowInsets
            })
    }

    @Command
    fun hide(invoke: Invoke) {
        activity.runOnUiThread {
            webView?.let {
                WindowInsetsControllerCompat(activity.window, it)
                    .hide(WindowInsetsCompat.Type.ime())
            }
            invoke.resolve()
        }
    }

    @Command
    fun show(invoke: Invoke) {
        activity.runOnUiThread {
            webView?.let {
                WindowInsetsControllerCompat(activity.window, it)
                    .show(WindowInsetsCompat.Type.ime())
            }
            invoke.resolve()
        }
    }
}
