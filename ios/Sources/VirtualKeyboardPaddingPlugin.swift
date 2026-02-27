import Tauri
import UIKit
import WebKit

class VirtualKeyboardPaddingPlugin: Plugin {
    private weak var webView: WKWebView?
    private var originalHeight: CGFloat = 0
    private var keyboardHeight: CGFloat = 0
    private var insetObservation: NSKeyValueObservation?

    public override func load(webview: WKWebView) {
        self.webView = webview

        webview.scrollView.contentInsetAdjustmentBehavior = .never
        webview.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        removeInputAccessoryView()

        // Prevent iOS from sneaking in a bottom content inset for the keyboard
        insetObservation = webview.scrollView.observe(\.contentInset, options: [.new]) { scrollView, _ in
            if scrollView.contentInset.bottom != 0 {
                scrollView.contentInset.bottom = 0
                scrollView.verticalScrollIndicatorInsets.bottom = 0
            }
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillShow(_:)),
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillHide(_:)),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
    }

    @objc private func keyboardWillShow(_ notification: Notification) {
        guard let webView = webView,
              let userInfo = notification.userInfo,
              let keyboardFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
        else { return }

        let height = keyboardFrame.height
        guard height > 0, keyboardHeight == 0 else { return }

        keyboardHeight = height
        originalHeight = webView.frame.size.height

        let duration = (userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curveRaw = (userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? 7
        let options = UIView.AnimationOptions(rawValue: curveRaw << 16)

        let offset = webView.scrollView.contentOffset
        webView.scrollView.isScrollEnabled = false

        UIView.animate(withDuration: duration, delay: 0, options: options, animations: {
            var frame = webView.frame
            frame.size.height = self.originalHeight - height
            webView.frame = frame
        }, completion: { _ in
            webView.scrollView.contentOffset = offset
            webView.scrollView.isScrollEnabled = true
        })
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        guard let webView = webView, keyboardHeight > 0 else { return }

        let userInfo = notification.userInfo
        let duration = (userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curveRaw = (userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? 7
        let options = UIView.AnimationOptions(rawValue: curveRaw << 16)

        let restoreHeight = originalHeight
        keyboardHeight = 0

        UIView.animate(withDuration: duration, delay: 0, options: options, animations: {
            var frame = webView.frame
            frame.size.height = restoreHeight
            webView.frame = frame
        })
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
        insetObservation?.invalidate()
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
