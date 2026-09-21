// 바탕화면 상어 — Windows 셸.
//
// 게임은 전부 web\ 안의 HTML·Canvas·JS다. 이 파일은 그걸 얹을 창만 만든다:
// 바탕화면을 덮는 투명 오버레이, 전역 핫키, 트레이 아이콘, 저장.
// mac/Sources/main.swift 와 같은 일을 하고, 다리(window.sneaky)도 같은 모양이다.
//
// 이 셸이 시리즈의 다른 셸과 다른 점이 둘 있고, 둘 다 이 파일에서 제일 중요한 결정이다.
//
//   1. **투명은 DWM 픽셀 알파로 만든다** — 컬러 키가 아니다. 상어는 화면의 거의 모든
//      픽셀이 반투명이라(흐릿한 실루엣, 사그라드는 물살) 컬러 키를 쓰면 자홍색 테두리가
//      낀다. 불꽃놀이가 같은 이유로 같은 선택을 했다.
//   2. **클릭을 받아야 한다** — 4구·불꽃놀이는 마우스를 영영 안 받지만 상어는 밥을
//      클릭으로 준다. 게임모드가 켜진 동안만 WS_EX_TRANSPARENT 를 걷어낸다.

using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace DesktopShark;

static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new OverlayContext());
    }
}

/// <summary>창을 띄우지 않는 트레이 앱. 폼을 닫아도 트레이로 살아 있는다.</summary>
sealed class OverlayContext : ApplicationContext
{
    private readonly Overlay overlay = new();
    private readonly NotifyIcon tray = new();

    public OverlayContext()
    {
        overlay.Show();

        tray.Icon = LoadIcon();
        tray.Visible = true;
        Refresh();
        overlay.SettingsChanged += Refresh;
    }

    private void Refresh()
    {
        // 트레이 글자에도 게임모드를 적는다. 켜진 동안은 밑의 앱을 못 누르는데,
        // 그걸 모르면 「컴퓨터가 고장났다」가 된다.
        tray.Text = overlay.GameMode
            ? $"바탕화면 상어 — 게임모드 (밥 주는 중) · {overlay.StatusText}"
            : $"바탕화면 상어 — {overlay.StatusText}";
        tray.ContextMenuStrip = BuildMenu();
    }

    private static Icon LoadIcon()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "icon.ico");
        return File.Exists(path) ? new Icon(path) : SystemIcons.Application;
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();

        menu.Items.Add(new ToolStripMenuItem(overlay.StatusText) { Enabled = false });
        menu.Items.Add(new ToolStripSeparator());

        menu.Items.Add(new ToolStripMenuItem(
            overlay.GameMode ? "게임모드 끄기  Alt+Shift+S" : "게임모드 켜기 (밥 주기)  Alt+Shift+S",
            null, (_, _) => overlay.ToggleGameMode())
        {
            Checked = overlay.GameMode,
        });
        menu.Items.Add(new ToolStripMenuItem("랭킹 · 계정  Alt+Shift+R", null, (_, _) => overlay.TogglePanel()));

        if (Screen.AllScreens.Length > 1) menu.Items.Add(ScreenMenu());
        menu.Items.Add(new ToolStripSeparator());

        menu.Items.Add(new ToolStripMenuItem("이 기기의 상어 놓아주기…", null, (_, _) => overlay.ResetShark()));
        menu.Items.Add(new ToolStripSeparator());

        menu.Items.Add(new ToolStripMenuItem("숨기기 / 보이기  Alt+Shift+H", null, (_, _) => overlay.ToggleVisible()));
        menu.Items.Add(new ToolStripMenuItem("종료", null, (_, _) => Quit()));
        return menu;
    }

    /// <summary>「모니터 ▸」. 듀얼 모니터에서 어느 화면에 얹을지. 하나뿐이면 안 낸다.</summary>
    private ToolStripMenuItem ScreenMenu()
    {
        var root = new ToolStripMenuItem("모니터");
        var screens = Screen.AllScreens;
        for (var i = 0; i < screens.Length; i += 1)
        {
            var screen = screens[i];
            var size = screen.Bounds;
            var main = screen.Primary ? " (주 화면)" : "";
            var title = $"{i + 1}번  {size.Width}×{size.Height}{main}";
            var name = screen.DeviceName;
            root.DropDownItems.Add(new ToolStripMenuItem(title, null, (_, _) => overlay.SetScreen(name))
            {
                Checked = overlay.ChosenScreen().DeviceName == name,
            });
        }
        return root;
    }

    private void Quit()
    {
        tray.Visible = false;
        overlay.Close();
        ExitThread();
    }
}

sealed class Overlay : Form
{
    // 창 스타일 — 마우스 통과 + 작업 표시줄에 안 뜸 + 포커스 안 가져감.
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_NOACTIVATE = 0x08000000;

    private const int WM_HOTKEY = 0x0312;
    private const int MOD_ALT = 0x0001;
    private const int MOD_SHIFT = 0x0004;
    private const int MOD_NOREPEAT = 0x4000;
    private const int VK_S = 0x53;
    private const int VK_H = 0x48;
    private const int VK_R = 0x52;

    private const int HOTKEY_GAMEMODE = 1;
    private const int HOTKEY_TOGGLE = 2;
    private const int HOTKEY_PANEL = 3;

    /// <summary>
    /// SHARK_DEBUG 가 켜져 있을 때만 state.json 옆의 debug.log 로 흘린다. 맥 셸의 debugLog 는
    /// stderr 로 쓰지만, 이 앱은 <c>WinExe</c> 라 콘솔이 없다 — stderr 는 리다이렉트하지
    /// 않으면 아무 데도 안 나온다.
    /// </summary>
    private static readonly string DebugLogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DesktopShark", "debug.log");

    private static void DebugLog(string text)
    {
        if (Environment.GetEnvironmentVariable("SHARK_DEBUG") is null) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(DebugLogPath)!);
            File.AppendAllText(DebugLogPath, $"[shark] {DateTime.Now:HH:mm:ss.fff} {text}{Environment.NewLine}");
        }
        catch
        {
            // 로그 쓰기 실패로 앱이 죽으면 안 된다 — 진단 장치가 진단 대상을 만들 수는 없다.
        }
    }

    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr hWnd, int index, int value);
    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr hWnd, int id, int mod, int vk);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr hObject);
    [DllImport("dwmapi.dll")] private static extern int DwmEnableBlurBehindWindow(IntPtr hWnd, ref DWM_BLURBEHIND bb);

    [StructLayout(LayoutKind.Sequential)]
    private struct DWM_BLURBEHIND
    {
        public int dwFlags;
        public bool fEnable;
        public IntPtr hRgnBlur;
        public bool fTransitionOnMaximized;
    }

    private const int DWM_BB_ENABLE = 0x1;
    private const int DWM_BB_BLURREGION = 0x2;

    private readonly WebView2 web = new();
    private readonly string statePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DesktopShark", "state.json");

    private bool ready;
    private bool passingThrough = true;
    private bool panelOpen;

    /// <summary>지금 클릭을 받고 있는가. 맥 셸의 gameMode 와 같다.</summary>
    public bool GameMode { get; private set; }

    /// <summary>트레이에 적을 것. 렌더러가 밀어 준다.</summary>
    public string StatusText { get; private set; } = "1단계 · 배부름";

    public int Eaten { get; private set; }

    /// <summary>마지막으로 먹인 시각 (ms). 0 이면 「한 번도 안 먹였다」.</summary>
    public double LastFedAt { get; private set; }

    public string? PlayerId { get; private set; }
    public string? Secret { get; private set; }
    public string? Nickname { get; private set; }

    /// <summary>얹을 모니터의 장치 이름. 없거나 사라졌으면 주 화면.</summary>
    public string? ScreenName { get; private set; }

    public event Action? SettingsChanged;

    public Overlay()
    {
        ReadState();

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        // 작업 표시줄 자리는 비워 둔다.
        Bounds = ChosenScreen().WorkingArea;

        // DWM 합성에 맡길 때는 폼이 스스로 배경을 칠하면 안 된다. 검정은 알파 0 과
        // 함께 「아무것도 없음」으로 합성된다.
        BackColor = Color.Black;

        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(web);

        // 맥 셸은 didChangeScreenParametersNotification 으로 모니터·해상도 변경을 받는다.
        SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;

        _ = InitWebAsync();
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        Bounds = ChosenScreen().WorkingArea;
        SettingsChanged?.Invoke();
    }

    // MARK: 투명과 클릭
    //
    // 컬러 키(TransparencyKey)는 정해 둔 색 픽셀을 통째로 뚫는 방식이라 **불투명한
    // 그림**에만 맞는다. 상어는 화면의 거의 모든 픽셀이 반투명이라 컬러 키를 쓰면
    // 실루엣마다 자홍색 테두리가 낀다.
    //
    // 그래서 빈 영역(0,0,-1,-1)으로 DwmEnableBlurBehindWindow 를 부른다 — **아무것도
    // 흐리게 하지 않으면서** 그 창을 픽셀 단위 알파로 합성하게 만든다. WebView2 의
    // DefaultBackgroundColor = Transparent 와 함께 쓰면 반투명이 그대로 산다.
    //
    // **이 경로는 실제 윈도우에서 아직 확인되지 않았다** — 이 맥에 dotnet 이 없다.

    protected override CreateParams CreateParams
    {
        get
        {
            var p = base.CreateParams;
            p.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            return p;
        }
    }

    /// <summary>뜰 때 포커스를 가져가지 않는다. 아래 앱에서 하던 일이 끊기면 안 된다.</summary>
    protected override bool ShowWithoutActivation => true;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);

        SetWindowLong(Handle, GWL_EXSTYLE, GetWindowLong(Handle, GWL_EXSTYLE) | WS_EX_TRANSPARENT);
        EnablePerPixelAlpha();

        // **등록이 성공해도 시스템이 먼저 가로챌 수 있다.** 성공은 검증이 아니다.
        var gameOk = RegisterHotKey(Handle, HOTKEY_GAMEMODE, MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, VK_S);
        var toggleOk = RegisterHotKey(Handle, HOTKEY_TOGGLE, MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, VK_H);
        var panelOk = RegisterHotKey(Handle, HOTKEY_PANEL, MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, VK_R);
        DebugLog($"핫키 등록 game={gameOk} toggle={toggleOk} panel={panelOk}");
    }

    /// <summary>빈 영역으로 블러를 켠다 — 흐림은 없고 픽셀 단위 알파만 얻는다.</summary>
    private void EnablePerPixelAlpha()
    {
        var region = CreateRectRgn(0, 0, -1, -1);
        try
        {
            var bb = new DWM_BLURBEHIND
            {
                dwFlags = DWM_BB_ENABLE | DWM_BB_BLURREGION,
                fEnable = true,
                hRgnBlur = region,
            };
            var hr = DwmEnableBlurBehindWindow(Handle, ref bb);
            DebugLog($"DwmEnableBlurBehindWindow hr={hr}");
        }
        finally
        {
            DeleteObject(region);
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        UnregisterHotKey(Handle, HOTKEY_GAMEMODE);
        UnregisterHotKey(Handle, HOTKEY_TOGGLE);
        UnregisterHotKey(Handle, HOTKEY_PANEL);
        // SystemEvents 는 프로세스 전역 정적 이벤트다 — 안 풀면 이 창이 죽은 뒤에도
        // 구독이 남는다.
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        base.OnFormClosed(e);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY)
        {
            switch ((int)m.WParam)
            {
                case HOTKEY_GAMEMODE: ToggleGameMode(); break;
                case HOTKEY_PANEL: TogglePanel(); break;
                default: ToggleVisible(); break;
            }
        }
        base.WndProc(ref m);
    }

    // MARK: 웹뷰

    private async Task InitWebAsync()
    {
        // 사용자 데이터 폴더를 앱 폴더 옆이 아니라 AppData 에 둔다 — Program Files 에
        // 설치되면 앱 폴더에 쓸 수 없다.
        var userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DesktopShark", "webview");
        var env = await CoreWebView2Environment.CreateAsync(null, userData);
        await web.EnsureCoreWebView2Async(env);

        web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        web.CoreWebView2.Settings.IsStatusBarEnabled = false;
        web.CoreWebView2.WebMessageReceived += OnWebMessage;

        // 맥 셸의 커스텀 스킴에 해당하는 것. file:// 로 열면 ES 모듈 import 가 막힌다.
        web.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "shark.local", Path.Combine(AppContext.BaseDirectory, "web"),
            CoreWebView2HostResourceAccessKind.Allow);

        await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript());
        web.CoreWebView2.Navigate("https://shark.local/renderer/index.html");

        ready = true;
    }

    /// <summary>
    /// 저장한 것을 JS 값으로 만든다.
    ///
    /// <b>손으로 따옴표를 붙이지 않는다.</b> 별명에 따옴표나 역슬래시가 섞이면 스크립트가
    /// 통째로 깨지고 — 이건 문서 시작에 주입되므로 — window.sneaky 가 아예 안 만들어져
    /// 게임이 「브리지 없음」으로 조용히 떨어진다. 에러도 안 나고 핫키만 죽는다.
    /// </summary>
    private string StateJson() => JsonSerializer.Serialize(new
    {
        eaten = Eaten,
        lastFedAt = LastFedAt > 0 ? (double?)LastFedAt : null,
        playerId = PlayerId,
        secret = Secret,
        nickname = Nickname,
    });

    /// <summary>맥 셸과 <b>같은 모양</b>의 다리. 한쪽만 고치면 두 플랫폼이 다른 게임이 된다.</summary>
    private string BridgeScript() => $$"""
        window.sneaky = {
          getState: () => Promise.resolve({{StateJson()}}),
          saveState: (s) => window.chrome.webview.postMessage({
            type: 'state', eaten: s && s.eaten, lastFedAt: s && s.lastFedAt,
          }),
          saveAccount: (a) => window.chrome.webview.postMessage({
            type: 'account', playerId: a && a.playerId, secret: a && a.secret, nickname: a && a.nickname,
          }),
          setStatus: (s) => window.chrome.webview.postMessage({
            type: 'status', stage: s && s.stage, hunger: s && s.hunger, eaten: s && s.eaten,
          }),
          onGameMode: (handler) => { window.__sharkGameMode = handler },
          onPanel: (handler) => { window.__sharkPanel = handler },
        }
        window.addEventListener('error', (e) => window.chrome.webview.postMessage({
          type: 'log', text: `${e.message} (${e.filename}:${e.lineno})`,
        }))
        console.error = (...args) => window.chrome.webview.postMessage({
          type: 'log', text: args.join(' '),
        })
        """;

    private void Send(string script)
    {
        if (ready) _ = web.ExecuteScriptAsync(script);
    }

    // MARK: 게임모드

    public void ToggleGameMode()
    {
        if (!Visible) return;
        SetGameMode(!GameMode);
    }

    private void SetGameMode(bool on)
    {
        GameMode = on;
        if (!on) SetPanel(false);
        UpdateMousePass();
        Send($"window.__sharkGameMode && window.__sharkGameMode({(on ? "true" : "false")})");
        SettingsChanged?.Invoke();
    }

    /// <summary>
    /// <b>게임모드가 켜진 동안에만</b> 창이 마우스를 받는다. 4구는 수식키를 누르고 있는
    /// 동안이었고 상어는 핫키로 켠 동안이다 — 이 한 줄이 두 셸의 유일한 차이다.
    /// </summary>
    private void UpdateMousePass()
    {
        var wantPass = !GameMode;
        if (wantPass == passingThrough) return;
        passingThrough = wantPass;
        DebugLog($"pass {wantPass}");

        var style = GetWindowLong(Handle, GWL_EXSTYLE);
        SetWindowLong(Handle, GWL_EXSTYLE,
            wantPass ? style | WS_EX_TRANSPARENT : style & ~WS_EX_TRANSPARENT);
    }

    public void TogglePanel()
    {
        if (!Visible) return;
        // 패널은 게임모드에서만 뜻이 있다 — 클릭을 못 받으면 버튼도 못 누른다.
        if (!GameMode) SetGameMode(true);
        SetPanel(!panelOpen);
    }

    private void SetPanel(bool open)
    {
        if (open == panelOpen) return;
        panelOpen = open;
        Send($"window.__sharkPanel && window.__sharkPanel({(open ? "true" : "false")})");

        // 별명을 타이핑하려면 창이 키보드를 받아야 한다. WS_EX_NOACTIVATE 가 붙어 있는
        // 동안은 한 글자도 못 친다. <b>패널을 열 때만</b> 떼고, 닫으면 곧장 도로 붙인다.
        var style = GetWindowLong(Handle, GWL_EXSTYLE);
        SetWindowLong(Handle, GWL_EXSTYLE,
            open ? style & ~WS_EX_NOACTIVATE : style | WS_EX_NOACTIVATE);
        if (open) SetForegroundWindow(Handle);
    }

    public void ToggleVisible()
    {
        if (Visible)
        {
            // **안 보이는 창이 클릭을 먹는 상태를 만들지 않는다.** 숨기면 게임모드도 내린다.
            SetGameMode(false);
            Hide();
        }
        else Show();
        SettingsChanged?.Invoke();
    }

    /// <summary>키우던 상어를 놓아준다. 되돌릴 수 없어서 물어본다.</summary>
    public void ResetShark()
    {
        var answer = MessageBox.Show(
            "이 기기에서 키운 기록이 사라지고 아기상어부터 다시 시작합니다.\n"
            + "랭킹 기록은 서버에 남고, 복구 코드를 다시 넣으면 돌아옵니다.",
            "상어를 놓아줄까요?", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning);
        if (answer != DialogResult.OK) return;

        Eaten = 0;
        LastFedAt = 0;
        WriteState();
        if (ready) web.CoreWebView2.Reload();
        SettingsChanged?.Invoke();
    }

    public void SetScreen(string name)
    {
        ScreenName = name;
        Bounds = ChosenScreen().WorkingArea;
        WriteState();
        SettingsChanged?.Invoke();
    }

    /// <summary>저장해 둔 화면. 그 화면이 사라졌으면(케이블을 뽑았거나) 주 화면으로.</summary>
    public Screen ChosenScreen() =>
        Screen.AllScreens.FirstOrDefault(s => s.DeviceName == ScreenName) ?? Screen.PrimaryScreen!;

    // MARK: 저장

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var body = JsonDocument.Parse(e.WebMessageAsJson).RootElement;
            switch (body.GetProperty("type").GetString())
            {
                case "log":
                    if (body.TryGetProperty("text", out var text)) DebugLog($"[web] {text.GetString()}");
                    return;

                case "state":
                    if (body.TryGetProperty("eaten", out var n) && n.ValueKind == JsonValueKind.Number)
                        Eaten = n.GetInt32();
                    if (body.TryGetProperty("lastFedAt", out var f) && f.ValueKind == JsonValueKind.Number)
                        LastFedAt = f.GetDouble();
                    WriteState();
                    return;

                case "account":
                    PlayerId = Str(body, "playerId");
                    Secret = Str(body, "secret");
                    Nickname = Str(body, "nickname");
                    WriteState();
                    return;

                case "status":
                    var stage = body.TryGetProperty("stage", out var s) ? s.GetInt32() : 1;
                    var hunger = Str(body, "hunger") ?? "";
                    var count = body.TryGetProperty("eaten", out var c) ? c.GetInt32() : 0;
                    StatusText = $"{stage}단계 · {hunger} · {count}개 먹임";
                    SettingsChanged?.Invoke();
                    return;
            }
        }
        catch
        {
            // 저장에 실패해도 게임은 계속된다.
        }
    }

    private static string? Str(JsonElement body, string name) =>
        body.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private void ReadState()
    {
        try
        {
            var json = JsonDocument.Parse(File.ReadAllText(statePath)).RootElement;
            Eaten = json.TryGetProperty("eaten", out var n) ? n.GetInt32() : 0;
            LastFedAt = json.TryGetProperty("lastFedAt", out var f) && f.ValueKind == JsonValueKind.Number
                ? f.GetDouble() : 0;
            PlayerId = Str(json, "playerId");
            Secret = Str(json, "secret");
            Nickname = Str(json, "nickname");
            ScreenName = Str(json, "screen");
        }
        catch
        {
            Eaten = 0;
            LastFedAt = 0;
        }
    }

    private void WriteState()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(statePath)!);
            File.WriteAllText(statePath, JsonSerializer.Serialize(new
            {
                eaten = Eaten,
                lastFedAt = LastFedAt,
                playerId = PlayerId,
                secret = Secret,
                nickname = Nickname,
                screen = ScreenName,
            }));
        }
        catch { }
    }
}
