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
//   2. **창은 마우스를 안 받는다. 대신 엿듣는다.** 밥 주기는 늘 켜져 있으므로 창이
//      클릭을 삼키면 일을 아예 못 한다. WS_EX_TRANSPARENT 를 붙여 둔 채로, 저수준 훅
//      (WH_MOUSE_LL / WH_KEYBOARD_LL)으로 클릭과 타자를 **구경만** 한다 — 누르던
//      버튼은 그대로 눌리고 치던 글자는 그대로 찍힌다. 패널을 열 때만 잠깐 받는다.

using System.Diagnostics;
using System.Net.Http;
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
        tray.Text = overlay.GameMode
            ? $"바탕화면 상어 — 밥 주는 중 · {overlay.StatusText}"
            : $"바탕화면 상어 — 밥 주기 멈춤 · {overlay.StatusText}";
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

        // 1단계 — 새 버전이 있을 때만 낸다. 없으면 메뉴에 아무 흔적도 없다.
        if (overlay.UpdateVersion is not null)
        {
            menu.Items.Add(new ToolStripMenuItem(
                overlay.UpdateNote ?? $"새 버전 {overlay.UpdateVersion} 설치",
                null, (_, _) => overlay.InstallUpdate())
            { Enabled = !overlay.Updating });
            menu.Items.Add(new ToolStripSeparator());
        }

        menu.Items.Add(new ToolStripMenuItem(
            overlay.GameMode ? "밥 주기 멈추기  Alt+Shift+S" : "밥 주기 다시  Alt+Shift+S",
            null, (_, _) => overlay.ToggleGameMode())
        {
            Checked = overlay.GameMode,
        });
        menu.Items.Add(new ToolStripMenuItem("랭킹 · 계정  Alt+Shift+R", null, (_, _) => overlay.TogglePanel()));
        menu.Items.Add(new ToolStripMenuItem("랭킹에 올리기", null, (_, _) => overlay.ToggleRanking())
        {
            Checked = overlay.RankingOn,
        });

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

    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_MBUTTONDOWN = 0x0207;

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

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr module, uint thread);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT
    {
        public int x;
        public int y;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
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

    // 훅 핸들과 델리게이트. **델리게이트를 필드로 들고 있어야 한다** — 지역 변수로 두면
    // GC 가 거둬 가고, 그때부터 훅이 조용히 죽는다(에러도 없이 콜백만 안 온다).
    private IntPtr mouseHook = IntPtr.Zero;
    private IntPtr keyHook = IntPtr.Zero;
    private HookProc? mouseProc;
    private HookProc? keyProc;

    /// <summary>
    /// 밥이 떨어지는 중인가. <b>기본이 켜짐이다</b> — 남이 화면을 볼 때만 끈다.
    /// 창이 클릭을 삼키지 않으므로 켜 둔 채로 일할 수 있다. 저장하지 않는다.
    /// </summary>
    public bool GameMode { get; private set; } = true;

    /// <summary>트레이에 적을 것. 렌더러가 밀어 준다.</summary>
    public string StatusText { get; private set; } = "1단계 · 배부름";

    /// <summary>전체 누적. 종을 여는 데 쓴다.</summary>
    public int Total { get; private set; }

    /// <summary>종마다 따로 키운 점수.</summary>
    public Dictionary<string, int> Grown { get; private set; } = new();

    /// <summary>지금 종의 성장을 멈췄는가. 멈춰도 전체 누적은 계속 쌓인다.</summary>
    public bool Frozen { get; private set; }

    /// <summary>보여 줄 단계를 못 박았는가. 0 이면 「자동」.</summary>
    public int PinnedStage { get; private set; }

    /// <summary>마지막으로 먹인 시각 (ms). 0 이면 「한 번도 안 먹였다」.</summary>
    public double LastFedAt { get; private set; }

    public string? PlayerId { get; private set; }
    public string? Secret { get; private set; }
    public string? Nickname { get; private set; }

    /// <summary>
    /// 랭킹에 올릴 것인가. <b>밥 주기와 달리 이건 저장한다</b> — 「안 올린다」는 설정이다.
    /// </summary>
    public bool RankingOn { get; private set; } = true;

    /// <summary>지금 키우는 상어의 종.</summary>
    public string SpeciesKey { get; private set; } = "white";

    /// <summary>별명을 치는 중인가. <b>이때만</b> 키보드를 가져온다.</summary>
    private bool holdingKeyboard;

    /// <summary>
    /// 패널이 차지한 네모(창 안 좌표, 왼쪽 위 기준). 비어 있으면 패널이 없다.
    /// <b>커서가 이 안에 있을 때만</b> 창이 클릭을 받는다 — 패널을 열었다고 화면
    /// 전체가 클릭을 삼키면 다른 창을 아예 못 누르고, 누르지 못하니 타자도 안 된다.
    /// </summary>
    private Rectangle panelRect = Rectangle.Empty;
    private bool cursorOverPanel;

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

        // 켠 지 20초 뒤에 한 번, 그 뒤로는 하루 한 번.
        var firstCheck = new System.Windows.Forms.Timer { Interval = 20_000 };
        firstCheck.Tick += (_, _) => { firstCheck.Stop(); _ = CheckForUpdateAsync(); };
        firstCheck.Start();
        updateTimer.Tick += (_, _) => _ = CheckForUpdateAsync();
        updateTimer.Start();

        _ = InitWebAsync();
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        Bounds = ChosenScreen().WorkingArea;
        SettingsChanged?.Invoke();
    }

    // MARK: 업데이트
    //
    // <b>두 단계로 나눠 뒀다.</b> 1단계는 「새 버전이 있다」고 알리는 것뿐이고,
    // 2단계는 눌렀을 때 설치본을 받아 조용히 다시 까는 것이다. 눌러야만 깐다 —
    // 켜 두고 사는 앱이 혼자 다시 뜨면 상어가 사라진 것처럼 보인다.
    //
    // 키우던 상어는 state.json 에 있어서 다시 깔아도 그대로다. 설치본이 덮어쓰는 것은
    // 프로그램 폴더뿐이다.

    private const string ReleaseApi = "https://api.github.com/repos/joowon-dev/desktop-shark/releases/latest";
    private const string ReleasePage = "https://github.com/joowon-dev/desktop-shark/releases/latest";
    /// <summary>자동 업데이트가 받아 가는 것은 설치본이다 — zip 은 사람이 직접 풀 때 쓴다.</summary>
    private const string WinAssetSuffix = "-win-Setup.exe";

    private static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly System.Windows.Forms.Timer updateTimer = new() { Interval = 24 * 60 * 60 * 1000 };

    public string? UpdateVersion { get; private set; }
    public string? UpdateNote { get; private set; }
    public bool Updating { get; private set; }
    private string? updateAsset;

    private static string CurrentVersion =>
        System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";

    /// <summary>"v1.10.0" 이 "1.9.0" 보다 높다. 문자열로 비교하면 거꾸로 나온다.</summary>
    public static bool IsNewerVersion(string candidate, string current)
    {
        static int[] Parts(string text) => text.TrimStart('v', 'V', ' ')
            .Split('.')
            .Select(p => int.TryParse(new string(p.TakeWhile(char.IsDigit).ToArray()), out var n) ? n : 0)
            .ToArray();

        var a = Parts(candidate);
        var b = Parts(current);
        for (var i = 0; i < Math.Max(a.Length, b.Length); i += 1)
        {
            var x = i < a.Length ? a[i] : 0;
            var y = i < b.Length ? b[i] : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    /// <summary>하루 한 번 물어본다. 실패는 조용히 삼킨다.</summary>
    private async Task CheckForUpdateAsync()
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, ReleaseApi);
            request.Headers.Add("Accept", "application/vnd.github+json");
            // GitHub 은 User-Agent 없는 요청을 거절한다.
            request.Headers.Add("User-Agent", "DesktopShark");

            using var response = await http.SendAsync(request);
            if (!response.IsSuccessStatusCode) return;

            var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            var tag = json.GetProperty("tag_name").GetString();
            if (tag is null || !IsNewerVersion(tag, CurrentVersion)) return;

            string? asset = null;
            if (json.TryGetProperty("assets", out var assets))
            {
                foreach (var a in assets.EnumerateArray())
                {
                    var name = a.TryGetProperty("name", out var n) ? n.GetString() : null;
                    if (name is not null && name.EndsWith(WinAssetSuffix, StringComparison.OrdinalIgnoreCase))
                    {
                        asset = a.GetProperty("browser_download_url").GetString();
                        break;
                    }
                }
            }

            BeginInvoke(() =>
            {
                UpdateVersion = tag;
                updateAsset = asset;
                SettingsChanged?.Invoke();
            });
        }
        catch
        {
            // 새 버전을 못 찾는 것과 상어가 안 도는 것은 다른 일이다.
        }
    }

    /// <summary>2단계 — 받아서 조용히 다시 깐다. 한 걸음이라도 어긋나면 릴리스 페이지를 연다.</summary>
    public async void InstallUpdate()
    {
        if (Updating) return;
        if (updateAsset is null)
        {
            OpenReleasePage();
            return;
        }

        Updating = true;
        UpdateNote = "내려받는 중…";
        SettingsChanged?.Invoke();

        var path = Path.Combine(Path.GetTempPath(), $"DesktopShark-{Guid.NewGuid():N}.exe");
        try
        {
            using (var request = new HttpRequestMessage(HttpMethod.Get, updateAsset))
            {
                request.Headers.Add("User-Agent", "DesktopShark");
                using var response = await http.SendAsync(request);
                response.EnsureSuccessStatusCode();
                await using var file = File.Create(path);
                await response.Content.CopyToAsync(file);
            }

            UpdateNote = "설치하는 중…";
            SettingsChanged?.Invoke();

            // 조용히 깔고, 돌던 앱을 닫았다가 새것으로 다시 띄운다(installer.iss 가 그렇게 돼 있다).
            Process.Start(new ProcessStartInfo(path)
            {
                Arguments = "/SILENT /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /NORESTART",
                UseShellExecute = true,
            });
            Application.Exit();
        }
        catch
        {
            Updating = false;
            UpdateNote = "직접 받기";
            SettingsChanged?.Invoke();
            OpenReleasePage();
        }
    }

    private static void OpenReleasePage()
    {
        try
        {
            Process.Start(new ProcessStartInfo(ReleasePage) { UseShellExecute = true });
        }
        catch { }
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

        StartEavesdropping();
    }

    // MARK: 엿듣기 — 클릭과 타자를 밥으로
    //
    // 저수준 훅은 이벤트를 **구경만** 한다. CallNextHookEx 로 그대로 흘려보내므로
    // 누르던 버튼은 그대로 눌리고 치던 글자는 그대로 찍힌다. 맥의 전역 모니터와 같은
    // 자리이고, 맥과 달리 따로 권한을 받을 필요가 없다.

    private void StartEavesdropping()
    {
        // 델리게이트를 필드에 담아 둔다. 지역 변수로 두면 GC 가 거둬 가고
        // 그때부터 훅이 **조용히** 죽는다 — 에러도 없이 콜백만 안 온다.
        mouseProc = MouseHook;
        keyProc = KeyHook;

        mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, IntPtr.Zero, 0);
        keyHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyProc, IntPtr.Zero, 0);
        DebugLog($"엿듣기 시작 mouse={mouseHook != IntPtr.Zero} key={keyHook != IntPtr.Zero}");
    }

    private IntPtr MouseHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            var data = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
            // 훅은 화면 좌표를 준다. 웹뷰는 창 안 왼쪽 위 기준이다.
            var bounds = Bounds;
            var x = data.x - bounds.Left;
            var y = data.y - bounds.Top;
            var over = panelOpen && !panelRect.IsEmpty && panelRect.Contains(x, y);

            if (over != cursorOverPanel)
            {
                cursorOverPanel = over;
                BeginInvoke(UpdateMousePass);
            }

            var message = (int)wParam;
            var pressed = message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN
                || message == WM_MBUTTONDOWN;
            if (pressed && Feeding
                && data.x >= bounds.Left && data.x < bounds.Right
                && data.y >= bounds.Top && data.y < bounds.Bottom)
            {
                // 훅 안에서는 오래 붙잡으면 안 된다 — 윈도우가 훅을 떼어 버린다.
                BeginInvoke(() => Send($"window.__sharkFeed && window.__sharkFeed({x}, {y})"));
            }
        }
        return CallNextHookEx(mouseHook, code, wParam, lParam);
    }

    private IntPtr KeyHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && Feeding)
        {
            var message = (int)wParam;
            if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN)
            {
                // 어디를 쳤는지도 무엇을 쳤는지도 게임에 넘기지 않는다 — 몇 번인지만 센다.
                BeginInvoke(() => Send("window.__sharkType && window.__sharkType()"));
            }
        }
        return CallNextHookEx(keyHook, code, wParam, lParam);
    }

    /// <summary>
    /// 지금 밥이 떨어지는가. <b>패널 위에서 누른 것만</b> 뺀다 — 패널을 열어 뒀다고
    /// 밥 주기가 멈추면 랭킹을 보는 동안 상어가 굶는다.
    /// </summary>
    private bool Feeding => GameMode && ready && Visible && !cursorOverPanel;

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
        if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        if (keyHook != IntPtr.Zero) UnhookWindowsHookEx(keyHook);
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
        total = Total,
        grown = Grown,
        frozen = Frozen,
        pinnedStage = PinnedStage > 0 ? (int?)PinnedStage : null,
        lastFedAt = LastFedAt > 0 ? (double?)LastFedAt : null,
        playerId = PlayerId,
        secret = Secret,
        nickname = Nickname,
        ranking = RankingOn,
        species = SpeciesKey,
    });

    /// <summary>맥 셸과 <b>같은 모양</b>의 다리. 한쪽만 고치면 두 플랫폼이 다른 게임이 된다.</summary>
    private string BridgeScript() => $$"""
        window.sneaky = {
          getState: () => Promise.resolve({{StateJson()}}),
          saveState: (s) => window.chrome.webview.postMessage({
            type: 'state', total: s && s.total, lastFedAt: s && s.lastFedAt,
          }),
          saveAccount: (a) => window.chrome.webview.postMessage({
            type: 'account', playerId: a && a.playerId, secret: a && a.secret, nickname: a && a.nickname,
          }),
          setStatus: (s) => window.chrome.webview.postMessage({
            type: 'status', stage: s && s.stage, hunger: s && s.hunger, eaten: s && s.eaten,
          }),
          onGameMode: (handler) => { window.__sharkGameMode = handler },
          onPanel: (handler) => { window.__sharkPanel = handler },
          onFeed: (handler) => { window.__sharkFeed = handler },
          onType: (handler) => { window.__sharkType = handler },
          onRanking: (handler) => { window.__sharkRanking = handler },
          saveRanking: (on) => window.chrome.webview.postMessage({ type: 'ranking', on: !!on }),
          closePanel: () => window.chrome.webview.postMessage({ type: 'closePanel' }),
          grabKeyboard: () => window.chrome.webview.postMessage({ type: 'grabKeyboard' }),
          releaseKeyboard: () => window.chrome.webview.postMessage({ type: 'releaseKeyboard' }),
          saveDex: (d) => window.chrome.webview.postMessage({
            type: 'dex', species: d && d.species, grown: d && d.grown,
            frozen: !!(d && d.frozen), pinnedStage: (d && d.pinnedStage) || 0,
          }),
          setPanelRect: (r) => window.chrome.webview.postMessage({
            type: 'panelRect', x: r ? r.x : -1, y: r ? r.y : -1, w: r ? r.w : 0, h: r ? r.h : 0,
          }),
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
        Send($"window.__sharkGameMode && window.__sharkGameMode({(on ? "true" : "false")})");
        SettingsChanged?.Invoke();
    }

    /// <summary>
    /// <b>창이 마우스를 받는 것은 커서가 패널 네모 위에 있을 때뿐이다.</b>
    ///
    /// 패널이 열렸다고 화면 전체가 클릭을 받으면 다른 창을 아예 못 누르고, 누르지
    /// 못하니 포커스도 못 옮겨 타자도 안 된다. 창은 하나이므로 커서 자리로 가른다.
    /// </summary>
    private void UpdateMousePass()
    {
        var wantPass = !cursorOverPanel;
        if (wantPass == passingThrough) return;
        passingThrough = wantPass;
        DebugLog($"pass {wantPass}");

        var style = GetWindowLong(Handle, GWL_EXSTYLE);
        SetWindowLong(Handle, GWL_EXSTYLE,
            wantPass ? style | WS_EX_TRANSPARENT : style & ~WS_EX_TRANSPARENT);
    }

    /// <summary>랭킹을 켜고 끈다. 끄면 아무것도 서버로 안 보낸다 — 상어는 그대로 자란다.</summary>
    public void ToggleRanking()
    {
        RankingOn = !RankingOn;
        WriteState();
        Send($"window.__sharkRanking && window.__sharkRanking({(RankingOn ? "true" : "false")})");
        SettingsChanged?.Invoke();
    }

    public void TogglePanel()
    {
        if (!Visible) return;
        SetPanel(!panelOpen);
    }

    private void SetPanel(bool open)
    {
        if (open == panelOpen) return;
        panelOpen = open;
        Send($"window.__sharkPanel && window.__sharkPanel({(open ? "true" : "false")})");
        UpdateMousePass();

        // **패널을 열어도 키보드는 안 가져간다.** 가져가면 랭킹을 띄워 둔 채로 다른
        // 창에 한 글자도 못 친다. 마우스만 받고(버튼을 눌러야 하니까), 키보드는
        // 별명 칸을 실제로 눌렀을 때만 가져온다.
        if (!open)
        {
            panelRect = Rectangle.Empty;
            cursorOverPanel = false;
            ReleaseKeyboard();
        }
        UpdateMousePass();
    }

    /// <summary>별명 칸을 눌렀다. 이제서야 키보드를 가져온다.</summary>
    private void GrabKeyboard()
    {
        if (holdingKeyboard) return;
        holdingKeyboard = true;
        var style = GetWindowLong(Handle, GWL_EXSTYLE);
        SetWindowLong(Handle, GWL_EXSTYLE, style & ~WS_EX_NOACTIVATE);
        SetForegroundWindow(Handle);
        DebugLog("키보드 가져옴");
    }

    /// <summary>별명 칸에서 손을 뗐거나 패널을 닫았다. 쓰던 앱으로 돌려준다.</summary>
    private void ReleaseKeyboard()
    {
        if (!holdingKeyboard) return;
        holdingKeyboard = false;
        var style = GetWindowLong(Handle, GWL_EXSTYLE);
        SetWindowLong(Handle, GWL_EXSTYLE, style | WS_EX_NOACTIVATE);
        DebugLog("키보드 돌려줌");
    }

    public void ToggleVisible()
    {
        if (Visible)
        {
            // **안 보이는 창이 클릭을 먹는 상태를 만들지 않는다.** 패널부터 닫는다.
            SetPanel(false);
            Hide();
        }
        else Show();
        SettingsChanged?.Invoke();
    }

    /// <summary>키우던 상어를 놓아준다. 되돌릴 수 없어서 물어본다.</summary>
    public void ResetShark()
    {
        var answer = MessageBox.Show(
            "이 기기에서 키운 기록과 열어 둔 종이 사라지고 아기 백상아리부터 다시 시작합니다.\n"
            + "랭킹 기록은 서버에 남고, 복구 코드를 다시 넣으면 돌아옵니다.",
            "상어를 놓아줄까요?", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning);
        if (answer != DialogResult.OK) return;

        Total = 0;
        Grown = new Dictionary<string, int>();
        Frozen = false;
        PinnedStage = 0;
        LastFedAt = 0;
        SpeciesKey = "white";
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
                    if (body.TryGetProperty("total", out var n) && n.ValueKind == JsonValueKind.Number)
                        Total = n.GetInt32();
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

                case "ranking":
                    RankingOn = body.TryGetProperty("on", out var r) && r.ValueKind == JsonValueKind.True;
                    WriteState();
                    SettingsChanged?.Invoke();
                    return;

                case "closePanel":
                    SetPanel(false);
                    return;

                case "panelRect":
                {
                    var w = body.TryGetProperty("w", out var pw) ? pw.GetDouble() : 0;
                    var h = body.TryGetProperty("h", out var ph) ? ph.GetDouble() : 0;
                    if (w <= 0 || h <= 0)
                    {
                        panelRect = Rectangle.Empty;
                    }
                    else
                    {
                        var x = body.TryGetProperty("x", out var px) ? px.GetDouble() : 0;
                        var y = body.TryGetProperty("y", out var py) ? py.GetDouble() : 0;
                        panelRect = new Rectangle((int)x, (int)y, (int)w, (int)h);
                    }
                    return;
                }

                case "grabKeyboard":
                    GrabKeyboard();
                    return;

                case "releaseKeyboard":
                    ReleaseKeyboard();
                    return;

                case "dex":
                    SpeciesKey = Str(body, "species") ?? SpeciesKey;
                    // **숫자가 아닌 값은 그것만 버린다.** 통째로 받으면 값 하나 때문에
                    // 키운 것이 다 날아간다.
                    if (body.TryGetProperty("grown", out var g) && g.ValueKind == JsonValueKind.Object)
                    {
                        Grown = g.EnumerateObject()
                            .Where(v => v.Value.ValueKind == JsonValueKind.Number)
                            .ToDictionary(v => v.Name, v => v.Value.GetInt32());
                    }
                    Frozen = body.TryGetProperty("frozen", out var fz) && fz.ValueKind == JsonValueKind.True;
                    PinnedStage = body.TryGetProperty("pinnedStage", out var ps)
                        && ps.ValueKind == JsonValueKind.Number ? ps.GetInt32() : 0;
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
            Total = json.TryGetProperty("total", out var n) ? n.GetInt32() : 0;
            Grown = json.TryGetProperty("grown", out var g) && g.ValueKind == JsonValueKind.Object
                ? g.EnumerateObject().Where(v => v.Value.ValueKind == JsonValueKind.Number)
                   .ToDictionary(v => v.Name, v => v.Value.GetInt32())
                : new Dictionary<string, int>();
            Frozen = json.TryGetProperty("frozen", out var fz) && fz.ValueKind == JsonValueKind.True;
            PinnedStage = json.TryGetProperty("pinnedStage", out var ps)
                && ps.ValueKind == JsonValueKind.Number ? ps.GetInt32() : 0;
            LastFedAt = json.TryGetProperty("lastFedAt", out var f) && f.ValueKind == JsonValueKind.Number
                ? f.GetDouble() : 0;
            PlayerId = Str(json, "playerId");
            Secret = Str(json, "secret");
            Nickname = Str(json, "nickname");
            ScreenName = Str(json, "screen");
            SpeciesKey = Str(json, "species") ?? "white";
            RankingOn = !json.TryGetProperty("ranking", out var rank) || rank.ValueKind != JsonValueKind.False;
        }
        catch
        {
            Total = 0;
            Grown = new Dictionary<string, int>();
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
                total = Total,
                grown = Grown,
                frozen = Frozen,
                pinnedStage = PinnedStage,
                lastFedAt = LastFedAt,
                playerId = PlayerId,
                secret = Secret,
                nickname = Nickname,
                ranking = RankingOn,
                species = SpeciesKey,
                screen = ScreenName,
            }));
        }
        catch { }
    }
}
