using System.Diagnostics;
using System.Security.Cryptography;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.UIA3;

namespace PlcWiringTrainer.UiTests;

public sealed class IsolatedPointerFactAttribute : FactAttribute
{
    public IsolatedPointerFactAttribute()
    {
        if (!string.Equals(
            Environment.GetEnvironmentVariable("PLCW_POINTER_UI_TESTS"),
            "1",
            StringComparison.Ordinal))
        {
            Skip = "격리된 interactive Windows 세션에서만 물리 포인터 입력을 검증합니다.";
        }
    }
}

[Collection("Native UI")]
public sealed class NativeWorkbenchUiTests
{
    [Fact]
    public void NativeWindowExposesPaletteCanvasInspectorAndValidation()
    {
        using var session = NativeAppSession.Start();

        Assert.Equal("PLC Wiring Trainer 4.3.0", session.Window.Title);
        Assert.NotNull(session.FindByAutomationId("WorkspaceNavigation"));
        Assert.NotNull(session.FindByAutomationId("PlacementWorkspaceButton"));
        Assert.NotNull(session.FindByAutomationId("WiringWorkspaceButton"));
        Assert.NotNull(session.FindByAutomationId("ValidationWorkspaceButton"));
        AutomationElement paletteToggle = session.FindByAutomationId("PalettePaneToggle");
        Assert.NotNull(paletteToggle);
        paletteToggle.AsToggleButton().Toggle();
        Assert.NotNull(session.FindByAutomationId("DevicePalette"));
        Assert.NotNull(session.FindByAutomationId("PaletteSearchBox"));
        Assert.Equal(
            "검증 결선 13종 · 연습 전용 35종 · 준비 중 5종 · 숨김 0종",
            session.FindByAutomationId("PaletteSummaryText").Name);
        Assert.NotNull(session.FindByAutomationId("WiringCanvas"));
        Assert.NotNull(session.WaitForAutomationId("Device:supply"));
        Assert.NotNull(session.WaitForAutomationId("Terminal:supply:+24V"));
        Assert.NotNull(session.WaitForAutomationId("Conductor:plc-common-wrong"));
        Assert.NotNull(session.FindByAutomationId("InspectorTabs"));
        Assert.NotNull(session.FindByAutomationId("SaveDocumentButton"));
        session.SelectTab("결선 검증");
        Assert.NotNull(session.WaitForAutomationId("ValidationIssueList"));
        Assert.NotNull(session.WaitForAutomationId("RevisionStatusText"));
        Assert.False(session.HasExited);
    }

    [Fact]
    public void ClickingValidationIssueFocusesItsActualConductorAndUpdatesProperties()
    {
        using var session = NativeAppSession.Start();
        session.SelectTab("결선 검증");

        AutomationElement issue = session.WaitForName("NPN_INPUT_COMMON_POLARITY", TimeSpan.FromSeconds(12));
        NativeAppSession.ActivateListItem(issue);

        AutomationElement canvas = session.FindByAutomationId("WiringCanvas");
        bool focusedWire = WaitUntil(
            () => canvas.Name.Contains("plc-common-wrong", StringComparison.Ordinal),
            TimeSpan.FromSeconds(5));
        Assert.True(focusedWire, $"캔버스 접근성 이름이 문제 전선을 가리키지 않습니다: {canvas.Name}");

        TextBox label = session.FindByAutomationId("ConductorLabelBox").AsTextBox();
        Assert.Equal("W004", label.Text);
        Assert.NotNull(session.FindByAutomationId("ConductorDisplayNameBox"));
        label.Text = "W-ERR-01";
        Assert.Equal("W-ERR-01", label.Text);
    }

    [Fact]
    public void PaletteEditHidesAndRestoresADeviceWithoutDeletingItsAsset()
    {
        using var session = NativeAppSession.Start();
        session.FindByAutomationId("PalettePaneToggle").AsToggleButton().Toggle();
        TextBox search = session.FindByAutomationId("PaletteSearchBox").AsTextBox();
        search.Text = "LED 표시등 녹";

        session.FindByAutomationId("PaletteEditButton").AsToggleButton().Toggle();
        AutomationElement hide = session.WaitForAutomationId("PaletteHideButton");
        hide.AsButton().Invoke();

        Assert.False(session.ExistsByAutomationId("PaletteHideButton"));
        session.WaitForAutomationId("RestoreHiddenPaletteButton").AsButton().Invoke();
        Assert.NotNull(session.WaitForAutomationId("PaletteHideButton"));
    }

    [IsolatedPointerFact]
    public void BlankCanvasRightClickSearchPlacesADeviceWithoutOpeningThePalette()
    {
        using var session = NativeAppSession.Start();
        AutomationElement canvas = session.FindByAutomationId("WiringCanvas");
        System.Drawing.Rectangle bounds = canvas.BoundingRectangle;
        string helpText = canvas.HelpText;
        Assert.StartsWith("blank-local:", helpText, StringComparison.Ordinal);
        string[] coordinates = helpText["blank-local:".Length..].Split(',');
        Assert.Equal(2, coordinates.Length);
        Assert.True(int.TryParse(coordinates[0], out int localX), helpText);
        Assert.True(int.TryParse(coordinates[1], out int localY), helpText);
        FlaUI.Core.Input.Mouse.RightClick(new System.Drawing.Point(bounds.Left + localX, bounds.Top + localY));

        TextBox search = session.WaitForAutomationId("QuickInsertSearchBox").AsTextBox();
        Assert.False(session.ExistsByAutomationId("DevicePalette"));
        string revisionBefore = session.FindByAutomationId("RevisionStatusText").Name;
        search.Text = "XBF-AD04A";
        search.Focus();
        FlaUI.Core.Input.Keyboard.Press(FlaUI.Core.WindowsAPI.VirtualKeyShort.RETURN);

        Assert.True(WaitUntil(
            () => session.FindByAutomationId("RevisionStatusText").Name != revisionBefore,
            TimeSpan.FromSeconds(4)));
        session.FindByAutomationId("UndoButton").AsButton().Invoke();
    }

    private static bool WaitUntil(Func<bool> condition, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow + timeout;
        do
        {
            if (condition())
            {
                return true;
            }

            Thread.Sleep(150);
        }
        while (DateTime.UtcNow < deadline);

        return condition();
    }
}

[CollectionDefinition("Native UI", DisableParallelization = true)]
public sealed class NativeUiTestScope;

internal sealed class NativeAppSession : IDisposable
{
    private readonly Application _application;
    private readonly UIA3Automation _automation;
    private readonly string _executable;
    private readonly string? _evidenceDirectory;
    private readonly string _settingsDirectory;

    private NativeAppSession(
        Application application,
        UIA3Automation automation,
        Window window,
        string settingsDirectory,
        string executable,
        string? evidenceDirectory)
    {
        _application = application;
        _automation = automation;
        _executable = executable;
        _evidenceDirectory = evidenceDirectory;
        _settingsDirectory = settingsDirectory;
        Window = window;
    }

    public Window Window { get; }

    public bool HasExited => _application.HasExited;

    public static NativeAppSession Start()
    {
        string executable = FindExecutable();
        string settingsDirectory = Path.Combine(
            Path.GetTempPath(),
            $"plcw-native-ui-{Guid.NewGuid():N}");
        Directory.CreateDirectory(settingsDirectory);
        string settingsPath = Path.Combine(settingsDirectory, "palette.json");
        string? evidenceDirectory = CreateEvidenceDirectory();
        string? previousSettingsPath = Environment.GetEnvironmentVariable("PLCW_PALETTE_SETTINGS_PATH");
        string? previousDataRoot = Environment.GetEnvironmentVariable("PLCW_DATA_ROOT");
        Environment.SetEnvironmentVariable("PLCW_PALETTE_SETTINGS_PATH", settingsPath);
        Environment.SetEnvironmentVariable("PLCW_DATA_ROOT", settingsDirectory);
        Application application;
        try
        {
            application = Application.Launch(executable);
        }
        catch
        {
            Directory.Delete(settingsDirectory, recursive: true);
            throw;
        }
        finally
        {
            Environment.SetEnvironmentVariable("PLCW_PALETTE_SETTINGS_PATH", previousSettingsPath);
            Environment.SetEnvironmentVariable("PLCW_DATA_ROOT", previousDataRoot);
        }

        var automation = new UIA3Automation();
        DateTime deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
        Window? window;
        do
        {
            window = application.GetMainWindow(automation);
            if (window is not null)
            {
                return new NativeAppSession(
                    application,
                    automation,
                    window,
                    settingsDirectory,
                    executable,
                    evidenceDirectory);
            }

            Thread.Sleep(200);
        }
        while (DateTime.UtcNow < deadline && !application.HasExited);

        automation.Dispose();
        application.Dispose();
        Directory.Delete(settingsDirectory, recursive: true);
        throw new InvalidOperationException("네이티브 앱의 주 창을 찾지 못했습니다.");
    }

    public AutomationElement FindByAutomationId(string automationId)
        => Window.FindFirstDescendant(condition => condition.ByAutomationId(automationId))
            ?? throw new InvalidOperationException($"AutomationId를 찾지 못했습니다: {automationId}");

    public AutomationElement WaitForAutomationId(string automationId, TimeSpan? timeout = null)
    {
        DateTime deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(5));
        AutomationElement? element;
        do
        {
            element = Window.FindFirstDescendant(condition => condition.ByAutomationId(automationId));
            if (element is not null)
            {
                return element;
            }

            Thread.Sleep(150);
        }
        while (DateTime.UtcNow < deadline && !_application.HasExited);

        throw new InvalidOperationException($"AutomationId를 찾지 못했습니다: {automationId}");
    }

    public bool ExistsByAutomationId(string automationId)
        => Window.FindFirstDescendant(condition => condition.ByAutomationId(automationId)) is not null;

    public AutomationElement WaitForName(string name, TimeSpan? timeout = null)
    {
        DateTime deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(5));
        AutomationElement? element;
        do
        {
            element = Window.FindFirstDescendant(condition => condition.ByName(name));
            if (element is not null)
            {
                return element;
            }

            Thread.Sleep(150);
        }
        while (DateTime.UtcNow < deadline && !_application.HasExited);

        string visibleNames = string.Join(
            " | ",
            Window.FindAllDescendants()
                .Select(SafeName)
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Take(80));
        throw new InvalidOperationException($"이름이 일치하는 UI 요소를 찾지 못했습니다: {name}. 현재 요소: {visibleNames}");
    }

    public void SelectTab(string name)
    {
        AutomationElement? element = Window.FindFirstDescendant(condition =>
            condition.ByName(name).And(condition.ByControlType(ControlType.TabItem)));
        if (element is null)
        {
            throw new InvalidOperationException($"탭을 찾지 못했습니다: {name}");
        }

        element.AsTabItem().Select();
    }

    public static void ActivateListItem(AutomationElement descendant)
    {
        AutomationElement? item = descendant;
        while (item is not null && item.ControlType != ControlType.ListItem)
        {
            item = item.Parent;
        }

        if (item is null)
        {
            throw new InvalidOperationException($"목록 항목을 찾지 못했습니다: {descendant.Name}");
        }

        item.AsListBoxItem().Select();
    }

    private static string SafeName(AutomationElement element)
    {
        try
        {
            return element.Name;
        }
        catch (FlaUI.Core.Exceptions.PropertyNotSupportedException)
        {
            return string.Empty;
        }
    }

    public void Dispose()
    {
        TryWriteEvidence();
        try
        {
            if (!_application.HasExited)
            {
                _application.Close();
                DateTime deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
                while (!_application.HasExited && DateTime.UtcNow < deadline)
                {
                    Thread.Sleep(100);
                }

                if (!_application.HasExited)
                {
                    _application.Kill();
                }
            }

            AppendCleanupEvidence();
        }
        finally
        {
            _automation.Dispose();
            _application.Dispose();
            if (Directory.Exists(_settingsDirectory))
            {
                Directory.Delete(_settingsDirectory, recursive: true);
            }
        }
    }

    private static string? CreateEvidenceDirectory()
    {
        string? root = Environment.GetEnvironmentVariable("PLCW_UI_EVIDENCE_ROOT");
        if (string.IsNullOrWhiteSpace(root))
        {
            return null;
        }

        string directory = Path.Combine(
            Path.GetFullPath(root),
            $"{DateTime.UtcNow:yyyyMMddTHHmmssfffZ}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        return directory;
    }

    private void TryWriteEvidence()
    {
        if (_evidenceDirectory is null)
        {
            return;
        }

        try
        {
            Window.CaptureToFile(Path.Combine(_evidenceDirectory, "window.png"));
            string tree = string.Join(
                Environment.NewLine,
                Window.FindAllDescendants().Select(element =>
                    $"{element.ControlType}\t{element.AutomationId}\t{SafeName(element)}\t{element.BoundingRectangle}"));
            File.WriteAllText(Path.Combine(_evidenceDirectory, "uia-tree.txt"), tree);

            var version = FileVersionInfo.GetVersionInfo(_executable);
            string metadata = string.Join(
                Environment.NewLine,
                $"utc={DateTime.UtcNow:O}",
                $"exe={_executable}",
                $"fileVersion={version.FileVersion}",
                $"sha256={Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(_executable)))}",
                $"processId={_application.ProcessId}",
                $"windowBounds={Window.BoundingRectangle}",
                $"displayProfile={Environment.GetEnvironmentVariable("PLCW_DISPLAY_PROFILE")}",
                $"hasExitedBeforeCleanup={_application.HasExited}");
            File.WriteAllText(Path.Combine(_evidenceDirectory, "run.txt"), metadata);
        }
        catch (Exception exception)
        {
            File.WriteAllText(Path.Combine(_evidenceDirectory, "evidence-error.txt"), exception.ToString());
        }
    }

    private void AppendCleanupEvidence()
    {
        if (_evidenceDirectory is null)
        {
            return;
        }

        File.AppendAllText(
            Path.Combine(_evidenceDirectory, "run.txt"),
            $"{Environment.NewLine}hasExitedAfterCleanup={_application.HasExited}{Environment.NewLine}");
    }

    private static string FindExecutable()
    {
        string? overridePath = Environment.GetEnvironmentVariable("PLCW_NATIVE_EXE");
        if (!string.IsNullOrWhiteSpace(overridePath))
        {
            string fullOverridePath = Path.GetFullPath(overridePath);
            return File.Exists(fullOverridePath)
                ? fullOverridePath
                : throw new FileNotFoundException("PLCW_NATIVE_EXE가 가리키는 EXE를 찾지 못했습니다.", fullOverridePath);
        }

        DirectoryInfo? directory = new(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "PlcWiringTrainer.slnx")))
        {
            directory = directory.Parent;
        }

        if (directory is null)
        {
            throw new FileNotFoundException("솔루션 루트를 찾지 못했습니다.");
        }

        string executable = Path.Combine(
            directory.FullName,
            "native",
            "PlcWiringTrainer.App",
            "bin",
            "x64",
            "Debug",
            "net10.0-windows10.0.26100.0",
            "win-x64",
            "PlcWiringTrainer.exe");
        return File.Exists(executable)
            ? executable
            : throw new FileNotFoundException("테스트할 EXE를 찾지 못했습니다. 먼저 Debug x64 빌드를 실행하십시오.", executable);
    }

}
