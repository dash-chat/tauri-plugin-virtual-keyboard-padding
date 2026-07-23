package org.dashchat.virtualkeyboard

import android.view.View
import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import androidx.core.view.OnApplyWindowInsetsListener
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

@TauriPlugin
class VirtualKeyboardPlugin(private val activity: Activity): Plugin(activity) {
    private var webView: WebView? = null
    private var animating = false

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
        val rootView = activity.window.decorView
        val density = activity.resources.displayMetrics.density

        // The webview keeps its full size and the IME overlays it; the page lays
        // itself out against the --keyboard-inset-height CSS variable the guest-js side
        // maintains from the keyboard events emitted here.
        ViewCompat.setOnApplyWindowInsetsListener(rootView,
            OnApplyWindowInsetsListener { _: View?, windowInsets: WindowInsetsCompat? ->
                val ime = windowInsets!!.getInsets(WindowInsetsCompat.Type.ime())

                if (ime.bottom > 0) {
                    webView.scrollTo(0, 0)
                }

                // Animated changes are reported by the willShow/willHide pair
                // below; this covers IMEs/settings where no animation runs.
                if (!animating) {
                    val data = JSObject()
                    data.put("height", ime.bottom / density)
                    trigger("change", data)
                }

                windowInsets
            })

        ViewCompat.setWindowInsetsAnimationCallback(rootView, object :
            WindowInsetsAnimationCompat.Callback(
                WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE
            ) {
            override fun onPrepare(animation: WindowInsetsAnimationCompat) {
                if ((animation.typeMask and WindowInsetsCompat.Type.ime()) != 0) {
                    animating = true
                }
            }

            override fun onStart(
                animation: WindowInsetsAnimationCompat,
                bounds: WindowInsetsAnimationCompat.BoundsCompat
            ): WindowInsetsAnimationCompat.BoundsCompat {
                if ((animation.typeMask and WindowInsetsCompat.Type.ime()) != 0) {
                    // The end-state insets are already dispatched by onStart, so
                    // the root insets carry the animation's target height.
                    val target = imeHeight(rootView) / density
                    val data = JSObject()
                    data.put("durationMs", animation.durationMillis)
                    if (target > 0) {
                        data.put("height", target)
                        trigger("willShow", data)
                    } else {
                        trigger("willHide", data)
                    }
                }
                return bounds
            }

            // Required override. The per-frame insets are deliberately ignored:
            // --keyboard-inset-height is set once from the target height reported by
            // onStart, and the guest-js side glides the layout on the compositor.
            override fun onProgress(
                insets: WindowInsetsCompat,
                runningAnimations: List<WindowInsetsAnimationCompat>
            ): WindowInsetsCompat = insets

            override fun onEnd(animation: WindowInsetsAnimationCompat) {
                if ((animation.typeMask and WindowInsetsCompat.Type.ime()) != 0) {
                    animating = false
                    val height = imeHeight(rootView) / density
                    val data = JSObject()
                    if (height > 0) {
                        data.put("height", height)
                        trigger("didShow", data)
                    } else {
                        trigger("didHide", data)
                    }
                }
            }
        })
    }

    private fun imeHeight(rootView: View): Int =
        ViewCompat.getRootWindowInsets(rootView)
            ?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0

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
