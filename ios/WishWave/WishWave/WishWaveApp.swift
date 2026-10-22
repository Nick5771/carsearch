import SwiftUI
import WebKit
import SafariServices
import AuthenticationServices
import CryptoKit
import Security
import UserNotifications

@main
struct WishWaveApp: App {
    @UIApplicationDelegateAdaptor(WishWaveAppDelegate.self) private var appDelegate
    var body: some Scene {
        WindowGroup { ShoppingView().ignoresSafeArea(.container) }
    }
}

// UIApplication owns APNs registration; the web view supplies the signed-in account
// only when it registers the returned device token with the authenticated API.
final class WishWaveAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = WishWavePush.shared
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        WishWavePush.shared.registered(deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        WishWavePush.shared.failed(error)
    }
}

final class WishWavePush: NSObject, UNUserNotificationCenterDelegate {
    static let shared = WishWavePush()
    static let opened = Notification.Name("WishWavePushOpened")
    static let arrived = Notification.Name("WishWaveForegroundPushArrived")
    private var token: String?
    private var waiting: [([String: String]?, String?) -> Void] = []
    private var registrationTimeout: DispatchWorkItem?
    var pendingURL: URL?
    let installationID: String = {
        let key = "wishwave.push.installation"
        if let stored = UserDefaults.standard.string(forKey: key) { return stored }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: key)
        return id
    }()
    // Read the signing profile rather than guessing from Debug/Release: a Release
    // build installed from Xcode can still use a development provisioning profile.
    private var environment: String {
        if let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
           let bytes = try? Data(contentsOf: url),
           let text = String(data: bytes, encoding: .isoLatin1),
           let start = text.range(of: "<?xml"), let end = text.range(of: "</plist>"),
           let data = String(text[start.lowerBound..<end.upperBound]).data(using: .utf8),
           let plist = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any],
           let entitlements = plist["Entitlements"] as? [String: Any],
           let value = entitlements["aps-environment"] as? String {
            return value == "development" ? "sandbox" : "production"
        }
        // TestFlight / App Store builds do not embed the development profile.
        return "production"
    }
    func status(requestPermission: Bool, reply: @escaping ([String: String]?, String?) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            if settings.authorizationStatus == .notDetermined && requestPermission {
                center.requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
                    if let error = error { DispatchQueue.main.async { reply(nil, error.localizedDescription) }; return }
                    self.status(requestPermission: false, reply: reply)
                }
                return
            }
            DispatchQueue.main.async {
                let allowed = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
                guard allowed else {
                    reply(["permission": settings.authorizationStatus == .denied ? "denied" : "default", "installationId": self.installationID], nil)
                    return
                }
                self.waiting.append(reply)
                if let token = self.token { self.finish(token: token); return }
                guard self.registrationTimeout == nil else { return }
                UIApplication.shared.registerForRemoteNotifications()
                let timeout = DispatchWorkItem { self.finish(error: "Apple device registration timed out. Check your connection and try again.") }
                self.registrationTimeout = timeout
                DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
            }
        }
    }
    func registered(_ data: Data) {
        token = data.map { String(format: "%02x", $0) }.joined()
        finish(token: token)
    }
    func failed(_ error: Error) { finish(error: error.localizedDescription) }
    private func finish(token: String? = nil, error: String? = nil) {
        registrationTimeout?.cancel(); registrationTimeout = nil
        let callbacks = waiting; waiting.removeAll()
        let result = token.map { ["permission": "granted", "token": $0, "environment": environment, "installationId": installationID] }
        callbacks.forEach { $0(result, error) }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // iOS invokes willPresent only while the app is in the foreground, even
        // if applicationState is momentarily .inactive (e.g. scene transitions).
        // Never show a second iOS banner on top of WishWave's in-app notification.
        // When the app is actually backgrounded, iOS presents APNs normally,
        // without calling this foreground-only delegate method.
        DispatchQueue.main.async { NotificationCenter.default.post(name: Self.arrived, object: nil) }
        completionHandler([])
    }
    func pruneDeliveredFollowRequests(activeUsernames: Set<String>, reply: @escaping ([String: String]?, String?) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { delivered in
            let obsolete = delivered.filter { notice in
                let info = notice.request.content.userInfo
                guard info["type"] as? String == "follow_request",
                      let username = info["actor_username"] as? String,
                      !username.isEmpty else { return false }
                return !activeUsernames.contains(username.lowercased())
            }.map { $0.request.identifier }
            if !obsolete.isEmpty { center.removeDeliveredNotifications(withIdentifiers: obsolete) }
            DispatchQueue.main.async { reply(["removed": String(obsolete.count)], nil) }
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let raw = response.notification.request.content.userInfo["url"] as? String,
           let url = URL(string: raw), url.scheme == "https", ["findai.ai", "www.findai.ai"].contains(url.host ?? ""),
           url.path == "/findai-app.html", url.user == nil, url.password == nil {
            DispatchQueue.main.async {
                self.pendingURL = url
                NotificationCenter.default.post(name: Self.opened, object: nil)
            }
        }
        completionHandler()
    }
}

struct ShoppingView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> ShoppingController { ShoppingController() }
    func updateUIViewController(_ controller: ShoppingController, context: Context) {}
    static func dismantleUIViewController(_ controller: ShoppingController, coordinator: ()) {
        controller.webView.configuration.userContentController.removeScriptMessageHandler(forName: "findaiHaptic")
        controller.webView.configuration.userContentController.removeScriptMessageHandler(forName: "wishwaveShare", contentWorld: .page)
        controller.webView.configuration.userContentController.removeScriptMessageHandler(forName: "wishwaveAuth", contentWorld: .page)
        controller.webView.configuration.userContentController.removeScriptMessageHandler(forName: "wishwavePush", contentWorld: .page)
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
            source: "window.wishwaveNativeBuild = 353;",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Keep the camera preview beneath WishWave's own shutter controls.
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = false
        config.allowsAirPlayForMediaPlayback = false
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "findaiHaptic")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "wishwaveShare")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "wishwaveAuth")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "wishwavePush")
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
        NotificationCenter.default.addObserver(self, selector: #selector(openPendingPush), name: WishWavePush.opened, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(pushApplicationActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(pushArrived), name: WishWavePush.arrived, object: nil)
        reloadPage()
    }

    @objc private func pushApplicationActive() {
        guard trusted(webView.url) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new Event('wishwave-push-resume'))", completionHandler: nil)
    }
    @objc private func pushArrived() {
        guard didShowPage, trusted(webView.url) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new Event('wishwave-push-arrived'))", completionHandler: nil)
    }

    @objc private func openPendingPush() {
        guard didShowPage, let target = WishWavePush.shared.pendingURL else { return }
        WishWavePush.shared.pendingURL = nil

        // An APNs tap should navigate in the live WKWebView, not reload its
        // entire page and leave the user on Home after startup completes.
        let items = URLComponents(url: target, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let notification = items.first(where: { $0.name == "notifications" })?.value
        let legacyFollowRequest = items.contains(where: { $0.name == "settings" && $0.value == "follow-requests" })
        if let requested = notification ?? (legacyFollowRequest ? "social" : nil), trusted(webView.url) {
            let filter = ["all", "orders", "social"].contains(requested) ? requested : "all"
            let script = """
                (function() {
                  if (typeof window.wishwaveOpenNotificationTab !== 'function') return false;
                  window.wishwaveOpenNotificationTab();
                  if (typeof window.wishwaveFilterNotifications === 'function')
                    window.wishwaveFilterNotifications('\(filter)');
                  return true;
                })()
                """
            webView.evaluateJavaScript(script) { [weak self] result, error in
                if error == nil, (result as? Bool) == true { return }
                self?.loadPushDestination(target)
            }
            return
        }
        loadPushDestination(target)
    }

    private func loadPushDestination(_ target: URL) {
        guard var destination = URLComponents(url: target, resolvingAgainstBaseURL: false) else { return }
        var query = destination.queryItems ?? []
        for item in URLComponents(url: Self.home, resolvingAgainstBaseURL: false)?.queryItems ?? [] {
            if !query.contains(where: { $0.name == item.name }) { query.append(item) }
        }
        destination.queryItems = query
        if let url = destination.url { webView.load(URLRequest(url: url)) }
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
        openPendingPush()
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
        if message.name == "wishwavePush" {
            if data["action"] == "prune" {
                let raw = data["activeUsernames"] ?? "[]"
                guard let bytes = raw.data(using: .utf8),
                      let usernames = (try? JSONSerialization.jsonObject(with: bytes)) as? [String],
                      usernames.count <= 250 else { replyHandler(nil, "Invalid notification state"); return }
                let current = Set(usernames.map { $0.lowercased() })
                WishWavePush.shared.pruneDeliveredFollowRequests(activeUsernames: current) { value, error in replyHandler(value, error) }
                return
            }
            guard ["status", "request"].contains(data["action"] ?? "") else { replyHandler(nil, "Unknown notification action"); return }
            WishWavePush.shared.status(requestPermission: data["action"] == "request") { value, error in replyHandler(value, error) }
            return
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
