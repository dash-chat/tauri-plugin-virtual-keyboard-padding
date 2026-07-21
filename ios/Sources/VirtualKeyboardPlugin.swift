import Tauri
import UIKit
import WebKit

class VirtualKeyboardPlugin: Plugin, UIScrollViewDelegate {
    private weak var webView: WKWebView?
    private var displayLink: CADisplayLink?
    private var animStart: CFTimeInterval = 0
    private var animDuration: Double = 0.25
    private var animFrom: CGFloat = 0
    private var animTo: CGFloat = 0
    private var currentHeight: CGFloat = 0

    public override func load(webview: WKWebView) {
        self.webView = webview

        // The webview keeps its full size with all automatic keyboard handling
        // disabled; the keyboard overlays it and the page lays itself out
        // against the --keyboard-height CSS variable this plugin maintains.
        webview.scrollView.contentInsetAdjustmentBehavior = .never
        webview.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        webview.scrollView.isScrollEnabled = false
        webview.scrollView.bounces = false

        // CRITICAL: Remove WKWebView's own keyboard notification observers.
        // WKWebView internally registers observers that auto-adjust
        // scrollView.contentInset and contentOffset on keyboard events.
        // Removing them gives us full control.
        let nc = NotificationCenter.default
        nc.removeObserver(webview, name: UIResponder.keyboardWillHideNotification, object: nil)
        nc.removeObserver(webview, name: UIResponder.keyboardWillShowNotification, object: nil)
        nc.removeObserver(webview, name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        nc.removeObserver(webview, name: UIResponder.keyboardDidChangeFrameNotification, object: nil)

        // Remove the "Done" toolbar above the keyboard
        removeInputAccessoryView()

        // Become scroll delegate for contentOffset clamping
        webview.scrollView.delegate = self

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
            selector: #selector(keyboardDidShow(_:)),
            name: UIResponder.keyboardDidShowNotification,
            object: nil
        )
        nc.addObserver(
            self,
            selector: #selector(keyboardDidHide(_:)),
            name: UIResponder.keyboardDidHideNotification,
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

    // MARK: - UIScrollViewDelegate

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if scrollView.contentOffset != .zero {
            scrollView.contentOffset = .zero
        }
    }

    // MARK: - Keyboard handling

    @objc private func keyboardWillShow(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let keyboardFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
        else { return }

        let height = keyboardFrame.height
        guard height > 0, height != animTo else { return }

        let duration = (userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        animateHeightVar(to: height, duration: duration)

        var data = JSObject()
        data["height"] = Double(height)
        data["durationMs"] = duration * 1000
        try? trigger("willShow", data: data)
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        guard animTo > 0 || currentHeight > 0 else { return }

        let duration = (notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        animateHeightVar(to: 0, duration: duration)

        var data = JSObject()
        data["durationMs"] = duration * 1000
        try? trigger("willHide", data: data)
    }

    @objc private func keyboardDidShow(_ notification: Notification) {
        var data = JSObject()
        data["height"] = Double(animTo)
        try? trigger("didShow", data: data)
    }

    @objc private func keyboardDidHide(_ notification: Notification) {
        try? trigger("didHide", data: JSObject())
    }

    // MARK: - --keyboard-height animation

    /// iOS has no per-frame keyboard position callback, so the variable is
    /// interpolated over the notification's duration with a display link.
    private func animateHeightVar(to target: CGFloat, duration: Double) {
        displayLink?.invalidate()
        animFrom = currentHeight
        animTo = target
        animDuration = max(duration, 0.01)
        animStart = CACurrentMediaTime()
        let link = CADisplayLink(target: self, selector: #selector(stepHeightVar))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func stepHeightVar() {
        let t = min(1, (CACurrentMediaTime() - animStart) / animDuration)
        // Ease-out cubic: close enough to the (undocumented, spring-like)
        // keyboard curve that the page tracks its edge without visible drift.
        let eased = 1 - pow(1 - t, 3)
        setHeightVar(animFrom + (animTo - animFrom) * CGFloat(eased))
        if t >= 1 {
            displayLink?.invalidate()
            displayLink = nil
        }
    }

    private func setHeightVar(_ height: CGFloat) {
        currentHeight = height
        webView?.evaluateJavaScript(
            "document.documentElement.style.setProperty('--keyboard-height','\(height)px')",
            completionHandler: nil
        )
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
        displayLink?.invalidate()
        webView?.scrollView.delegate = nil
        NotificationCenter.default.removeObserver(self)
    }
}

class NoInputAccessoryView: NSObject {
    @objc var noInputAccessoryView: UIView? { return nil }
}

@_cdecl("init_plugin_virtual_keyboard")
func initPlugin() -> Plugin {
    return VirtualKeyboardPlugin()
}
