// Desktop Shark — macOS 셸.
//
// 게임은 전부 web/ 안의 HTML·Canvas·JS다. 이 파일이 하는 일은 그걸 얹을 창을 만드는 것뿐이다:
// 바탕화면을 덮는 투명 오버레이, 전역 단축키, 메뉴바 아이콘, 저장.
// 4구(../sneaky-billiards)의 셸과 골격이 같고, **다른 것은 밥 주는 방식이다.**
//
// **창은 마우스를 절대 안 받는다.** 밥 주기가 켜져 있어도 클릭은 전부 밑의 앱으로
// 간다 — 그래야 늘 켜 두고 일할 수 있다. 대신 전역 모니터로 클릭과 타자를
// **엿듣기만** 해서 밥을 떨어뜨린다. 누르던 버튼은 그대로 눌리고 치던 글자는 그대로
// 찍힌다. 패널을 열 때만 잠깐 마우스와 키보드를 받는다.
//
// **그리고 권한이 필요 없다.** 키를 읽는 것이 아니라 세기만 하기 때문이다 —
// CGEventSource 의 통계 카운터는 「keyDown 이 지금까지 몇 번 있었나」만 알려 주고
// 어떤 키였는지는 알려 주지 않는다. 손쉬운 사용 권한 없이도 읽힌다(확인함).
// 애초에 알 수가 없으므로, 「몇 번 쳤는지만 센다」는 말이 설명이 아니라 사실이다.

import AppKit
import Carbon.HIToolbox
import CoreGraphics
import WebKit

// MARK: - 상수

private enum Key {
    /// ⌥⇧S — 밥 주기 끄기/켜기. ⌥⇧ 는 macOS 심볼릭 핫키와 겹치지 않는 몇 안 되는 조합이다
    /// (⌃⌥Space 는 입력 소스 전환 id 61, ⌃Space 는 id 60 이 이미 쓴다).
    static let gameMode = (code: UInt32(kVK_ANSI_S), modifiers: UInt32(optionKey | shiftKey))
    /// ⌥⇧H — 숨기기/보이기.
    static let toggle = (code: UInt32(kVK_ANSI_H), modifiers: UInt32(optionKey | shiftKey))
    /// ⌥⇧R — 랭킹 패널.
    static let panel = (code: UInt32(kVK_ANSI_R), modifiers: UInt32(optionKey | shiftKey))
}

private let totalKey = "total"
private let grownKey = "grown"
private let frozenKey = "frozen"
private let pinnedKey = "pinnedStage"
private let lastFedKey = "lastFedAt"
private let playerIdKey = "playerId"
private let secretKey = "playerSecret"
private let nicknameKey = "nickname"
private let rankingKey = "rankingOn"
private let speciesKey = "species"

private let screenKey = "screenNumber"
private let webScheme = "shark"

/// 새 버전이 있는지 물어보는 곳. 태그를 밀면 CI 가 여기에 릴리스를 올린다.
private let releaseAPI = "https://api.github.com/repos/joowon-dev/desktop-shark/releases/latest"
private let releasePage = "https://github.com/joowon-dev/desktop-shark/releases/latest"
/// 자동 업데이트가 받아 가는 것은 zip 이다 — dmg 를 마운트해 자기를 갈아 끼우면 실패할 자리가 너무 많다.
private let macAssetSuffix = "-mac.zip"
private let updateCheckInterval: TimeInterval = 24 * 60 * 60
private let firstUpdateCheckDelay: TimeInterval = 20

/// "v1.2.0" > "1.10.0" 같은 걸 숫자로 비교한다. 문자열로 비교하면 1.10 이 1.9 보다 작다.
func isNewerVersion(_ candidate: String, than current: String) -> Bool {
    func parts(_ text: String) -> [Int] {
        text.trimmingCharacters(in: CharacterSet(charactersIn: "vV "))
            .split(separator: ".").map { Int($0.prefix(while: \.isNumber)) ?? 0 }
    }
    let a = parts(candidate), b = parts(current)
    for i in 0..<max(a.count, b.count) {
        let x = i < a.count ? a[i] : 0
        let y = i < b.count ? b[i] : 0
        if x != y { return x > y }
    }
    return false
}

// MARK: - 키보드를 받을 수 있는 오버레이 창

/// 테두리 없는 창은 기본적으로 키 윈도우가 못 된다 — 그대로 두면 패널에서 별명을
/// 한 글자도 못 친다. 평소에는 포커스를 절대 안 가져가고, **패널을 열 때만** 키가 된다.
final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// **첫 클릭을 삼키지 않는 웹뷰.**
///
/// AppKit 은 활성화되지 않은 앱의 창을 클릭하면 그 클릭을 「앱을 앞으로 부르는 클릭」으로
/// 쓰고 뷰에는 넘기지 않는다. 이 앱은 포커스를 절대 안 가져가므로 **모든 클릭이 첫
/// 클릭**이고, 그대로 두면 게임모드를 켜도 밥이 한 번도 안 떨어진다.
/// 4구는 클릭을 안 쓰고 수식키+핫키로만 조작해서 이 벽을 만난 적이 없다.
final class FirstMouseWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

// MARK: - 번들 안의 웹 파일을 넘겨주는 핸들러

/// file:// 로 열면 ES 모듈 import 가 막힌다. 커스텀 스킴으로 번들 Resources/web 아래
/// 파일을 그대로 내준다 — 포트를 여는 것보다 조용하다.
final class WebAssetHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) { self.root = root }

    private static let mimeTypes = [
        "html": "text/html", "js": "text/javascript", "css": "text/css",
        "json": "application/json", "png": "image/png",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let relative = url.path.isEmpty || url.path == "/" ? "/renderer/index.html" : url.path
        let file = root.appendingPathComponent(relative).standardized

        // 번들 밖으로 나가는 경로는 거절한다.
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let mime = Self.mimeTypes[file.pathExtension] ?? "application/octet-stream"
        let response = URLResponse(url: url, mimeType: mime,
                                   expectedContentLength: data.count, textEncodingName: "utf-8")
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// SHARK_DEBUG 가 켜져 있을 때만 stderr 로 흘린다.
func debugLog(_ text: String) {
    guard ProcessInfo.processInfo.environment["SHARK_DEBUG"] != nil else { return }
    FileHandle.standardError.write("[shark] \(text)\n".data(using: .utf8)!)
}

// MARK: - 앱

final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    private var window: OverlayWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private var hotKeys: [EventHotKeyRef?] = []

    /// 밥이 떨어지는 중인가. **기본이 켜짐이다** — 남이 화면을 볼 때만 끈다.
    /// 창이 클릭을 삼키지 않으므로 켜 둔 채로 일할 수 있다. 저장하지 않는다:
    /// 앱을 띄우면 늘 켜진 채로 시작한다.
    private var gameMode = true

    /// 입력 수를 들여다보는 타이머. 상태를 「물어보는」 것이라 권한이 필요 없다.
    private var inputTimer: Timer?
    private var lastKeys: UInt32 = 0
    private var lastClicks: UInt32 = 0
    /// 랭킹 패널이 열려 있는가. 열려 있는 동안만 창이 마우스를 받는다.
    private var panelOpen = false
    /// 별명을 치는 중인가. **이때만** 키보드를 가져온다 — 그 밖에는 다른 창에 그대로 쳐진다.
    private var holdingKeyboard = false

    /// 패널이 차지한 네모(창 안 좌표, 왼쪽 위 기준). 없으면 nil.
    /// **커서가 이 안에 있을 때만** 창이 클릭을 받는다.
    private var panelRect: NSRect?
    /// 지금 커서가 패널 위인가. 매 틱 계산해서 들고 있는다.
    private var cursorOverPanel = false
    /// 지금 클릭이 창을 통과하고 있는가. 매 프레임 창을 건드리지 않으려고 들고 있는다.
    private var passingThrough = true

    /// 메뉴바에 적을 것. 렌더러가 밀어 준다.
    private var statusText = "1단계 · 배부름"

    /// 새 버전이 있을 때만 채워진다. 없으면 메뉴에 아무 흔적도 없다.
    private var updateVersion: String?
    private var updateAsset: URL?
    private var updateNote: String?
    private var updating = false

    /// 전체 누적. 종을 여는 데 쓴다.
    private var total: Int {
        get { UserDefaults.standard.integer(forKey: totalKey) }
        set { UserDefaults.standard.set(newValue, forKey: totalKey) }
    }
    /// 종마다 따로 키운 점수. { "white": 1200, ... }
    ///
    /// **숫자가 아닌 값이 섞여 있어도 그것만 버린다.** `as? [String: Int]` 로 통째로
    /// 받으면 값 하나가 문자열이기만 해도 사전 전체가 nil 이 되어 키운 것이 다 날아간다.
    private var grown: [String: Int] {
        get {
            let raw = UserDefaults.standard.dictionary(forKey: grownKey) ?? [:]
            return raw.compactMapValues { ($0 as? NSNumber)?.intValue }
        }
        set { UserDefaults.standard.set(newValue, forKey: grownKey) }
    }
    /// 지금 종의 성장을 멈췄는가.
    private var frozen: Bool {
        get { UserDefaults.standard.bool(forKey: frozenKey) }
        set { UserDefaults.standard.set(newValue, forKey: frozenKey) }
    }
    /// 보여 줄 단계를 못 박았는가. 0 이면 「자동」.
    private var pinnedStage: Int {
        get { UserDefaults.standard.integer(forKey: pinnedKey) }
        set { UserDefaults.standard.set(newValue, forKey: pinnedKey) }
    }
    /// 마지막으로 먹인 시각 (ms). 0 이면 「한 번도 안 먹였다」.
    private var lastFedAt: Double {
        get { UserDefaults.standard.double(forKey: lastFedKey) }
        set { UserDefaults.standard.set(newValue, forKey: lastFedKey) }
    }
    private var playerId: String? {
        get { UserDefaults.standard.string(forKey: playerIdKey) }
        set { UserDefaults.standard.set(newValue, forKey: playerIdKey) }
    }
    private var secret: String? {
        get { UserDefaults.standard.string(forKey: secretKey) }
        set { UserDefaults.standard.set(newValue, forKey: secretKey) }
    }
    private var nickname: String? {
        get { UserDefaults.standard.string(forKey: nicknameKey) }
        set { UserDefaults.standard.set(newValue, forKey: nicknameKey) }
    }
    /// 지금 키우는 상어의 종.
    private var species: String {
        get { UserDefaults.standard.string(forKey: speciesKey) ?? "white" }
        set { UserDefaults.standard.set(newValue, forKey: speciesKey) }
    }
    /// 랭킹에 올릴 것인가. **밥 주기와 달리 이건 저장한다** — 「안 올린다」는 설정이다.
    /// 등록된 적이 없으면 기본은 켜짐.
    private var rankingOn: Bool {
        get { UserDefaults.standard.object(forKey: rankingKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: rankingKey) }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        buildStatusItem()
        registerHotKeys()
        startEavesdropping()
        scheduleUpdateChecks()

        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.moveToChosenScreen()
            self?.refreshMenu()
        }
    }

    // MARK: 창

    private func buildWindow() {
        let frame = chosenScreen().visibleFrame

        window = OverlayWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true // 마우스는 전부 밑의 앱으로
        window.level = .init(rawValue: Int(CGWindowLevelForKey(.screenSaverWindow)))
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        window.isReleasedWhenClosed = false

        let config = WKWebViewConfiguration()
        let web = Bundle.main.resourceURL!.appendingPathComponent("web")
        config.setURLSchemeHandler(WebAssetHandler(root: web), forURLScheme: webScheme)
        config.userContentController.add(self, name: "shark")
        config.userContentController.addUserScript(
            WKUserScript(source: bridgeScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        webView = FirstMouseWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        // 웹뷰 자체 배경을 지워야 창의 투명이 살아난다.
        webView.setValue(false, forKey: "drawsBackground")
        webView.load(URLRequest(url: URL(string: "\(webScheme)://app/renderer/index.html")!))

        window.contentView?.addSubview(webView)
        window.orderFrontRegardless() // 포커스는 가져가지 않는다
    }

    /// 저장한 것을 JS 값으로 만든다.
    ///
    /// **손으로 따옴표를 붙이지 않는다.** 별명에 따옴표나 역슬래시가 섞이면 스크립트가
    /// 통째로 깨지고 — 이건 문서 시작에 주입되므로 — window.sneaky 가 아예 안 만들어져
    /// 게임이 「브리지 없음」으로 조용히 떨어진다. 에러도 안 나고 핫키만 죽는다.
    private func stateJSON() -> String {
        var payload: [String: Any] = ["total": total, "grown": grown, "frozen": frozen]
        payload["pinnedStage"] = pinnedStage > 0 ? pinnedStage : NSNull()
        payload["lastFedAt"] = lastFedAt > 0 ? lastFedAt : NSNull()
        payload["playerId"] = playerId ?? NSNull()
        payload["secret"] = secret ?? NSNull()
        payload["nickname"] = nickname ?? NSNull()
        payload["ranking"] = rankingOn
        payload["species"] = species


        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return "{ total: 0, grown: {}, lastFedAt: null }"
        }
        return json
    }

    private func bridgeScript() -> String {
        return """
        window.sneaky = {
          getState: () => Promise.resolve(\(stateJSON())),
          saveState: (s) => window.webkit.messageHandlers.shark.postMessage({
            type: 'state', total: s && s.total, lastFedAt: s && s.lastFedAt,
          }),
          saveAccount: (a) => window.webkit.messageHandlers.shark.postMessage({
            type: 'account', playerId: a && a.playerId, secret: a && a.secret, nickname: a && a.nickname,
          }),
          setStatus: (s) => window.webkit.messageHandlers.shark.postMessage({
            type: 'status', stage: s && s.stage, hunger: s && s.hunger, eaten: s && s.eaten,
          }),
          onGameMode: (handler) => { window.__sharkGameMode = handler },
          onPanel: (handler) => { window.__sharkPanel = handler },
          onFeed: (handler) => { window.__sharkFeed = handler },
          onType: (handler) => { window.__sharkType = handler },
          onRanking: (handler) => { window.__sharkRanking = handler },
          saveRanking: (on) => window.webkit.messageHandlers.shark.postMessage({
            type: 'ranking', on: !!on,
          }),
          closePanel: () => window.webkit.messageHandlers.shark.postMessage({ type: 'closePanel' }),
          grabKeyboard: () => window.webkit.messageHandlers.shark.postMessage({ type: 'grabKeyboard' }),
          releaseKeyboard: () => window.webkit.messageHandlers.shark.postMessage({ type: 'releaseKeyboard' }),
          saveDex: (d) => window.webkit.messageHandlers.shark.postMessage({
            type: 'dex', species: d && d.species, grown: d && d.grown,
            frozen: !!(d && d.frozen), pinnedStage: (d && d.pinnedStage) || 0,
          }),
          setPanelRect: (r) => window.webkit.messageHandlers.shark.postMessage({
            type: 'panelRect',
            rect: r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null,
          }),
        }
        // 웹뷰는 콘솔이 안 보인다. 오류만이라도 셸의 stderr 로 흘려보낸다.
        window.addEventListener('error', (e) => window.webkit.messageHandlers.shark.postMessage({
          type: 'log', text: `${e.message} (${e.filename}:${e.lineno})`,
        }))
        console.error = (...args) => window.webkit.messageHandlers.shark.postMessage({
          type: 'log', text: args.join(' '),
        })
        """
    }

    // MARK: 업데이트
    //
    // **두 단계로 나눠 뒀다.** 1단계는 「새 버전이 있다」고 알리는 것뿐이고,
    // 2단계는 눌렀을 때 받아서 갈아 끼우는 것이다. 눌러야만 갈아 끼운다 —
    // 켜 두고 사는 앱이 혼자 다시 뜨면 상어가 사라진 것처럼 보인다.

    private var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    private func scheduleUpdateChecks() {
        Timer.scheduledTimer(withTimeInterval: firstUpdateCheckDelay, repeats: false) { [weak self] _ in
            self?.checkForUpdate()
        }
        Timer.scheduledTimer(withTimeInterval: updateCheckInterval, repeats: true) { [weak self] _ in
            self?.checkForUpdate()
        }
    }

    /// 하루 한 번 물어본다. 실패는 조용히 삼킨다 — 새 버전을 못 찾는 것과 상어가 안 도는 것은 다른 일이다.
    private func checkForUpdate() {
        guard var request = URL(string: releaseAPI).map({ URLRequest(url: $0) }) else { return }
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15

        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            guard let self, let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = json["tag_name"] as? String,
                  isNewerVersion(tag, than: self.currentVersion)
            else { return }

            let assets = json["assets"] as? [[String: Any]] ?? []
            let zip = assets.first { ($0["name"] as? String)?.hasSuffix(macAssetSuffix) == true }
            let url = (zip?["browser_download_url"] as? String).flatMap(URL.init(string:))

            DispatchQueue.main.async {
                debugLog("새 버전 \(tag)")
                self.updateVersion = tag
                self.updateAsset = url
                self.refreshMenu()
            }
        }.resume()
    }

    /// 2단계 — 받아서 갈아 끼운다. 어느 한 걸음이라도 어긋나면 **손대지 않고** 릴리스 페이지를 연다.
    @objc private func installUpdate() {
        guard !updating else { return }
        guard let asset = updateAsset else {
            openReleasePage()
            return
        }
        updating = true
        updateNote = "내려받는 중…"
        refreshMenu()

        URLSession.shared.downloadTask(with: asset) { [weak self] location, _, error in
            guard let self else { return }
            guard let location, error == nil else {
                DispatchQueue.main.async { self.updateFailed() }
                return
            }
            // 임시 파일은 이 블록이 끝나면 사라진다. 옆에 옮겨 두고 푼다.
            let work = FileManager.default.temporaryDirectory
                .appendingPathComponent("shark-update-\(UUID().uuidString)")
            let zip = work.appendingPathComponent("app.zip")
            do {
                try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
                try FileManager.default.moveItem(at: location, to: zip)
            } catch {
                DispatchQueue.main.async { self.updateFailed() }
                return
            }
            DispatchQueue.main.async { self.swapIn(zip: zip, work: work) }
        }.resume()
    }

    private func swapIn(zip: URL, work: URL) {
        updateNote = "설치하는 중…"
        refreshMenu()

        let unpacked = work.appendingPathComponent("unpacked")
        guard run("/usr/bin/ditto", ["-x", "-k", zip.path, unpacked.path]) == 0,
              let newApp = (try? FileManager.default.contentsOfDirectory(at: unpacked,
                                                                        includingPropertiesForKeys: nil))?
                  .first(where: { $0.pathExtension == "app" })
        else {
            updateFailed()
            return
        }

        // **받은 것이 애플이 검증한 우리 앱인지 본다.** 여기서 걸리면 갈아 끼우지 않는다 —
        // 남의 zip 을 받아 자기 자리에 넣는 일은 절대 없어야 한다.
        guard run("/usr/sbin/spctl", ["--assess", "--type", "execute", newApp.path]) == 0,
              let id = Bundle(url: newApp)?.bundleIdentifier, id == Bundle.main.bundleIdentifier
        else {
            debugLog("업데이트 검증 실패")
            updateFailed()
            return
        }

        let target = Bundle.main.bundleURL
        do {
            _ = try FileManager.default.replaceItemAt(target, withItemAt: newApp)
        } catch {
            // 대개 권한 문제다(/Applications 밖이거나 다른 사용자 소유).
            debugLog("바꿔 끼우기 실패 \(error)")
            updateFailed()
            return
        }

        // 새 것을 띄우고 지금 것은 물러난다. **키우던 상어는 UserDefaults 에 있어서
        // 번들을 갈아 끼워도 그대로다** — 새 앱이 같은 상어를 데리고 뜬다.
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: target, configuration: config) { _, _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    /// 못 했으면 **아무것도 건드리지 않고** 사람에게 넘긴다.
    private func updateFailed() {
        updating = false
        updateNote = "직접 받기"
        refreshMenu()
        openReleasePage()
    }

    private func openReleasePage() {
        if let url = URL(string: releasePage) { NSWorkspace.shared.open(url) }
    }

    @discardableResult
    private func run(_ path: String, _ args: [String]) -> Int32 {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: path)
        task.arguments = args
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        do { try task.run() } catch { return -1 }
        task.waitUntilExit()
        return task.terminationStatus
    }

    // MARK: 메뉴바

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        refreshStatusIcon()
        refreshMenu()
    }

    /// 밥이 떨어지는 중인지 한눈에. 켜져 있어도 일을 막지 않으므로 경고가 아니라 표시다.
    /// 꺼 두면 지느러미가 잠든 것처럼 흐려진다.
    private func refreshStatusIcon() {
        if let path = Bundle.main.path(forResource: "tray", ofType: "png"),
           let image = NSImage(contentsOfFile: path) {
            image.isTemplate = true
            statusItem.button?.image = image
            statusItem.button?.title = ""
            statusItem.button?.alphaValue = gameMode ? 1.0 : 0.4
        } else {
            statusItem.button?.image = nil
            statusItem.button?.title = gameMode ? "🦈" : "💤"
        }
    }

    private func refreshMenu() {
        let menu = NSMenu()

        let status = NSMenuItem(title: statusText, action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())

        // 1단계 — 새 버전이 있을 때만 낸다. 없으면 메뉴에 아무 흔적도 없다.
        if let updateVersion {
            let item = NSMenuItem(title: updateNote ?? "새 버전 \(updateVersion) 설치",
                                  action: #selector(installUpdate), keyEquivalent: "")
            item.target = self
            item.isEnabled = !updating
            menu.addItem(item)
            menu.addItem(.separator())
        }

        let mode = NSMenuItem(title: gameMode ? "밥 주기 멈추기  ⌥⇧S" : "밥 주기 다시  ⌥⇧S",
                              action: #selector(toggleGameMode), keyEquivalent: "")
        mode.target = self
        mode.state = gameMode ? .on : .off
        menu.addItem(mode)

        let panel = NSMenuItem(title: "랭킹 · 계정  ⌥⇧R", action: #selector(togglePanel), keyEquivalent: "")
        panel.target = self
        menu.addItem(panel)

        let ranking = NSMenuItem(title: "랭킹에 올리기", action: #selector(toggleRanking), keyEquivalent: "")
        ranking.target = self
        ranking.state = rankingOn ? .on : .off
        menu.addItem(ranking)

        if NSScreen.screens.count > 1 { menu.addItem(screenMenu()) }
        menu.addItem(.separator())

        let reset = NSMenuItem(title: "이 기기의 상어 놓아주기…", action: #selector(resetShark), keyEquivalent: "")
        reset.target = self
        menu.addItem(reset)
        menu.addItem(.separator())

        let toggle = NSMenuItem(title: "숨기기 / 보이기  ⌥⇧H", action: #selector(toggleWindow), keyEquivalent: "")
        toggle.target = self
        menu.addItem(toggle)

        menu.addItem(NSMenuItem(title: "종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu
    }

    /// 키우던 상어를 놓아준다. **되돌릴 수 없어서 물어본다** — 랭킹에 올린 기록은 서버에
    /// 남고, 복구 코드를 다시 넣으면 그 상어로 돌아온다.
    @objc private func resetShark() {
        let alert = NSAlert()
        alert.messageText = "상어를 놓아줄까요?"
        alert.informativeText = """
        이 기기에서 키운 기록과 **열어 둔 종**이 사라지고 아기 백상아리부터 다시 시작합니다.
        랭킹 기록은 서버에 남고, 복구 코드를 다시 넣으면 돌아옵니다.
        """
        alert.addButton(withTitle: "놓아주기")
        alert.addButton(withTitle: "그만두기")
        alert.alertStyle = .warning

        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        total = 0
        grown = [:]
        frozen = false
        pinnedStage = 0
        lastFedAt = 0
        species = "white"
        webView.reload()
        refreshMenu()
    }

    private func screenMenu() -> NSMenuItem {
        let submenu = NSMenu()
        let current = chosenScreen()
        for (index, screen) in NSScreen.screens.enumerated() {
            let size = screen.frame.size
            let main = screen.frame.origin == .zero ? " (주 화면)" : ""
            let title = "\(index + 1)번  \(Int(size.width))×\(Int(size.height))\(main)"
            let item = NSMenuItem(title: title, action: #selector(pickScreen(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = Self.number(of: screen)
            item.state = screen == current ? .on : .off
            submenu.addItem(item)
        }
        let root = NSMenuItem(title: "모니터", action: nil, keyEquivalent: "")
        root.submenu = submenu
        return root
    }

    @objc private func pickScreen(_ sender: NSMenuItem) {
        guard let number = sender.representedObject as? Int else { return }
        UserDefaults.standard.set(number, forKey: screenKey)
        moveToChosenScreen()
        refreshMenu()
    }

    /// 저장해 둔 화면. 그 화면이 사라졌으면 주 화면으로 돌아간다.
    private func chosenScreen() -> NSScreen {
        let saved = UserDefaults.standard.object(forKey: screenKey) as? Int
        return NSScreen.screens.first { Self.number(of: $0) == saved } ?? Self.primaryScreen
    }

    private func moveToChosenScreen() {
        window.setFrame(chosenScreen().visibleFrame, display: true)
    }

    // MARK: 엿듣기 — 클릭과 타자를 밥으로

    /**
     지금까지 키를 몇 번 눌렀나. **어떤 키였는지는 안 준다 — 알 수가 없다.**

     `CGEventSource` 의 통계 카운터다. 이벤트를 받아 보는 것이 아니라 「몇 번 있었나」를
     물어보는 것이라 **손쉬운 사용 권한이 필요 없다**(권한 없는 번들로 확인했다).
     예전에는 `addGlobalMonitorForEvents` 로 keyDown 을 받아 봤는데, 그건 키를 삼키지는
     않아도 **읽을 수는 있어서** 권한을 받아야 했다. 셀 수만 있으면 되는 일에 읽을 수
     있는 길을 여는 것은 과했다.
     */
    private func keyCount() -> UInt32 {
        CGEventSource.counterForEventType(.combinedSessionState, eventType: .keyDown)
    }

    private func clickCount() -> UInt32 {
        CGEventSource.counterForEventType(.combinedSessionState, eventType: .leftMouseDown)
            &+ CGEventSource.counterForEventType(.combinedSessionState, eventType: .rightMouseDown)
    }

    private func startEavesdropping() {
        lastKeys = keyCount()
        lastClicks = clickCount()

        // 60 번쯤 보면 클릭한 자리와 실제 커서 자리가 눈에 띄게 어긋나지 않는다.
        inputTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            self?.pollInput()
        }
        debugLog("엿듣기 시작 (권한 불필요) 키=\(lastKeys) 클릭=\(lastClicks)")
    }

    private func pollInput() {
        updateCursorOverPanel()

        let keys = keyCount()
        let clicks = clickCount()

        // 밥을 안 주는 동안에도 숫자는 흐른다. 따라만 두지 않으면 다시 켤 때
        // 그동안 친 것이 한꺼번에 쏟아진다.
        // **패널 위에서 누른 것만 빼고** 나머지는 그대로 밥이 된다 — 패널을 열어 뒀다고
        // 밥 주기가 멈추면 랭킹을 보는 동안 상어가 굶는다.
        guard gameMode, window.isVisible, !cursorOverPanel else {
            lastKeys = keys
            lastClicks = clicks
            return
        }

        if clicks != lastClicks {
            // 위치는 커서에게 물어본다 — 이것도 권한이 필요 없다.
            heardClick(at: NSEvent.mouseLocation)
        }
        if keys != lastKeys {
            // **몇 번 쳤든 한 번만 알린다.** 게임 쪽에서 어차피 간격으로 걸러낸다.
            heardTyping()
        }

        lastKeys = keys
        lastClicks = clicks
    }

    /// 커서가 패널 네모 안에 있는지 보고, 그때만 창이 마우스를 받게 한다.
    private func updateCursorOverPanel() {
        let inside: Bool
        if panelOpen, let rect = panelRect, window.isVisible {
            let frame = window.frame
            let cursor = NSEvent.mouseLocation
            // 화면 좌표(왼쪽 아래 기준) → 창 안 좌표(왼쪽 위 기준)
            let local = NSPoint(x: cursor.x - frame.minX, y: frame.maxY - cursor.y)
            inside = NSPointInRect(local, rect)
        } else {
            inside = false
        }

        guard inside != cursorOverPanel else { return }
        cursorOverPanel = inside
        updateMousePass()
    }

    /// 커서 위치는 **화면 좌표**이고 원점이 왼쪽 아래다.
    /// 웹뷰는 창 안의 왼쪽 위 기준이라 두 번 옮겨야 한다.
    ///
    /// **어느 모니터에서 눌렀든 밥이 된다.** 상어가 얹힌 화면 밖을 누르면 좌표가
    /// 음수이거나 화면보다 크게 나오는데, 엔진이 가장자리로 끌어당겨 준다
    /// (dropFood → clampFood). 예전에는 여기서 걸러 내서, 듀얼 모니터의 다른 쪽에서는
    /// 아무리 눌러도 밥이 안 떨어졌다 — 타자는 되는데 클릭만 안 됐다.
    private func heardClick(at screenPoint: NSPoint) {
        let frame = window.frame
        let x = screenPoint.x - frame.minX
        let y = frame.maxY - screenPoint.y   // 위아래를 뒤집는다

        webView.evaluateJavaScript("window.__sharkFeed && window.__sharkFeed(\(x), \(y))")
    }

    private func heardTyping() {
        // 어디를 쳤는지는 알 수 없고 알 것도 없다 — 자리는 게임이 정한다.
        webView.evaluateJavaScript("window.__sharkType && window.__sharkType()")
    }

    // MARK: 입력

    private func registerHotKeys() {
        var handler: EventHandlerRef?
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))

        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ -> OSStatus in
            var id = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
            App.shared?.hotKeyPressed(id.id)
            return noErr
        }, 1, &spec, nil, &handler)

        // **등록이 status=0 으로 성공해도 시스템이 먼저 가로챌 수 있다.** 성공은 검증이 아니다.
        for (index, key) in [Key.gameMode, Key.toggle, Key.panel].enumerated() {
            var ref: EventHotKeyRef?
            let id = EventHotKeyID(signature: OSType(0x5348524b), id: UInt32(index)) // 'SHRK'
            let status = RegisterEventHotKey(key.code, key.modifiers, id, GetApplicationEventTarget(), 0, &ref)
            debugLog("핫키 \(index) status=\(status)")
            hotKeys.append(ref)
        }
    }

    fileprivate func hotKeyPressed(_ id: UInt32) {
        debugLog("hotkey \(id)")
        switch id {
        case 0: toggleGameMode()
        case 1: toggleWindow()
        default: togglePanel()
        }
    }

    @objc private func toggleGameMode() {
        guard window.isVisible else { return }
        setGameMode(!gameMode)
    }

    private func setGameMode(_ on: Bool) {
        gameMode = on
        if !on { setPanel(false) }
        webView.evaluateJavaScript("window.__sharkGameMode && window.__sharkGameMode(\(on))")
        refreshStatusIcon()
        refreshMenu()
    }

    /// 랭킹을 켜고 끈다. 끄면 아무것도 서버로 안 보낸다 — 상어는 그대로 자란다.
    @objc private func toggleRanking() {
        rankingOn = !rankingOn
        webView.evaluateJavaScript("window.__sharkRanking && window.__sharkRanking(\(rankingOn))")
        refreshMenu()
    }

    @objc private func togglePanel() {
        guard window.isVisible else { return }
        setPanel(!panelOpen)
    }

    private func setPanel(_ open: Bool) {
        guard open != panelOpen else { return }
        panelOpen = open
        webView.evaluateJavaScript("window.__sharkPanel && window.__sharkPanel(\(open))")

        // **패널을 열어도 키보드는 안 가져간다.**
        //
        // 예전에는 열자마자 앱을 활성화했는데, 그러면 패널을 띄워 둔 채로 다른 창에
        // 한 글자도 못 친다 — 랭킹을 보면서 일할 수가 없다. 지금은 **마우스만** 받고
        // (버튼을 눌러야 하니까), 키보드는 별명 칸을 실제로 눌렀을 때만 가져온다.
        if !open {
            panelRect = nil
            cursorOverPanel = false
            releaseKeyboard()
        }
        updateMousePass()
    }

    /// **창이 마우스를 받는 것은 커서가 패널 네모 위에 있을 때뿐이다.**
    ///
    /// 패널이 열렸다고 화면 전체가 클릭을 받으면 다른 창을 아예 못 누르고, 누르지
    /// 못하니 포커스도 못 옮겨 타자도 안 된다. 창은 하나이므로 **커서 자리로 가른다.**
    private func updateMousePass() {
        let wantPass = !cursorOverPanel
        guard wantPass != passingThrough else { return }
        passingThrough = wantPass
        window.ignoresMouseEvents = wantPass
        debugLog("pass \(wantPass)")
    }

    /// 별명 칸을 눌렀다. 이제서야 키보드를 가져온다.
    private func grabKeyboard() {
        guard !holdingKeyboard else { return }
        holdingKeyboard = true
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        debugLog("키보드 가져옴")
    }

    /// 별명 칸에서 손을 뗐거나 패널을 닫았다. 쓰던 앱으로 돌려준다.
    private func releaseKeyboard() {
        guard holdingKeyboard else { return }
        holdingKeyboard = false
        NSApp.deactivate()
        debugLog("키보드 돌려줌")
    }

    @objc private func toggleWindow() {
        if window.isVisible {
            // **안 보이는 창이 클릭을 먹는 상태를 만들지 않는다.** 패널부터 닫는다.
            setPanel(false)
            window.orderOut(nil)
        } else {
            window.orderFrontRegardless()
        }
        refreshStatusIcon()
        refreshMenu()
    }

    // MARK: 저장

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }

        switch body["type"] as? String {
        case "log":
            if let text = body["text"] as? String {
                FileHandle.standardError.write("[web] \(text)\n".data(using: .utf8)!)
            }

        case "state":
            if let value = body["total"] as? Int { total = value }
            if let value = body["lastFedAt"] as? Double { lastFedAt = value }

        case "account":
            playerId = body["playerId"] as? String
            secret = body["secret"] as? String
            nickname = body["nickname"] as? String

        case "ranking":
            rankingOn = body["on"] as? Bool ?? true
            refreshMenu()

        case "closePanel":
            setPanel(false)

        case "panelRect":
            if let r = body["rect"] as? [String: Any],
               let x = r["x"] as? Double, let y = r["y"] as? Double,
               let w = r["w"] as? Double, let h = r["h"] as? Double {
                panelRect = NSRect(x: x, y: y, width: w, height: h)
            } else {
                panelRect = nil
            }

        case "grabKeyboard":
            grabKeyboard()

        case "releaseKeyboard":
            releaseKeyboard()

        case "dex":
            if let value = body["species"] as? String { species = value }
            if let map = body["grown"] as? [String: Int] { grown = map }
            frozen = body["frozen"] as? Bool ?? false
            pinnedStage = body["pinnedStage"] as? Int ?? 0
            refreshMenu()

        case "status":
            let stage = body["stage"] as? Int ?? 1
            let hunger = body["hunger"] as? String ?? ""
            let count = body["eaten"] as? Int ?? 0
            statusText = "\(stage)단계 · \(hunger) · \(count)개 먹임"
            refreshMenu()

        default:
            break
        }
    }

    /// NSScreen.main 은 "키 윈도우가 있는 화면"이라 포커스를 안 갖는 이 앱에서는 엉뚱한
    /// 모니터를 집는다 — 전역 좌표 원점인 쪽이 주 화면이다.
    static func number(of screen: NSScreen) -> Int {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? -1
    }

    static var primaryScreen: NSScreen {
        NSScreen.screens.first { $0.frame.origin == .zero } ?? NSScreen.screens.first ?? NSScreen.main!
    }

    static var shared: App?
}

// MARK: - 시작

let app = NSApplication.shared
let delegate = App()
App.shared = delegate
app.delegate = delegate
// Dock 아이콘도 메뉴도 없다. 조작 창구는 메뉴바뿐 (Info.plist 의 LSUIElement 와 같은 뜻).
app.setActivationPolicy(.accessory)
app.run()
