import Tauri
import UIKit
import WebKit

class VirtualKeyboardPaddingPlugin: Plugin, UIScrollViewDelegate {
    private weak var webView: WKWebView?
    private var originalHeight: CGFloat = 0
    private var keyboardHeight: CGFloat = 0
    private var backgroundColorSet = false

    public override func load(webview: WKWebView) {
        self.webView = webview

        // 1. Prevent iOS automatic inset adjustments
        webview.scrollView.contentInsetAdjustmentBehavior = .never
        webview.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        webview.scrollView.isScrollEnabled = false
        webview.scrollView.bounces = false

        // 2. CRITICAL: Remove WKWebView's own keyboard notification observers.
        // WKWebView internally registers observers that auto-adjust
        // scrollView.contentInset and contentOffset on keyboard events.
        // Removing them gives us full control.
        let nc = NotificationCenter.default
        nc.removeObserver(webview, name: UIResponder.keyboardWillHideNotification, object: nil)
        nc.removeObserver(webview, name: UIResponder.keyboardWillShowNotification, object: nil)
        nc.removeObserver(webview, name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        nc.removeObserver(webview, name: UIResponder.keyboardDidChangeFrameNotification, object: nil)

        // 3. Remove the "Done" toolbar above the keyboard
        removeInputAccessoryView()

        // 4. Become scroll delegate for contentOffset clamping
        webview.scrollView.delegate = self

        // 5. Register OUR keyboard notifications
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
    }

    // MARK: - Commands

    @objc public func hide(_ invoke: Invoke) throws {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.endEditing(true)
            invoke.resolve()
        }
    }

    /// iOS cannot summon the keyboard programmatically for webview content;
    /// it only appears when the user focuses an input. Resolves as a no-op.
    @objc public func show(_ invoke: Invoke) throws {
        invoke.resolve()
    }

    // MARK: - Background color

    /// Auto-detect the page's rendered background color via JavaScript,
    /// then apply it to the native view hierarchy. This prevents a flash
    /// of the wrong color during keyboard open/close animation.
    private func detectAndApplyBackgroundColor() {
        guard let webView = webView else { return }

        // Walk up from .k-page (Konsta UI) or body to find the first
        // non-transparent computed background color.
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
            guard let colorStr = result as? String,
                  let color = self.parseRGBColor(colorStr) else { return }

            DispatchQueue.main.async {
                self.applyBackgroundColor(color, to: webView)
            }
        }
    }

    /// Parse CSS rgb(r,g,b) or rgba(r,g,b,a) string into UIColor.
    private func parseRGBColor(_ css: String) -> UIColor? {
        // Match rgb(r, g, b) or rgba(r, g, b, a)
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

    /// Apply the detected background color to the webview and all ancestor views.
    private func applyBackgroundColor(_ color: UIColor, to webView: WKWebView) {
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

    // MARK: - UIScrollViewDelegate

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if scrollView.contentOffset != .zero {
            scrollView.contentOffset = .zero
        }
    }

    // MARK: - Keyboard handling

    @objc private func keyboardWillShow(_ notification: Notification) {
        guard let webView = webView,
              let userInfo = notification.userInfo,
              let keyboardFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
        else { return }

        let height = keyboardFrame.height
        guard height > 0, keyboardHeight == 0 else { return }

        keyboardHeight = height
        originalHeight = webView.frame.size.height

        // Auto-detect and apply background color from the rendered page
        if !backgroundColorSet {
            backgroundColorSet = true
            detectAndApplyBackgroundColor()
        }

        let duration = (userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curveRaw = (userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? 7
        let options = UIView.AnimationOptions(rawValue: curveRaw << 16)

        let newHeight = originalHeight - height

        // Reset scroll state before any changes
        webView.scrollView.contentInset = .zero
        webView.scrollView.contentOffset = .zero

        // Override 100vh-based CSS classes with the actual visible height in pixels.
        // 100vh doesn't update on WKWebView frame resize, so without this the
        // content stays at the original viewport size and creates a scrollable gap.
        webView.evaluateJavaScript("""
            (function() {
                var s = document.getElementById('__vkp');
                if (!s) { s = document.createElement('style'); s.id = '__vkp'; document.head.appendChild(s); }
                s.textContent = '.min-h-screen { min-height: \(newHeight)px !important; } .h-screen { height: \(newHeight)px !important; }';
                document.documentElement.style.setProperty('--keyboard-height', '\(height)px');
                document.documentElement.style.overflow = 'hidden';
                document.body.style.overflow = 'hidden';
            })()
        """, completionHandler: nil)

        UIView.animate(withDuration: duration, delay: 0, options: options, animations: {
            var frame = webView.frame
            frame.size.height = newHeight
            webView.frame = frame
        }) { _ in
            webView.scrollView.contentInset = .zero
            webView.scrollView.contentOffset = .zero
        }
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        guard let webView = webView, keyboardHeight > 0 else { return }

        let userInfo = notification.userInfo
        let duration = (userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curveRaw = (userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? 7
        let options = UIView.AnimationOptions(rawValue: curveRaw << 16)

        let restoreHeight = originalHeight
        keyboardHeight = 0

        webView.evaluateJavaScript("""
            (function() {
                var s = document.getElementById('__vkp');
                if (s) s.textContent = '';
                document.documentElement.style.setProperty('--keyboard-height', '0px');
                document.documentElement.style.overflow = '';
                document.body.style.overflow = '';
            })()
        """, completionHandler: nil)

        UIView.animate(withDuration: duration, delay: 0, options: options, animations: {
            var frame = webView.frame
            frame.size.height = restoreHeight
            webView.frame = frame
        }) { _ in
            webView.scrollView.contentInset = .zero
            webView.scrollView.contentOffset = .zero
        }
    }

    /// Swizzle the WKWebView content view's inputAccessoryView to remove the "Done" toolbar.
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
