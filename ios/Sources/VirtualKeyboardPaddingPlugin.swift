import Tauri
import UIKit
import WebKit

/// iOS keyboard handling, modeled on Capacitor's `@capacitor/keyboard` plugin
/// (`KeyboardResize.Native` mode):
///
///   1. Listen for `keyboardWillShow` / `keyboardWillHide` /
///      `keyboardWillChangeFrame` (the third one catches predictive-bar /
///      autofill / language-switch frame changes the first two miss).
///   2. On every event, reset `webView.scrollView.contentInset` and
///      `scrollIndicatorInsets` to `.zero`. iOS's own observers stay in place
///      and adjust them; we override immediately so the user never sees a
///      scrollable inset.
///   3. Resize `webView.frame.size.height` against `superview.bounds.height`
///      (the parent view's height — stable across the animation, unaffected
///      by previous resizes), so `100vh` etc. correctly track the visible
///      area.
///   4. Swizzle `WKContentView.inputAccessoryView` to drop the "Done" toolbar.
///
/// See `docs/ios-keyboard-bugs.md` (Option A, applied properly).
class VirtualKeyboardPaddingPlugin: Plugin, UIScrollViewDelegate {
    private weak var webView: WKWebView?
    /// Last background color applied to the native ancestor chain. Used to
    /// skip redundant paints on every keyboard show.
    private var lastAppliedColor: UIColor?

    public override func load(webview: WKWebView) {
        self.webView = webview

        webview.scrollView.contentInsetAdjustmentBehavior = .never
        webview.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        // The outer WKWebView scrollView is never used in this app — every
        // scrollable surface (chat list, settings, etc.) is a nested DOM
        // overflow container. Clamp `contentOffset` to `.zero` so iOS's
        // auto-scroll-to-cursor (which sometimes fires after our keyboard
        // handler) can't briefly shift the document and produce the visible
        // "top bar dips down then animates back up" glitch.
        webview.scrollView.delegate = self

        let nc = NotificationCenter.default
        nc.addObserver(
            self,
            selector: #selector(keyboardWillShow(_:)),
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
        nc.addObserver(
            self,
            selector: #selector(keyboardWillHide(_:)),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
        nc.addObserver(
            self,
            selector: #selector(keyboardWillChangeFrame(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )

        removeInputAccessoryView()

        // Detect the page's background color and paint it onto the native
        // ancestor chain so the area around the keyboard's rounded top
        // corners matches the app instead of showing black. Delayed so the
        // page has had a chance to render an opaque background.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.detectAndApplyBackgroundColor()
        }
    }

    @objc private func keyboardWillShow(_ notification: Notification) {
        // Re-detect on every show so theme changes (light/dark, iOS/Material)
        // are picked up without a JS-to-native command channel.
        detectAndApplyBackgroundColor()
        applyKeyboardFrame(notification)
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        animate(notification) { [weak self] in self?.resetWebViewHeight() }
    }

    @objc private func keyboardWillChangeFrame(_ notification: Notification) {
        guard let info = notification.userInfo,
              let endFrame = info[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        // If the frame is moving off-screen, treat as hide.
        let screenHeight = UIScreen.main.bounds.height
        if endFrame.minY >= screenHeight {
            animate(notification) { [weak self] in self?.resetWebViewHeight() }
        } else {
            applyKeyboardFrame(notification)
        }
    }

    private func applyKeyboardFrame(_ notification: Notification) {
        guard let info = notification.userInfo,
              let endFrame = info[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        animate(notification) { [weak self] in
            self?.shrinkWebView(byKeyboardHeight: endFrame.height)
        }
        // The contentOffset clamp on the outer scrollView (above) blocks
        // WebKit's auto-scroll-to-focused-input. Konsta-style apps put the
        // scrollable surface in an inner `overflow: auto` element which the
        // clamp doesn't touch, but WebKit doesn't reliably auto-scroll those
        // either — so an input near the bottom of a long page stays under the
        // keyboard. Trigger a manual `scrollIntoView` on the focused element;
        // `block: 'nearest'` is a no-op when it's already in view (e.g. a
        // chat compose textarea anchored at the bottom).
        scrollFocusedElementIntoView()
    }

    private func scrollFocusedElementIntoView() {
        guard let webView = webView else { return }
        // `behavior: 'instant'` rather than smooth: the WebView frame change
        // animates over the keyboard's ~250ms duration, so we want the page
        // already scrolled to its target position by the time the frame
        // starts visibly transitioning. A smooth scroll runs on its own
        // curve and lags behind the keyboard, leaving the input under the
        // keyboard for the duration of the animation.
        let js = """
            (function() {
                var el = document.activeElement;
                if (!el) return;
                var tag = el.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) {
                    el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                }
            })();
        """
        webView.evaluateJavaScript(js)
    }

    private func shrinkWebView(byKeyboardHeight keyboardHeight: CGFloat) {
        guard let webView = webView, let parent = webView.superview else { return }
        resetScrollState(webView)
        var frame = webView.frame
        frame.size.height = parent.bounds.height - keyboardHeight - webView.frame.origin.y
        webView.frame = frame
    }

    private func resetWebViewHeight() {
        guard let webView = webView, let parent = webView.superview else { return }
        resetScrollState(webView)
        var frame = webView.frame
        frame.size.height = parent.bounds.height - webView.frame.origin.y
        webView.frame = frame
    }

    /// iOS's own keyboard observers run before ours; they push
    /// `contentInset.bottom` to `keyboardHeight` and frequently auto-scroll
    /// the document so the focused input is visible. Without resetting
    /// `contentOffset`, the top bar lands off-screen for a frame and the
    /// keyboard animation visibly snaps it back. Zero everything so the
    /// document is anchored to its top throughout the resize.
    private func resetScrollState(_ webView: WKWebView) {
        webView.scrollView.contentInset = .zero
        webView.scrollView.scrollIndicatorInsets = .zero
        webView.scrollView.contentOffset = .zero
    }

    // MARK: - UIScrollViewDelegate

    /// Catches any auto-scroll attempts (iOS's keyboard cursor follow, WebKit's
    /// scroll-to-focused-input, etc.) that happen between our keyboard handler
    /// and the animation completing. Without this clamp the resets above can
    /// be undone by a later iOS-internal scroll, producing the intermittent
    /// "top bar slides down then back up" glitch.
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if scrollView.contentOffset != .zero {
            scrollView.contentOffset = .zero
        }
    }

    private func animate(_ notification: Notification, _ block: @escaping () -> Void) {
        let info = notification.userInfo
        let duration = (info?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curveRaw = (info?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? 7
        let options = UIView.AnimationOptions(rawValue: curveRaw << 16)
        UIView.animate(withDuration: duration, delay: 0, options: options, animations: block)
    }

    // MARK: - Background color around the keyboard

    /// Read the rendered page background via JS and paint the native view
    /// hierarchy with it. The body is `background-color: transparent` (set
    /// in `app.css`) so the painted native color is what shows through the
    /// keyboard's translucent rounded corners.
    private func detectAndApplyBackgroundColor() {
        guard let webView = webView else { return }
        let js = """
            (function() {
                var el = document.querySelector('.k-page') || document.body;
                while (el) {
                    var bg = getComputedStyle(el).backgroundColor;
                    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
                    el = el.parentElement;
                }
                return null;
            })()
        """
        webView.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self = self, let webView = self.webView else { return }
            guard let css = result as? String, let color = self.parseRGBColor(css) else { return }
            DispatchQueue.main.async { self.applyBackgroundColor(color, to: webView) }
        }
    }

    private func parseRGBColor(_ css: String) -> UIColor? {
        let pattern = #"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: css, range: NSRange(css.startIndex..., in: css)),
              match.numberOfRanges >= 4 else { return nil }
        func intVal(_ i: Int) -> CGFloat? {
            guard let range = Range(match.range(at: i), in: css) else { return nil }
            return CGFloat(Double(css[range]) ?? -1)
        }
        guard let r = intVal(1), let g = intVal(2), let b = intVal(3),
              r >= 0, g >= 0, b >= 0 else { return nil }
        return UIColor(red: r / 255.0, green: g / 255.0, blue: b / 255.0, alpha: 1.0)
    }

    private func applyBackgroundColor(_ color: UIColor, to webView: WKWebView) {
        if let last = lastAppliedColor, last.isEqual(color) { return }
        lastAppliedColor = color

        webView.isOpaque = false
        webView.backgroundColor = color
        webView.scrollView.backgroundColor = color

        var view: UIView? = webView.superview
        while let v = view {
            v.backgroundColor = color
            view = v.superview
        }

        if let window = webView.window {
            window.backgroundColor = color
        }
    }

    private func removeInputAccessoryView() {
        guard let webView = webView else { return }
        guard let contentView = findContentView(in: webView) else { return }

        let noAccessoryClass: AnyClass = NoInputAccessoryView.self
        let targetClass: AnyClass = type(of: contentView)

        guard let original = class_getInstanceMethod(targetClass, #selector(getter: UIResponder.inputAccessoryView)) else { return }
        guard let replacement = class_getInstanceMethod(noAccessoryClass, #selector(getter: NoInputAccessoryView.noInputAccessoryView)) else { return }

        method_exchangeImplementations(original, replacement)
    }

    private func findContentView(in webView: WKWebView) -> UIView? {
        let targetClassName = "WKContentView"
        for subview in webView.scrollView.subviews {
            if String(describing: type(of: subview)) == targetClassName {
                return subview
            }
        }
        return nil
    }

    deinit {
        webView?.scrollView.delegate = nil
        NotificationCenter.default.removeObserver(self)
    }
}

class NoInputAccessoryView: NSObject {
    @objc var noInputAccessoryView: UIView? { return nil }
}

@_cdecl("init_plugin_virtual_keyboard_padding")
func initPlugin() -> Plugin {
    return VirtualKeyboardPaddingPlugin()
}
