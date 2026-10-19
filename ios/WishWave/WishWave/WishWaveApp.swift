import SwiftUI
import WebKit
import SafariServices
import AuthenticationServices
import CryptoKit
import Security

@main
struct WishWaveApp: App {
    var body: some Scene {
        WindowGroup { ShoppingView().ignoresSafeArea(.container) }
    }
}

struct ShoppingView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> ShoppingController { ShoppingController() }
    func updateUIViewController(_ controller: ShoppingController, context: Context) {}
    static func dismantleUIViewController(_ controller: ShoppingController, coordinator: ()) {
        controller.webView.configuration.userContentController.removeScriptMessageHandler(forName: "findaiHaptic")
        controller.webView.configuration.userContentController.removeScriptMessageHandler(forName: "wishwaveShare", contentWorld: .page)
        controller.webView.configuration.userContentController.removeScriptMessageHandler(forName: "wishwaveAuth", contentWorld: .page)
        controller.cancelAuthentication()
        controller.webView.stopLoading()
        controller.cancelRecovery()
    }
}

final class ShoppingController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply, ASWebAuthenticationPresentationContextProviding {
    private static let home = URL(string: "https://findai.ai/findai-app.html?country=US&catalogue-test=1&treasure-test=1")!
    private let selectionFeedback = UISelectionFeedbackGenerator()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let failure = UIStackView()
    private var didShowPage = false
    private var recoveryWork: DispatchWorkItem?
    private var recoveryWindowStart = Date.distantPast
    private var recoveryAttempts = 0
    private(set) lazy var webView: WKWebView = {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.addUserScript(WKUserScript(
            source: "window.wishwaveNativeBuild = 316;",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Keep the camera preview beneath WishWave's own shutter controls.
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = false
        config.allowsAirPlayForMediaPlayback = false
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "findaiHaptic")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "wishwaveShare")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "wishwaveAuth")
        config.userContentController.addUserScript(WKUserScript(source: """
        if (location.protocol === 'https:' && ['findai.ai','www.findai.ai'].includes(location.hostname) && !navigator.share) {
          Object.defineProperty(navigator, 'share', {value: async function(data) {
            const result = await window.webkit.messageHandlers.wishwaveShare.postMessage({title:String(data.title||''),text:String(data.text||''),url:String(data.url||'')});
            if (!result) throw new DOMException('Share cancelled', 'AbortError');
          }});
        }
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.isOpaque = false
        web.backgroundColor = .systemBackground
        // WishWave already owns edge-swipe and in-app back gestures.
        web.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        return web
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = true
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        failure.axis = .vertical
        failure.spacing = 16
        failure.alignment = .center
        failure.translatesAutoresizingMaskIntoConstraints = false
        let message = UILabel()
        message.text = "Couldn't load WishWave. Check your connection and try again."
        message.numberOfLines = 0
        message.textAlignment = .center
        let retry = UIButton(type: .system)
        retry.setTitle("Try again", for: .normal)
        retry.addTarget(self, action: #selector(reloadPage), for: .touchUpInside)
        failure.addArrangedSubview(message)
        failure.addArrangedSubview(retry)
        view.addSubview(failure)
        NSLayoutConstraint.activate([
            failure.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            failure.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            failure.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, multiplier: 0.8)
        ])
        failure.isHidden = true
        selectionFeedback.prepare()
        reloadPage()
    }

    @objc private func reloadPage() {
        cancelRecovery()
        recoveryAttempts = 0
        loadHome()
    }

    func cancelAuthentication() {
        authSession?.cancel()
        authSession = nil
    }

    func cancelRecovery() {
        recoveryWork?.cancel()
        recoveryWork = nil
    }

    private func loadHome() {
        failure.isHidden = true
        webView.isHidden = false
        spinner.startAnimating()
        webView.load(URLRequest(url: Self.home))
    }

    private func trusted(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        return url.scheme == "https" && ["findai.ai", "www.findai.ai"].contains(url.host ?? "")
    }

    private func showFailure(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        spinner.stopAnimating()
        // Preserve a working page if only a later navigation fails.
        if !didShowPage { webView.isHidden = true; failure.isHidden = false }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        didShowPage = true
        spinner.stopAnimating()
        failure.isHidden = true
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showFailure(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showFailure(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // A terminated WebKit process is not a connection failure. Recover the
        // hosted app, whose feed/login storage survives in the website data store.
        // Stop after two attempts in a minute so repeated crashes cannot loop.
        NSLog("WishWave: WebKit content process terminated")
        cancelRecovery()
        didShowPage = false
        if Date().timeIntervalSince(recoveryWindowStart) > 60 {
            recoveryWindowStart = Date()
            recoveryAttempts = 0
        }
        guard recoveryAttempts < 2 else {
            webView.isHidden = true
            spinner.stopAnimating()
            failure.isHidden = false
            return
        }
        recoveryAttempts += 1
        failure.isHidden = true
        spinner.startAnimating()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.recoveryWork = nil
            self.loadHome()
        }
        recoveryWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if trusted(url) {
            if action.targetFrame == nil { webView.load(action.request); decisionHandler(.cancel) }
            else { decisionHandler(.allow) }
            return
        }
        decisionHandler(.cancel)
        if ["https", "http"].contains(url.scheme ?? "") {
            guard presentedViewController == nil else { return }
            present(SFSafariViewController(url: url), animated: true)
        } else if ["mailto", "tel"].contains(url.scheme ?? ""), action.navigationType == .linkActivated {
            UIApplication.shared.open(url)
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url), message.name == "findaiHaptic" else { return }
        if message.body as? String == "prepare" { selectionFeedback.prepare(); return }
        selectionFeedback.selectionChanged()
        selectionFeedback.prepare()
    }

    // Safari authentication owns provider cookies; only a short-lived ticket
    // returns to this controller. The verifier never leaves the native process
    // except in the HTTPS redemption request.
    private var authSession: ASWebAuthenticationSession?

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return view.window ?? ASPresentationAnchor()
    }

    private func startAuthentication(provider: String, reply: @escaping (Any?, String?) -> Void) {
        guard ["apple", "google"].contains(provider), authSession == nil, presentedViewController == nil else {
            reply(nil, "Another sign-in or sheet is already open."); return
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            reply(nil, "Could not start secure sign-in. Please try again."); return
        }
        func base64URL(_ data: Data) -> String {
            data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        }
        let verifier = base64URL(Data(bytes))
        let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        var start = URLComponents(string: "https://api.carsearchapi.workers.dev/auth/native/start")!
        start.queryItems = [URLQueryItem(name: "provider", value: provider), URLQueryItem(name: "challenge", value: challenge)]
        let session = ASWebAuthenticationSession(url: start.url!, callbackURLScheme: "com.nickfiani.wishwave") { [weak self] callback, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.authSession = nil
                if let error = error {
                    let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    reply(nil, cancelled ? "Sign-in was cancelled." : "Could not complete sign-in. Please try again.")
                    return
                }
                guard let callback = callback, callback.scheme == "com.nickfiani.wishwave", callback.host == "auth",
                      let components = URLComponents(url: callback, resolvingAgainstBaseURL: false) else {
                    reply(nil, "Invalid sign-in response."); return
                }
                let values = components.queryItems ?? []
                guard values.first(where: { $0.name == "provider" })?.value == provider else {
                    reply(nil, "Invalid sign-in provider."); return
                }
                if let failure = values.first(where: { $0.name == "error" })?.value {
                    reply(nil, failure == "not_configured" ? "This sign-in provider needs server setup. Please use email for now." : failure == "cancelled" ? "Sign-in was cancelled." : "Sign-in could not be completed. Please try again.")
                    return
                }
                guard let ticket = values.first(where: { $0.name == "ticket" })?.value, ticket.count == 64 else {
                    reply(nil, "Sign-in response was incomplete."); return
                }
                var request = URLRequest(url: URL(string: "https://api.carsearchapi.workers.dev/auth/native/complete")!)
                request.httpMethod = "POST"
                request.timeoutInterval = 20
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try? JSONSerialization.data(withJSONObject: ["ticket": ticket, "verifier": verifier])
                URLSession.shared.dataTask(with: request) { data, response, error in
                    let result = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                    DispatchQueue.main.async {
                        guard error == nil, (response as? HTTPURLResponse)?.statusCode == 200,
                              let result = result, result["provider"] as? String == provider,
                              result["session"] is String, result["email"] is String else {
                            reply(nil, "Sign-in expired or the connection failed. Please try again."); return
                        }
                        reply(result, nil)
                    }
                }.resume()
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = true
        authSession = session
        if !session.start() {
            authSession = nil
            reply(nil, "Could not open sign-in. Please try again.")
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url), let data = message.body as? [String: String], presentedViewController == nil else {
            replyHandler(nil, "Share is unavailable"); return
        }
        if message.name == "wishwaveAuth" {
            startAuthentication(provider: data["provider"] ?? "", reply: replyHandler)
            return
        }
        guard message.name == "wishwaveShare" else { replyHandler(nil, "Unknown action"); return }
        var items: [Any] = []
        if let text = data["text"], !text.isEmpty { items.append(String(text.prefix(10000))) }
        else if let title = data["title"], !title.isEmpty { items.append(String(title.prefix(500))) }
        if let raw = data["url"], !raw.isEmpty {
            guard let url = URL(string: raw), url.scheme == "https" else { replyHandler(nil, "Invalid share URL"); return }
            items.append(url)
        }
        guard !items.isEmpty else { replyHandler(nil, "Nothing to share"); return }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        sheet.completionWithItemsHandler = { _, completed, _, error in
            if let error = error { replyHandler(nil, error.localizedDescription) }
            else { replyHandler(completed, nil) }
        }
        present(sheet, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "WishWave", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "WishWave", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}
