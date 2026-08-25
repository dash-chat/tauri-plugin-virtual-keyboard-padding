import Tauri
import UIKit
import WebKit

class VirtualKeyboardPlugin: Plugin, UIScrollViewDelegate {
    private weak var webView: WKWebView?
    private var currentHeight: CGFloat = 0

    // The keyboard events go straight into the page: the Tauri plugin event
    // channel delivers with enough latency that a willShow sent through it
    // can arrive after the keyboard animation it announces has already
    // finished. A direct evaluation lands within a frame or two — early
    // enough for the page to glide its layout in sync with the animation.
    // Runs on the main thread (the keyboard notifications' thread).
    private func emit(_ name: String, _ json: String) {
        webView?.evaluateJavaScript(
            "window.__VIRTUAL_KEYBOARD_EVENT__ && window.__VIRTUAL_KEYBOARD_EVENT__('\(name)', \(json))",
            completionHandler: nil)
    }

    public override func load(webview: WKWebView) {
        self.webView = webview

        // The webview keeps its full size with all automatic keyboard handling
        // disabled; the keyboard overlays it and the page lays itself out
        // against the --keyboard-inset-height CSS variable this plugin maintains.
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
        guard height > 0, height != currentHeight else { return }
        currentHeight = height

        let duration = (userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25

        emit("willShow", "{\"height\":\(Double(height)),\"durationMs\":\(duration * 1000)}")
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        guard currentHeight > 0 else { return }
        currentHeight = 0

        let duration = (notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25

        emit("willHide", "{\"durationMs\":\(duration * 1000)}")
    }

    @objc private func keyboardDidShow(_ notification: Notification) {
        emit("didShow", "{\"height\":\(Double(currentHeight))}")
    }

    @objc private func keyboardDidHide(_ notification: Notification) {
        emit("didHide", "{}")
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

@_cdecl("init_plugin_virtual_keyboard")
func initPlugin() -> Plugin {
    return VirtualKeyboardPlugin()
}
