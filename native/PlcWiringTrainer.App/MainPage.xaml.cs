using System.Collections.ObjectModel;
using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using PlcWiringTrainer.App.Controls;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Navigation;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Workbench;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace PlcWiringTrainer.App;

public sealed class PaletteItem
{
    public PaletteItem()
    {
    }

    public PaletteItem(string profileId, string displayName, string assetUri)
    {
        ProfileId = profileId;
        DisplayName = displayName;
        AssetUri = assetUri;
    }

    public string ProfileId { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public string AssetUri { get; set; } = string.Empty;
}

public sealed class ValidationIssueItem
{
    public ValidationIssueItem(ValidationIssueV4 issue)
    {
        Issue = issue;
        Code = issue.Code;
        Message = issue.Message;
        SeverityLabel = issue.Severity switch
        {
            ValidationSeverity.Error => "오류",
            ValidationSeverity.Warning => "경고",
            _ => "정보",
        };
        BlockingLabel = issue.Blocking ? "작동 차단 문제 · 눌러서 이동" : "안내 · 눌러서 이동";
        BadgeBrush = new SolidColorBrush(issue.Severity switch
        {
            ValidationSeverity.Error => ColorHelper.FromArgb(255, 220, 38, 38),
            ValidationSeverity.Warning => ColorHelper.FromArgb(255, 217, 119, 6),
            _ => ColorHelper.FromArgb(255, 2, 132, 199),
        });
    }

    public ValidationIssueV4 Issue { get; }

    public string Code { get; }

    public string Message { get; }

    public string SeverityLabel { get; }

    public string BlockingLabel { get; }

    public Brush BadgeBrush { get; }
}

public sealed partial class MainPage : Page
{
    private readonly DeviceProfileCatalog _catalog = DeviceProfileCatalog.CreateDefault();
    private readonly WorkshopDocumentRepository _repository;
    private WorkbenchStore? _store;
    private CanvasSelection _selection = CanvasSelection.Empty;
    private CancellationTokenSource? _autosaveCancellation;
    private string? _currentPath;
    private int _lastAutosaveRevision;
    private bool _refreshingInspector;

    public MainPage()
    {
        string appData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PLC Wiring Trainer");
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(appData, "Import Backups"),
            Path.Combine(appData, "Quarantine"));
        _repository = new WorkshopDocumentRepository(migrator, Path.Combine(appData, "Autosave"));

        foreach (DeviceProfileV4 profile in _catalog.Profiles.Where(profile => profile.IsPaletteVisible))
        {
            PaletteItems.Add(new PaletteItem(
                profile.Id,
                profile.DisplayName,
                $"ms-appx:///{profile.AssetPath}"));
        }

        InitializeComponent();
        AttachStore(CreateExampleDocument());
    }

    public ObservableCollection<PaletteItem> PaletteItems { get; } = [];

    public ObservableCollection<ValidationIssueItem> ValidationItems { get; } = [];

    private WorkbenchStore Store => _store ?? throw new InvalidOperationException("작업 문서가 초기화되지 않았습니다.");

    private void Page_Loaded(object sender, RoutedEventArgs e)
    {
        RefreshFromStore();
        StatusText.Text = "단자를 두 번 눌러 직교 전선을 만들 수 있습니다. 가운데/오른쪽 버튼으로 이동, 휠로 확대합니다.";
    }

    private async void Page_Unloaded(object sender, RoutedEventArgs e)
    {
        _autosaveCancellation?.Cancel();
        _autosaveCancellation?.Dispose();
        _autosaveCancellation = null;
        if (_store is not null)
        {
            _store.Changed -= Store_Changed;
            await _store.DisposeAsync();
            _store = null;
        }
    }

    private async void New_Click(object sender, RoutedEventArgs e)
    {
        await ReplaceStoreAsync(CreateEmptyDocument());
        _currentPath = null;
        WiringCanvas.ResetView();
        StatusText.Text = "새 v4 문서를 만들었습니다.";
    }

    private async void Open_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var picker = new FileOpenPicker
            {
                SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
                ViewMode = PickerViewMode.List,
            };
            picker.FileTypeFilter.Add(".plcw");
            picker.FileTypeFilter.Add(".json");
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(App.MainWindow));
            Windows.Storage.StorageFile? file = await picker.PickSingleFileAsync();
            if (file is null)
            {
                return;
            }

            MigrationResult result = await _repository.LoadAsync(file.Path);
            if (result.Document is null)
            {
                StatusText.Text = $"문서를 열 수 없어 격리했습니다: {result.Error}";
                return;
            }

            await ReplaceStoreAsync(result.Document);
            _currentPath = result.Status == MigrationStatus.AlreadyV4 ? file.Path : null;
            WiringCanvas.ResetView();
            StatusText.Text = result.Status == MigrationStatus.Converted
                ? $"레거시 문서를 v4로 변환했습니다. 원본 백업: {result.BackupPath}"
                : $"문서를 열었습니다: {file.Name}";
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            StatusText.Text = $"열기 실패: {exception.Message}";
        }
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            string? path = _currentPath;
            if (string.IsNullOrWhiteSpace(path))
            {
                var picker = new FileSavePicker
                {
                    SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
                    SuggestedFileName = SanitizeFileName(Store.Document.Name),
                };
                picker.FileTypeChoices.Add("PLC Wiring Trainer 문서", [".plcw"]);
                InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(App.MainWindow));
                Windows.Storage.StorageFile? file = await picker.PickSaveFileAsync();
                if (file is null)
                {
                    return;
                }

                path = file.Path;
            }

            await _repository.SaveAsync(path, Store.Document);
            _currentPath = path;
            StatusText.Text = $"저장했습니다: {path}";
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            StatusText.Text = $"저장 실패: {exception.Message}";
        }
    }

    private void Undo_Click(object sender, RoutedEventArgs e)
    {
        if (Store.Undo())
        {
            StatusText.Text = "실행을 취소했습니다.";
        }
    }

    private void Redo_Click(object sender, RoutedEventArgs e)
    {
        if (Store.Redo())
        {
            StatusText.Text = "취소한 작업을 다시 실행했습니다.";
        }
    }

    private void Validate_Click(object sender, RoutedEventArgs e)
    {
        Store.Revalidate();
        InspectorTabs.SelectedIndex = 1;
        StatusText.Text = "결선 검증을 다시 실행합니다.";
    }

    private void ResetView_Click(object sender, RoutedEventArgs e) => WiringCanvas.ResetView();

    private void PaletteList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not PaletteItem item || !_catalog.TryGet(item.ProfileId, out DeviceProfileV4 profile))
        {
            return;
        }

        int index = Store.Document.Devices.Length + 1;
        string id = $"device-{Guid.NewGuid():N}";
        double x = 100 + ((index % 5) * 145);
        double y = 100 + ((index / 5) * 120);
        Store.AddDevice(new DeviceInstanceV4(
            id,
            profile.Id,
            profile.Version,
            profile.EvidenceGrade,
            profile.DisplayName,
            x,
            y,
            0,
            120,
            80,
            false,
            new Dictionary<string, string>()));
        StatusText.Text = $"{profile.DisplayName} 장비를 배치했습니다.";
    }

    private void WiringCanvas_SelectionChanged(object? sender, CanvasSelection selection)
    {
        _selection = selection;
        RefreshInspector();
    }

    private void WiringCanvas_WireCreationRequested(
        object? sender,
        (TerminalRefV4 Start, TerminalRefV4 End) terminals)
    {
        bool exists = Store.Document.Conductors.Any(conductor =>
            (conductor.Start == terminals.Start && conductor.End == terminals.End)
            || (conductor.Start == terminals.End && conductor.End == terminals.Start));
        if (exists)
        {
            StatusText.Text = "두 단자는 이미 전선으로 연결되어 있습니다.";
            return;
        }

        int wireNumber = Store.Document.Conductors.Length + 1;
        Store.AddConductor(new ConductorV4(
            $"wire-{Guid.NewGuid():N}",
            terminals.Start,
            terminals.End,
            [],
            $"W{wireNumber:000}",
            "#EF4444",
            0.75,
            false));
        StatusText.Text = $"{terminals.Start.Key} ↔ {terminals.End.Key} 전선을 만들었습니다.";
    }

    private void WiringCanvas_DeviceMoveRequested(
        object? sender,
        (string DeviceId, double X, double Y) move)
    {
        Store.UpdateDevice(move.DeviceId, device => device with
        {
            X = Snap(move.X),
            Y = Snap(move.Y),
        });
    }

    private void ValidationList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not ValidationIssueItem item)
        {
            return;
        }

        NavigationTarget? target = IssueNavigator.Resolve(Store.Document, item.Issue);
        if (target is null)
        {
            StatusText.Text = "문제 대상이 편집 중 삭제되어 이동할 수 없습니다.";
            return;
        }

        WiringCanvas.NavigateTo(target);
        InspectorTabs.SelectedIndex = 0;
        StatusText.Text = $"문제 위치로 이동했습니다: {item.Code}";
    }

    private void DeviceLabelBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_refreshingInspector || _selection.Kind != CanvasSelectionKind.Device)
        {
            return;
        }

        Store.UpdateDevice(_selection.Id, device => device with { Label = DeviceLabelBox.Text.Trim() });
    }

    private void DeviceNumberBox_ValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (_refreshingInspector || _selection.Kind != CanvasSelectionKind.Device || !DeviceValuesAreValid())
        {
            return;
        }

        Store.UpdateDevice(_selection.Id, device => device with
        {
            X = DeviceXBox.Value,
            Y = DeviceYBox.Value,
            Width = Math.Max(40, DeviceWidthBox.Value),
            Height = Math.Max(40, DeviceHeightBox.Value),
            Rotation = NormalizeRotation(DeviceRotationBox.Value),
        });
    }

    private void DeviceLockedBox_Click(object sender, RoutedEventArgs e)
    {
        if (!_refreshingInspector && _selection.Kind == CanvasSelectionKind.Device)
        {
            Store.UpdateDevice(_selection.Id, device => device with { Locked = DeviceLockedBox.IsChecked == true });
        }
    }

    private void ConductorLabelBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (!_refreshingInspector && _selection.Kind == CanvasSelectionKind.Conductor)
        {
            Store.UpdateConductor(_selection.Id, conductor => conductor with { Label = ConductorLabelBox.Text.Trim() });
        }
    }

    private void ConductorColorBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_refreshingInspector
            || _selection.Kind != CanvasSelectionKind.Conductor
            || !IsHexColor(ConductorColorBox.Text))
        {
            return;
        }

        Store.UpdateConductor(_selection.Id, conductor => conductor with { Color = ConductorColorBox.Text.ToUpperInvariant() });
    }

    private void ConductorGaugeBox_ValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (!_refreshingInspector
            && _selection.Kind == CanvasSelectionKind.Conductor
            && !double.IsNaN(ConductorGaugeBox.Value))
        {
            Store.UpdateConductor(
                _selection.Id,
                conductor => conductor with { GaugeMm2 = Math.Max(0.1, ConductorGaugeBox.Value) });
        }
    }

    private void ConductorLockedBox_Click(object sender, RoutedEventArgs e)
    {
        if (!_refreshingInspector && _selection.Kind == CanvasSelectionKind.Conductor)
        {
            Store.UpdateConductor(
                _selection.Id,
                conductor => conductor with { RouteLocked = ConductorLockedBox.IsChecked == true });
        }
    }

    private void Store_Changed(object? sender, EventArgs e)
    {
        DispatcherQueue.TryEnqueue(RefreshFromStore);
    }

    private void RefreshFromStore()
    {
        if (_store is null)
        {
            return;
        }

        WiringCanvas.Refresh();
        UndoButton.IsEnabled = Store.CanUndo;
        RedoButton.IsEnabled = Store.CanRedo;
        DocumentTitleText.Text = Store.Document.Name;
        RevisionText.Text = $"rev {Store.Document.Revision} · {Store.Document.ContentHash[..8]}";
        RefreshInspector();
        RefreshValidation();

        if (Store.Document.Revision != _lastAutosaveRevision)
        {
            _lastAutosaveRevision = Store.Document.Revision;
            ScheduleAutosave(Store.Document);
        }
    }

    private void RefreshValidation()
    {
        ValidationFreshnessText.Text = Store.ValidationFreshness switch
        {
            ValidationFreshness.Stale => "STALE · 편집 내용이 바뀌어 결과를 다시 계산합니다.",
            ValidationFreshness.Running => "RUNNING · 백그라운드에서 결선을 계산 중입니다.",
            _ => $"CURRENT · rev {Store.ValidationResult?.Revision}",
        };

        ValidationItems.Clear();
        if (Store.ValidationResult is null)
        {
            ValidationSummaryText.Text = "검증 대기";
            return;
        }

        foreach (ValidationIssueV4 issue in Store.ValidationResult.Issues)
        {
            ValidationItems.Add(new ValidationIssueItem(issue));
        }

        int blocking = Store.ValidationResult.Issues.Count(issue => issue.Blocking);
        ValidationSummaryText.Text = blocking == 0
            ? $"차단 오류 없음 · 안내 {Store.ValidationResult.Issues.Length}건"
            : $"차단 오류 {blocking}건 · 전체 {Store.ValidationResult.Issues.Length}건";
    }

    private void RefreshInspector()
    {
        if (_store is null)
        {
            return;
        }

        _refreshingInspector = true;
        try
        {
            NoSelectionPanel.Visibility = Visibility.Collapsed;
            DevicePropertiesPanel.Visibility = Visibility.Collapsed;
            ConductorPropertiesPanel.Visibility = Visibility.Collapsed;
            TerminalPropertiesPanel.Visibility = Visibility.Collapsed;

            if (_selection.Kind == CanvasSelectionKind.Device)
            {
                DeviceInstanceV4? device = Store.Document.Devices.FirstOrDefault(item => item.Id == _selection.Id);
                if (device is null)
                {
                    NoSelectionPanel.Visibility = Visibility.Visible;
                    return;
                }

                DevicePropertiesPanel.Visibility = Visibility.Visible;
                DeviceLabelBox.Text = device.Label;
                DeviceXBox.Value = device.X;
                DeviceYBox.Value = device.Y;
                DeviceWidthBox.Value = device.Width;
                DeviceHeightBox.Value = device.Height;
                DeviceRotationBox.Value = device.Rotation;
                DeviceLockedBox.IsChecked = device.Locked;
                DeviceProfileText.Text = $"{device.ProfileId} · version {device.ProfileVersion}";
                DeviceEvidenceText.Text = device.EvidenceGrade == EvidenceGrade.Educational
                    ? "근거 등급: 교육용 · 매뉴얼 검증 자산으로 표시하지 않음"
                    : $"근거 등급: {device.EvidenceGrade}";
                return;
            }

            if (_selection.Kind == CanvasSelectionKind.Conductor)
            {
                ConductorV4? conductor = Store.Document.Conductors.FirstOrDefault(item => item.Id == _selection.Id);
                if (conductor is null)
                {
                    NoSelectionPanel.Visibility = Visibility.Visible;
                    return;
                }

                ConductorPropertiesPanel.Visibility = Visibility.Visible;
                ConductorLabelBox.Text = conductor.Label;
                ConductorColorBox.Text = conductor.Color;
                ConductorGaugeBox.Value = conductor.GaugeMm2;
                ConductorLockedBox.IsChecked = conductor.RouteLocked;
                ConductorEndpointsText.Text = $"{conductor.Start.Key} ↔ {conductor.End.Key}";
                return;
            }

            if (_selection.Kind == CanvasSelectionKind.Terminal)
            {
                TerminalPropertiesPanel.Visibility = Visibility.Visible;
                TerminalReferenceText.Text = _selection.Id;
                return;
            }

            NoSelectionPanel.Visibility = Visibility.Visible;
        }
        finally
        {
            _refreshingInspector = false;
        }
    }

    private void AttachStore(WorkshopDocumentV4 document)
    {
        _store = new WorkbenchStore(document, new CircuitValidationService(_catalog));
        _store.Changed += Store_Changed;
        WiringCanvas.Store = _store;
        _selection = CanvasSelection.Empty;
        _lastAutosaveRevision = 0;
    }

    private async Task ReplaceStoreAsync(WorkshopDocumentV4 document)
    {
        WorkbenchStore? previous = _store;
        if (previous is not null)
        {
            previous.Changed -= Store_Changed;
        }

        AttachStore(document);
        if (previous is not null)
        {
            await previous.DisposeAsync();
        }

        RefreshFromStore();
    }

    private void ScheduleAutosave(WorkshopDocumentV4 snapshot)
    {
        _autosaveCancellation?.Cancel();
        _autosaveCancellation?.Dispose();
        _autosaveCancellation = new CancellationTokenSource();
        _ = AutosaveAfterDelayAsync(snapshot, _autosaveCancellation.Token);
    }

    private async Task AutosaveAfterDelayAsync(WorkshopDocumentV4 snapshot, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(700, cancellationToken);
            await _repository.SaveAutosaveAsync(snapshot, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            DispatcherQueue.TryEnqueue(() => StatusText.Text = $"자동 복구본 저장 실패: {exception.Message}");
        }
    }

    private double Snap(double value)
    {
        if (!Store.Document.Settings.SnapToGrid)
        {
            return value;
        }

        double grid = Math.Max(1, Store.Document.Settings.GridSize);
        return Math.Round(value / grid) * grid;
    }

    private bool DeviceValuesAreValid()
        => !double.IsNaN(DeviceXBox.Value)
            && !double.IsNaN(DeviceYBox.Value)
            && !double.IsNaN(DeviceWidthBox.Value)
            && !double.IsNaN(DeviceHeightBox.Value)
            && !double.IsNaN(DeviceRotationBox.Value);

    private static double NormalizeRotation(double value)
    {
        double normalized = value % 360;
        return normalized < 0 ? normalized + 360 : normalized;
    }

    private static bool IsHexColor(string value)
        => value.Length == 7
            && value[0] == '#'
            && value.AsSpan(1).ToString().All(Uri.IsHexDigit);

    private static string SanitizeFileName(string value)
    {
        string cleaned = string.Concat(value.Select(character =>
            Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        return string.IsNullOrWhiteSpace(cleaned) ? "wiring-panel" : cleaned;
    }

    private static WorkshopDocumentV4 CreateEmptyDocument()
    {
        var document = new WorkshopDocumentV4
        {
            DocumentId = Guid.NewGuid().ToString("D"),
            Revision = 1,
            Name = "새 결선 문서",
            Devices = [],
            Conductors = [],
            Jumpers = [],
            Panel = new PanelLayoutV4(1500, 950),
            Viewport = new ViewportV4(1, 40, 40),
            Settings = new WorkshopSettingsV4(10, true),
            Extensions = new Dictionary<string, JsonElement>(),
        };
        return DocumentHasher.WithContentHash(document);
    }

    private static WorkshopDocumentV4 CreateExampleDocument()
    {
        DeviceInstanceV4 supply = Device("supply", "dc-supply-24v", 1, "DC 24 V 전원", 80, 270);
        DeviceInstanceV4 sensor = Device("sensor-npn", "prox-npn-v2", 2, "NPN 근접 센서", 330, 120);
        DeviceInstanceV4 plc = Device("plc-input", "plc-input-24v", 1, "PLC DC 입력", 650, 120);
        DeviceInstanceV4 lamp = Device("lamp-green", "lamp-green-v1", 1, "녹색 표시등", 650, 360);
        WorkshopDocumentV4 document = CreateEmptyDocument() with
        {
            DocumentId = "starter-panel",
            Name = "NPN 결선 점검 예제",
            Devices = [supply, sensor, plc, lamp],
            Conductors =
            [
                Wire("sensor-plus", "W001", "supply", "+24V", "sensor-npn", "BN", "#EF4444"),
                Wire("sensor-zero", "W002", "supply", "0V", "sensor-npn", "BU", "#3B82F6"),
                Wire("sensor-signal", "W003", "sensor-npn", "BK", "plc-input", "I0", "#111827"),
                // NPN sinking 입력은 COM이 +24V여야 하므로 이 예제에는 의도적으로 찾을 수 있는 오류를 둡니다.
                Wire("plc-common-wrong", "W004", "plc-input", "COM", "supply", "0V", "#3B82F6"),
                Wire("lamp-plus", "W005", "supply", "+24V", "lamp-green", "A1", "#EF4444"),
                Wire("lamp-zero", "W006", "lamp-green", "A2", "supply", "0V", "#3B82F6"),
            ],
        };
        return DocumentHasher.WithContentHash(document);
    }

    private static DeviceInstanceV4 Device(
        string id,
        string profileId,
        int profileVersion,
        string label,
        double x,
        double y)
        => new(
            id,
            profileId,
            profileVersion,
            EvidenceGrade.Educational,
            label,
            x,
            y,
            0,
            150,
            100,
            false,
            new Dictionary<string, string>());

    private static ConductorV4 Wire(
        string id,
        string label,
        string startDevice,
        string startTerminal,
        string endDevice,
        string endTerminal,
        string color)
        => new(
            id,
            new TerminalRefV4(startDevice, startTerminal),
            new TerminalRefV4(endDevice, endTerminal),
            [],
            label,
            color,
            0.75,
            false);
}
