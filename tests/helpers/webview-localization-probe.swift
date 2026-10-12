import AppKit
import Foundation
import WebKit

final class LocalizationProbe: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private var webView: WKWebView!
    private var watchdog: Timer?
    private var container: NSWindow?

    func start(_ file: URL, width: CGFloat = 1, height: CGFloat = 1) {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "result")
        configuration.userContentController.addUserScript(WKUserScript(source: "window.addEventListener('error', function(event) { window.webkit.messageHandlers.result.postMessage([{locale:'unknown',status:'runtimeFailed',error:String(event.message || 'Resource load failed')}]); });", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: configuration)
        container = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height), styleMask: [], backing: .buffered, defer: false)
        container?.contentView = webView
        webView.navigationDelegate = self
        watchdog = Timer.scheduledTimer(withTimeInterval: 40, repeats: false) { _ in
            FileHandle.standardError.write(Data("WKWebView probe timed out\n".utf8))
            exit(3)
        }
        webView.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "result", JSONSerialization.isValidJSONObject(message.body),
              let data = try? JSONSerialization.data(withJSONObject: message.body, options: [.sortedKeys]) else { exit(4) }
        watchdog?.invalidate()
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
        exit(0)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        FileHandle.standardError.write(Data("WKWebView navigation finished\n".utf8))
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail() }
    private func fail() {
        FileHandle.standardError.write(Data("WKWebView navigation failed\n".utf8))
        exit(5)
    }
}

let arguments = CommandLine.arguments
if arguments.count != 2 && arguments.count != 4 { exit(2) }
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
let probe = LocalizationProbe()
let width = arguments.count == 4 ? Double(arguments[2]) ?? 0 : 1
let height = arguments.count == 4 ? Double(arguments[3]) ?? 0 : 1
if width <= 0 || height <= 0 { exit(2) }
probe.start(URL(fileURLWithPath: arguments[1]), width: width, height: height)
application.run()
