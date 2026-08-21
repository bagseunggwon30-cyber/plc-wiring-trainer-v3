using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.UIA3;

namespace PlcWiringTrainer.UiTests;

[Collection("Native UI")]
public sealed class NativeWorkbenchUiTests
{
    [Fact]
    public void NativeWindowExposesPaletteCanvasInspectorAndValidation()
    {
        using var session = NativeAppSession.Start();

        Assert.Equal("PLC Wiring Trainer 4.0", session.Window.Title);
        Assert.NotNull(session.FindByAutomationId("DevicePalette"));
        Assert.NotNull(session.FindByAutomationId("WiringCanvas"));
        Assert.NotNull(session.FindByAutomationId("InspectorTabs"));
        Assert.NotNull(session.FindByAutomationId("SaveDocumentButton"));
        session.SaveEvidenceScreenshot();
        session.SelectTab("결선 검증");
        Assert.NotNull(session.WaitForAutomationId("ValidationIssueList"));
    }

    [Fact]
    public void ClickingValidationIssueFocusesItsActualConductorAndUpdatesProperties()
    {
        using var session = NativeAppSession.Start();
        session.SelectTab("결선 검증");

        AutomationElement issue = session.WaitForName("NPN_INPUT_COMMON_POLARITY", TimeSpan.FromSeconds(12));
        session.ActivateListItem(issue);

        AutomationElement canvas = session.FindByAutomationId("WiringCanvas");
        bool focusedWire = WaitUntil(
            () => canvas.Name.Contains("plc-common-wrong", StringComparison.Ordinal),
            TimeSpan.FromSeconds(5));
        Assert.True(focusedWire, $"캔버스 접근성 이름이 문제 전선을 가리키지 않습니다: {canvas.Name}");

        TextBox label = session.FindByAutomationId("ConductorLabelBox").AsTextBox();
        Assert.Equal("W004", label.Text);
        label.Text = "W-ERR-01";
        Assert.Equal("W-ERR-01", label.Text);
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
public sealed class NativeUiCollection;

internal sealed class NativeAppSession : IDisposable
{
    private readonly Application _application;
    private readonly UIA3Automation _automation;

    private NativeAppSession(Application application, UIA3Automation automation, Window window)
    {
        _application = application;
        _automation = automation;
        Window = window;
    }

    public Window Window { get; }

    public static NativeAppSession Start()
    {
        string executable = FindExecutable();
        Application application = Application.Launch(executable);
        var automation = new UIA3Automation();
        DateTime deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
        Window? window;
        do
        {
            window = application.GetMainWindow(automation);
            if (window is not null)
            {
                return new NativeAppSession(application, automation, window);
            }

            Thread.Sleep(200);
        }
        while (DateTime.UtcNow < deadline && !application.HasExited);

        automation.Dispose();
        application.Dispose();
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

    public void ActivateListItem(AutomationElement descendant)
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
        item.Click();
    }

    public void SaveEvidenceScreenshot()
    {
        string? path = Environment.GetEnvironmentVariable("PLCW_UI_EVIDENCE_PATH");
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        string fullPath = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        Window.CaptureToFile(fullPath);
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
        }
        finally
        {
            _automation.Dispose();
            _application.Dispose();
        }
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
