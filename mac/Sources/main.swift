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
// 전역 모니터는 키를 **삼키지 않는다** — 삼켜야 하는 것(핫키)과 삼키면 안 되는 것
// (엿듣기)은 애초에 다른 API 다. 다만 손쉬운 사용 권한이 필요하다.

import AppKit
import ApplicationServices
import Carbon.HIToolbox
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

private let eatenKey = "eaten"
private let lastFedKey = "lastFedAt"
private let playerIdKey = "playerId"
private let secretKey = "playerSecret"
private let nicknameKey = "nickname"
private let rankingKey = "rankingOn"
private let screenKey = "screenNumber"
private let webScheme = "shark"

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

    /// 전역으로 클릭·타자를 엿듣는 모니터. 권한이 없으면 nil 인 채로 남는다.
    private var clickMonitor: Any?
    private var keyMonitor: Any?
    /// 랭킹 패널이 열려 있는가. 열려 있는 동안만 창이 키보드를 받는다.
    private var panelOpen = false
    /// 지금 클릭이 창을 통과하고 있는가. 매 프레임 창을 건드리지 않으려고 들고 있는다.
    private var passingThrough = true

    /// 메뉴바에 적을 것. 렌더러가 밀어 준다.
    private var statusText = "1단계 · 배부름"

    private var eaten: Int {
        get { UserDefaults.standard.integer(forKey: eatenKey) }
        set { UserDefaults.standard.set(newValue, forKey: eatenKey) }
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
        var payload: [String: Any] = ["eaten": eaten]
        payload["lastFedAt"] = lastFedAt > 0 ? lastFedAt : NSNull()
        payload["playerId"] = playerId ?? NSNull()
        payload["secret"] = secret ?? NSNull()
        payload["nickname"] = nickname ?? NSNull()
        payload["ranking"] = rankingOn

        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return "{ eaten: 0, lastFedAt: null }"
        }
        return json
    }

    private func bridgeScript() -> String {
        return """
        window.sneaky = {
          getState: () => Promise.resolve(\(stateJSON())),
          saveState: (s) => window.webkit.messageHandlers.shark.postMessage({
            type: 'state', eaten: s && s.eaten, lastFedAt: s && s.lastFedAt,
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

        let mode = NSMenuItem(title: gameMode ? "밥 주기 멈추기  ⌥⇧S" : "밥 주기 다시  ⌥⇧S",
                              action: #selector(toggleGameMode), keyEquivalent: "")
        mode.target = self
        mode.state = gameMode ? .on : .off
        menu.addItem(mode)

        // 권한이 없으면 클릭은 밥이 되는데 타자만 조용히 안 된다. 그 조용함을 여기서 깬다.
        if !trusted {
            let permission = NSMenuItem(title: "⚠︎ 타자가 밥이 되려면 권한이 필요합니다…",
                                        action: #selector(askForAccessibility), keyEquivalent: "")
            permission.target = self
            menu.addItem(permission)
        }

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
        이 기기에서 키운 기록이 사라지고 아기상어부터 다시 시작합니다.
        랭킹 기록은 서버에 남고, 복구 코드를 다시 넣으면 돌아옵니다.
        """
        alert.addButton(withTitle: "놓아주기")
        alert.addButton(withTitle: "그만두기")
        alert.alertStyle = .warning

        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        eaten = 0
        lastFedAt = 0
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

    /// 손쉬운 사용 권한이 있는가. 전역 키 모니터는 이것 없이는 **조용히 아무것도 안 준다** —
    /// 에러도 안 나고 콜백만 영영 안 불린다. 그래서 물어보고 상태를 들고 있는다.
    private var trusted: Bool { AXIsProcessTrusted() }

    /// 권한을 물어본 적이 있는가. 띄울 때마다 창을 띄우면 성가시다.
    private let askedKey = "askedForAccessibility"

    /**
     클릭과 타자를 전역으로 엿듣는다.

     **삼키지 않는다.** `addGlobalMonitorForEvents` 는 남의 앱으로 가는 이벤트를
     구경만 시켜 준다 — 누르던 버튼은 그대로 눌리고 치던 글자는 그대로 찍힌다.
     키를 삼키는 것(전역 핫키)과는 아예 다른 API 다.

     마우스는 권한 없이도 오는 경우가 있지만 키는 반드시 손쉬운 사용 권한이 있어야 한다.
     */
    private func startEavesdropping() {
        clickMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        ) { [weak self] event in
            self?.heardClick(at: event.locationInWindow)
        }

        keyMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown]) { [weak self] _ in
            self?.heardTyping()
        }

        debugLog("엿듣기 시작 trusted=\(trusted)")
        if !trusted && !UserDefaults.standard.bool(forKey: askedKey) {
            UserDefaults.standard.set(true, forKey: askedKey)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                self?.askForAccessibility()
            }
        }
        refreshMenu()
    }

    /// 전역 마우스 이벤트의 좌표는 **화면 좌표**이고 원점이 왼쪽 아래다.
    /// 웹뷰는 창 안의 왼쪽 위 기준이라 두 번 옮겨야 한다.
    private func heardClick(at screenPoint: NSPoint) {
        guard gameMode, window.isVisible, !panelOpen else { return }

        let frame = window.frame
        guard NSPointInRect(screenPoint, frame) else { return }

        let x = screenPoint.x - frame.minX
        let y = frame.maxY - screenPoint.y   // 위아래를 뒤집는다

        webView.evaluateJavaScript("window.__sharkFeed && window.__sharkFeed(\(x), \(y))")
    }

    private func heardTyping() {
        guard gameMode, window.isVisible, !panelOpen else { return }
        // 어디를 쳤는지는 알 수 없고 알 것도 없다 — 자리는 게임이 정한다.
        webView.evaluateJavaScript("window.__sharkType && window.__sharkType()")
    }

    /// 권한 없이는 타자가 밥이 안 된다. 한 번만 물어보고, 뒤로는 메뉴에서 열 수 있다.
    @objc private func askForAccessibility() {
        let alert = NSAlert()
        alert.messageText = "타자를 밥으로 바꾸려면 권한이 필요합니다"
        alert.informativeText = """
        「손쉬운 사용」에 이 앱을 넣어 주세요. 키를 **엿듣기만** 하고 가로채지 않습니다 —
        치던 글자는 그대로 찍히고, 어떤 키를 눌렀는지는 게임에 전달되지 않습니다
        (몇 번 쳤는지만 셉니다).

        허용한 뒤에는 앱을 한 번 껐다 켜야 합니다.
        """
        alert.addButton(withTitle: "설정 열기")
        alert.addButton(withTitle: "나중에")
        alert.alertStyle = .informational

        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let url = URL(string:
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
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

        // 패널은 눌러야 하고 별명은 쳐야 한다. **패널을 열 때만** 마우스와 포커스를
        // 가져가고, 닫으면 곧장 쓰던 앱으로 돌려준다. 그 밖에는 클릭이 늘 통과한다.
        updateMousePass()
        if open {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
        } else {
            NSApp.deactivate()
        }
    }

    /// **창이 마우스를 받는 것은 패널이 열렸을 때뿐이다.**
    ///
    /// 밥 주기가 켜져 있어도 클릭은 전부 밑의 앱으로 간다 — 늘 켜 두고 일해야 하므로
    /// 창이 클릭을 삼키면 안 된다. 밥은 전역 모니터가 엿들어서 떨어뜨린다.
    private func updateMousePass() {
        let wantPass = !panelOpen
        guard wantPass != passingThrough else { return }
        passingThrough = wantPass
        window.ignoresMouseEvents = wantPass
        debugLog("pass \(wantPass)")
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
            if let value = body["eaten"] as? Int { eaten = value }
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
