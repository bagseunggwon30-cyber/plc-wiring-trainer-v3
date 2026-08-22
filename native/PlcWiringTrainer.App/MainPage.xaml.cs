using System.Collections.ObjectModel;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using PlcWiringTrainer.App.Controls;
using PlcWiringTrainer.App.Presentation;
using PlcWiringTrainer.App.Services;
using PlcWiringTrainer.App.Workbench;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Navigation;
using PlcWiringTrainer.Core.Reports;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Wiring;
using PlcWiringTrainer.Core.Workbench;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage.Pickers;
using Windows.System;
using WinRT.Interop;

namespace PlcWiringTrainer.App;

public sealed partial class WorkbenchShell : Page, IAsyncDisposable
{
    private readonly DeviceProfileCatalog _catalog;
    private readonly IConnectionAssessmentService _connectionAssessment;
    private readonly IReportExporter _reportExporter;
    private readonly PaletteController _palette;
    private readonly DocumentSessionController _session;
    private readonly WorkbenchCommandDispatcher _commands;
    private CanvasSelection _selection = CanvasSelection.Empty;
    private bool _refreshingInspector;
    private bool _refreshingValidationItems;
    private bool _paletteEditMode;
    private PointV5 _quickInsertWorld = new(100, 100);

    public WorkbenchShell()
    {
        AppServices services = AppServices.CreateDefault();
        _catalog = services.Catalog;
        _connectionAssessment = services.ConnectionAssessment;
        _reportExporter = services.ReportExporter;
        _session = new DocumentSessionController(_catalog, services.Repository);
        _session.Changed += Store_Changed;
        _session.AutosaveFailed += Session_AutosaveFailed;
        _palette = services.Palette;
        _commands = new WorkbenchCommandDispatcher(() => Store);

        InitializeComponent();
        ApplyPalettePaneState();
        RefreshPalette();
        _session.Initialize(CreateExampleDocument());
        WiringCanvas.Store = Store;
    }

    public ObservableCollection<PaletteItem> PaletteItems { get; } = [];

    public ObservableCollection<ValidationIssueItem> ValidationItems { get; } = [];

    public ObservableCollection<PaletteItem> QuickInsertItems { get; } = [];

    private WorkbenchStore Store => _session.Store;

    private void Page_Loaded(object sender, RoutedEventArgs e)
    {
        RefreshFromStore();
        WiringCanvas.ResetView();
        StatusText.Text = "단자를 두 번 눌러 직교 전선을 만들 수 있습니다. 가운데/오른쪽 버튼으로 이동, 휠로 확대합니다.";
    }

    private async void Page_Unloaded(object sender, RoutedEventArgs e)
        => await DisposeAsync();

    public async ValueTask DisposeAsync()
    {
        _session.Changed -= Store_Changed;
        _session.AutosaveFailed -= Session_AutosaveFailed;
        await _session.DisposeAsync();
    }

    private async void New_Click(object sender, RoutedEventArgs e)
    {
        await ReplaceStoreAsync(CreateEmptyDocument(), null);
        WiringCanvas.ResetView();
        StatusText.Text = "새 v5 문서를 만들었습니다.";
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

            MigrationResult result = await _session.LoadAsync(file.Path);
            if (result.Document is null)
            {
                StatusText.Text = $"문서를 열 수 없어 격리했습니다: {result.Error}";
                return;
            }

            await ReplaceStoreAsync(
                result.Document,
                result.Status == MigrationStatus.AlreadyV5 ? file.Path : null);
            WiringCanvas.ResetView();
            StatusText.Text = result.Status == MigrationStatus.Converted
                ? $"레거시 문서를 v5로 변환했습니다. 원본 백업: {result.BackupPath}"
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
            string? path = _session.CurrentPath;
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

            await _session.SaveAsync(path);
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

    private void WorkspaceNavigation_SelectionChanged(
        NavigationView sender,
        NavigationViewSelectionChangedEventArgs args)
    {
        string workspace = (args.SelectedItemContainer?.Tag as string) ?? "placement";
        switch (workspace)
        {
            case "validation":
                InspectorTabs.SelectedIndex = 1;
                StatusText.Text = "검증 작업공간 · 문제를 누르면 실제 결선으로 이동합니다.";
                break;
            case "wiring":
                InspectorTabs.SelectedIndex = 0;
                StatusText.Text = "결선 작업공간 · 단자 클릭 또는 드래그로 결선합니다.";
                break;
            default:
                InspectorTabs.SelectedIndex = 0;
                StatusText.Text = "패널 배치 작업공간 · 장비를 배치하고 속성을 편집합니다.";
                break;
        }
    }

    private void PalettePaneToggle_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            _palette.SetPaneOpen(PalettePaneToggle.IsChecked == true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            StatusText.Text = $"팔레트 설정 저장 실패: {exception.Message}";
            ApplyPalettePaneState();
            return;
        }

        ApplyPalettePaneState();
    }

    private void ApplyPalettePaneState()
    {
        PalettePaneToggle.IsChecked = _palette.IsPaneOpen;
        PaletteColumn.Width = _palette.IsPaneOpen ? new GridLength(250) : new GridLength(0);
        PalettePane.Visibility = _palette.IsPaneOpen ? Visibility.Visible : Visibility.Collapsed;
    }

    private void PaletteList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (_paletteEditMode)
        {
            return;
        }

        if (e.ClickedItem is not PaletteItem item || !_catalog.TryGet(item.ProfileId, out DeviceProfileV5 profile))
        {
            return;
        }

        if (!item.CanPlace)
        {
            StatusText.Text = $"{profile.DisplayName}은(는) 단자 보정이 끝나기 전까지 배치할 수 없습니다.";
            return;
        }

        int index = Store.Document.Devices.Length + 1;
        double x = 100 + ((index % 5) * 145);
        double y = 100 + ((index / 5) * 120);
        PlaceDevice(profile, x, y);
    }

    private async void ExportCanonicalJson_Click(object sender, RoutedEventArgs e)
        => await ExportReportAsync(ReportKindV5.CanonicalJson, "Canonical JSON", ".json");

    private async void ExportPinToPinCsv_Click(object sender, RoutedEventArgs e)
        => await ExportReportAsync(ReportKindV5.PinToPinCsv, "Pin-to-pin CSV", ".csv");

    private async void ExportCableCoreCsv_Click(object sender, RoutedEventArgs e)
        => await ExportReportAsync(ReportKindV5.CableCoreCsv, "Cable/core CSV", ".csv");

    private async void ExportTerminalPlanCsv_Click(object sender, RoutedEventArgs e)
        => await ExportReportAsync(ReportKindV5.TerminalPlanCsv, "단자 계획 CSV", ".csv");

    private async void ExportBomCsv_Click(object sender, RoutedEventArgs e)
        => await ExportReportAsync(ReportKindV5.BillOfMaterialsCsv, "BOM CSV", ".csv");

    private async Task ExportReportAsync(ReportKindV5 kind, string description, string extension)
    {
        try
        {
            ReportArtifactV5 artifact = await _reportExporter.ExportAsync(
                Store.Document,
                Store.ValidationResult,
                kind);
            var picker = new FileSavePicker
            {
                SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
                SuggestedFileName = Path.GetFileNameWithoutExtension(artifact.SuggestedFileName),
            };
            picker.FileTypeChoices.Add(description, [extension]);
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(App.MainWindow));
            Windows.Storage.StorageFile? file = await picker.PickSaveFileAsync();
            if (file is null)
            {
                return;
            }

            await Windows.Storage.FileIO.WriteBytesAsync(file, artifact.Content);
            StatusText.Text = artifact.VerifiedPrewire
                ? $"VERIFIED_PREWIRE 보고서를 저장했습니다: {file.Name}"
                : $"검토용 보고서를 저장했습니다: {file.Name}";
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            StatusText.Text = $"보고서 저장 실패: {exception.Message}";
        }
    }

    private void PlaceDevice(DeviceProfileV5 profile, double x, double y)
    {
        string id = $"device-{Guid.NewGuid():N}";
        (double width, double height) = GetInitialDeviceSize(profile);
        double boundedX = Math.Clamp(x, 0, Math.Max(0, Store.Document.Panel.Width - width));
        double boundedY = Math.Clamp(y, 0, Math.Max(0, Store.Document.Panel.Height - height));
        _commands.AddDevice(new DeviceInstanceV5(
            id,
            profile.Id,
            profile.Version,
            profile.EvidenceGrade,
            profile.DisplayName,
            boundedX,
            boundedY,
            0,
            width,
            height,
            false,
            new Dictionary<string, string>())
        {
            CatalogEntryId = profile.LegacyType,
        });
        StatusText.Text = $"{profile.DisplayName} 장비를 배치했습니다.";
    }

    private void WiringCanvas_SelectionChanged(object? sender, CanvasSelection selection)
    {
        _selection = selection;
        RefreshInspector();
    }

    private void WiringCanvas_QuickInsertRequested(object? sender, CanvasQuickInsertRequest request)
    {
        _quickInsertWorld = request.World;
        QuickInsertSearchBox.Text = string.Empty;
        RefreshQuickInsertItems();
        QuickInsertFlyout.ShowAt(
            WiringCanvas,
            new FlyoutShowOptions { Position = request.Screen });
    }

    private void WiringCanvas_ConductorEditRequested(object? sender, ConductorEditRequest request)
        => _commands.Apply(request);

    private void QuickInsertFlyout_Opened(object sender, object e)
    {
        DispatcherQueue.TryEnqueue(() => QuickInsertSearchBox.Focus(FocusState.Programmatic));
    }

    private void QuickInsertSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        => RefreshQuickInsertItems();

    private void QuickInsertSearchBox_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case VirtualKey.Down:
                QuickInsertList.SelectedIndex = Math.Min(
                    QuickInsertItems.Count - 1,
                    Math.Max(0, QuickInsertList.SelectedIndex + 1));
                e.Handled = true;
                break;
            case VirtualKey.Up:
                QuickInsertList.SelectedIndex = Math.Max(0, QuickInsertList.SelectedIndex - 1);
                e.Handled = true;
                break;
            case VirtualKey.Enter:
                PlaceQuickInsertItem(QuickInsertList.SelectedItem as PaletteItem ?? QuickInsertItems.FirstOrDefault());
                e.Handled = true;
                break;
            case VirtualKey.Escape:
                QuickInsertFlyout.Hide();
                WiringCanvas.Focus(FocusState.Programmatic);
                e.Handled = true;
                break;
        }
    }

    private void QuickInsertList_ItemClick(object sender, ItemClickEventArgs e)
        => PlaceQuickInsertItem(e.ClickedItem as PaletteItem);

    private void PlaceQuickInsertItem(PaletteItem? item)
    {
        if (item is null
            || !item.CanPlace
            || _palette.IsHidden(item.ProfileId)
            || !_catalog.TryGet(item.ProfileId, out DeviceProfileV5 profile))
        {
            return;
        }

        PlaceDevice(profile, _quickInsertWorld.X, _quickInsertWorld.Y);
        QuickInsertFlyout.Hide();
        WiringCanvas.Focus(FocusState.Programmatic);
    }

    private void WiringCanvas_WireCreationRequested(
        object? sender,
        (TerminalRefV5 Start, TerminalRefV5 End, PointV5[] Waypoints) terminals)
    {
        ConnectionAssessmentV5 assessment = _connectionAssessment.Assess(
            Store.Document,
            terminals.Start,
            terminals.End);
        if (assessment.Disposition == ConnectionDispositionV5.Blocked)
        {
            StatusText.Text = $"결선 차단 [{assessment.Code}] {assessment.Message}";
            return;
        }

        int wireNumber = Store.Document.Conductors.Length + 1;
        _commands.AddConductor(new ConductorV5(
            $"wire-{Guid.NewGuid():N}",
            terminals.Start,
            terminals.End,
            terminals.Waypoints,
            $"W{wireNumber:000}",
            "#EF4444",
            0.75,
            false)
        {
            DiagnosticOverride = assessment.RequiresDiagnosticOverride,
        });
        StatusText.Text = assessment.Disposition == ConnectionDispositionV5.Warning
            ? $"경고 후 결선 [{assessment.Code}] {assessment.Message}"
            : $"{terminals.Start.Key} ↔ {terminals.End.Key} 전선을 만들었습니다.";
    }

    private void PaletteSearchBox_TextChanged(object sender, TextChangedEventArgs e) => RefreshPalette();

    private void PaletteEditButton_Click(object sender, RoutedEventArgs e)
    {
        _paletteEditMode = PaletteEditButton.IsChecked == true;
        RefreshPalette();
        StatusText.Text = _paletteEditMode
            ? "팔레트 편집 중 · 휴지통을 누르면 해당 장비가 목록에서 숨겨집니다."
            : "팔레트 편집을 마쳤습니다.";
    }

    private void PaletteHideButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { DataContext: PaletteItem item })
        {
            return;
        }

        try
        {
            _palette.Hide(item.ProfileId);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            StatusText.Text = $"팔레트 설정 저장 실패: {exception.Message}";
            RefreshPalette();
            return;
        }

        RefreshPalette();
        StatusText.Text = $"{item.DisplayName}을(를) 팔레트에서 숨겼습니다. 배치된 장비와 원본 자산은 유지됩니다.";
    }

    private void RestoreHiddenButton_Click(object sender, RoutedEventArgs e)
    {
        int restored = _palette.HiddenCount;
        try
        {
            _palette.RestoreAll();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            StatusText.Text = $"팔레트 설정 저장 실패: {exception.Message}";
            RefreshPalette();
            return;
        }

        RefreshPalette();
        StatusText.Text = $"숨긴 장비 {restored}종을 팔레트에 다시 표시했습니다.";
    }

    private void RefreshPalette()
    {
        string query = PaletteSearchBox?.Text.Trim() ?? string.Empty;
        IEnumerable<PaletteItem> items = _palette.Filter(query, _paletteEditMode);

        PaletteItems.Clear();
        foreach (PaletteItem item in items)
        {
            PaletteItems.Add(item);
        }

        int hiddenKnown = _palette.HiddenCount;
        int verifiedVisible = _palette.Items.Count(item =>
            item.CanPlace && item.IsManualVerified && !_palette.IsHidden(item.ProfileId));
        int practiceVisible = _palette.Items.Count(item =>
            item.CanPlace && !item.IsManualVerified && !_palette.IsHidden(item.ProfileId));
        int preparationVisible = _palette.Items.Count(item =>
            !item.CanPlace && !_palette.IsHidden(item.ProfileId));
        PaletteSummaryText.Text = $"검증 결선 {verifiedVisible}종 · 연습 전용 {practiceVisible}종 · 준비 중 {preparationVisible}종 · 숨김 {hiddenKnown}종";
        RestoreHiddenButton.Visibility = hiddenKnown > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RefreshQuickInsertItems()
    {
        string query = QuickInsertSearchBox?.Text.Trim() ?? string.Empty;
        IEnumerable<PaletteItem> items = _palette.QuickInsert(query);

        QuickInsertItems.Clear();
        foreach (PaletteItem item in items)
        {
            QuickInsertItems.Add(item);
        }

        QuickInsertList.SelectedIndex = QuickInsertItems.Count > 0 ? 0 : -1;
    }

    private void PaletteList_DragItemsStarting(object sender, DragItemsStartingEventArgs e)
    {
        if (_paletteEditMode || e.Items.FirstOrDefault() is not PaletteItem { CanPlace: true } item)
        {
            e.Cancel = true;
            return;
        }

        e.Data.SetText(item.ProfileId);
        e.Data.RequestedOperation = DataPackageOperation.Copy;
    }

    private void WiringCanvas_DeviceDropRequested(
        object? sender,
        (string ProfileId, double X, double Y) drop)
    {
        if (_catalog.TryGet(drop.ProfileId, out DeviceProfileV5 profile)
            && profile.Availability == PaletteAvailabilityV5.Ready)
        {
            (double width, double height) = GetInitialDeviceSize(profile);
            PlaceDevice(profile, drop.X - (width / 2), drop.Y - (height / 2));
        }
    }

    private void WiringCanvas_DeviceDuplicateRequested(object? sender, string deviceId)
    {
        DeviceInstanceV5? source = Store.Document.Devices.FirstOrDefault(device => device.Id == deviceId);
        if (source is null)
        {
            return;
        }

        _commands.AddDevice(source with
        {
            Id = $"device-{Guid.NewGuid():N}",
            Label = $"{source.Label} 복사",
            X = Snap(source.X + 20),
            Y = Snap(source.Y + 20),
            Locked = false,
        });
        StatusText.Text = $"{source.Label}을(를) 복제했습니다.";
    }

    private void WiringCanvas_DeviceRotateRequested(object? sender, string deviceId)
    {
        _commands.UpdateDevice(deviceId, device => device with { Rotation = (device.Rotation + 90) % 360 });
        StatusText.Text = "장비를 오른쪽으로 90° 회전했습니다.";
    }

    private void WiringCanvas_DeviceLockToggleRequested(object? sender, string deviceId)
    {
        _commands.UpdateDevice(deviceId, device => device with { Locked = !device.Locked });
        DeviceInstanceV5 device = Store.Document.Devices.Single(item => item.Id == deviceId);
        StatusText.Text = device.Locked ? "장비 위치를 잠갔습니다." : "장비 위치 잠금을 해제했습니다.";
    }

    private void WiringCanvas_SelectionDeleteRequested(object? sender, CanvasSelection selection)
    {
        if (selection.Kind == CanvasSelectionKind.Device)
        {
            _commands.RemoveDevice(selection.Id);
            StatusText.Text = "장비와 연결된 전선을 한 작업으로 삭제했습니다.";
        }
        else if (selection.Kind == CanvasSelectionKind.Conductor)
        {
            _commands.RemoveConductor(selection.Id);
            StatusText.Text = "전선을 삭제했습니다.";
        }
    }

    private void WiringCanvas_DeviceMoveRequested(
        object? sender,
        (string DeviceId, double X, double Y) move)
    {
        _commands.UpdateDevice(move.DeviceId, device => device with
        {
            X = Snap(move.X),
            Y = Snap(move.Y),
        });
    }

    private void ValidationList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is ValidationIssueItem item)
        {
            NavigateToValidationIssue(item);
        }
    }

    private void ValidationList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_refreshingValidationItems)
        {
            return;
        }

        if (e.AddedItems.FirstOrDefault() is ValidationIssueItem item)
        {
            NavigateToValidationIssue(item);
        }
    }

    private void NavigateToValidationIssue(ValidationIssueItem item)
    {
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

        _commands.UpdateDevice(_selection.Id, device => device with { Label = DeviceLabelBox.Text.Trim() });
    }

    private void DeviceNumberBox_ValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (_refreshingInspector || _selection.Kind != CanvasSelectionKind.Device || !DeviceValuesAreValid())
        {
            return;
        }

        _commands.UpdateDevice(_selection.Id, device => device with
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
            _commands.UpdateDevice(_selection.Id, device => device with { Locked = DeviceLockedBox.IsChecked == true });
        }
    }

    private void ConductorLabelBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (!_refreshingInspector && _selection.Kind == CanvasSelectionKind.Conductor)
        {
            _commands.UpdateConductor(_selection.Id, conductor => conductor with { Label = ConductorLabelBox.Text.Trim() });
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

        _commands.UpdateConductor(_selection.Id, conductor => conductor with { Color = ConductorColorBox.Text.ToUpperInvariant() });
    }

    private void ConductorGaugeBox_ValueChanged(NumberBox sender, NumberBoxValueChangedEventArgs args)
    {
        if (!_refreshingInspector
            && _selection.Kind == CanvasSelectionKind.Conductor
            && !double.IsNaN(ConductorGaugeBox.Value))
        {
            _commands.UpdateConductor(
                _selection.Id,
                conductor => conductor with { GaugeMm2 = Math.Max(0.1, ConductorGaugeBox.Value) });
        }
    }

    private void ConductorLockedBox_Click(object sender, RoutedEventArgs e)
    {
        if (!_refreshingInspector && _selection.Kind == CanvasSelectionKind.Conductor)
        {
            _commands.UpdateConductor(
                _selection.Id,
                conductor => conductor with { RouteLocked = ConductorLockedBox.IsChecked == true });
        }
    }

    private void Store_Changed(object? sender, EventArgs e)
    {
        DispatcherQueue.TryEnqueue(RefreshFromStore);
    }

    private void Session_AutosaveFailed(object? sender, string message)
        => DispatcherQueue.TryEnqueue(() => StatusText.Text = $"자동 복구본 저장 실패: {message}");

    private void RefreshFromStore()
    {
        WiringCanvas.Refresh();
        UndoButton.IsEnabled = Store.CanUndo;
        RedoButton.IsEnabled = Store.CanRedo;
        DocumentTitleText.Text = Store.Document.Name;
        RevisionText.Text = $"rev {Store.Document.Revision} · {Store.Document.ContentHash[..8]}";
        RefreshInspector();
        RefreshValidation();

    }

    private void RefreshValidation()
    {
        ValidationPresentation presentation = ValidationPresenter.Present(Store);
        ValidationFreshnessText.Text = presentation.Freshness;

        _refreshingValidationItems = true;
        try
        {
            ValidationItems.Clear();
            foreach (ValidationIssueItem item in presentation.Items)
            {
                ValidationItems.Add(item);
            }
        }
        finally
        {
            _refreshingValidationItems = false;
        }

        ValidationSummaryText.Text = presentation.Summary;
    }

    private void RefreshInspector()
    {
        PropertyInspectorSelection inspector = PropertyInspectorPresenter.Resolve(Store.Document, _selection);
        _refreshingInspector = true;
        try
        {
            NoSelectionPanel.Visibility = Visibility.Collapsed;
            DevicePropertiesPanel.Visibility = Visibility.Collapsed;
            ConductorPropertiesPanel.Visibility = Visibility.Collapsed;
            TerminalPropertiesPanel.Visibility = Visibility.Collapsed;

            if (inspector.Device is { } device)
            {
                DevicePropertiesPanel.Visibility = Visibility.Visible;
                DeviceLabelBox.Text = device.Label;
                DeviceXBox.Value = device.X;
                DeviceYBox.Value = device.Y;
                DeviceWidthBox.Value = device.Width;
                DeviceHeightBox.Value = device.Height;
                DeviceRotationBox.Value = device.Rotation;
                DeviceLockedBox.IsChecked = device.Locked;
                if (_catalog.TryGet(device.ProfileId, out DeviceProfileV5 profile))
                {
                    DeviceProfileText.Text = profile.ManualEvidence == ManualEvidenceStatusV5.ExactProduct
                        ? $"{profile.Manufacturer} {profile.PartNumber} · profile v{device.ProfileVersion}"
                        : $"{device.ProfileId} · profile v{device.ProfileVersion}";
                    DeviceEvidenceText.Text = profile.ManualEvidence switch
                    {
                        ManualEvidenceStatusV5.ExactProduct => $"근거 등급: ManualVerified · 공식 문서 {profile.ManualReferences.Length}건 · 사전결선 검증 가능",
                        ManualEvidenceStatusV5.FamilyManual => "근거 등급: 계열 매뉴얼 · 전체 주문코드가 없어 연습 결선만 가능",
                        _ => "근거 등급: 품번 미확정 · 제조사와 전체 주문코드가 필요함",
                    };
                }
                else
                {
                    DeviceProfileText.Text = $"{device.ProfileId} · profile v{device.ProfileVersion}";
                    DeviceEvidenceText.Text = "전기 프로필을 찾을 수 없습니다.";
                }
                return;
            }

            if (inspector.Conductor is { } conductor)
            {
                ConductorPropertiesPanel.Visibility = Visibility.Visible;
                ConductorLabelBox.Text = conductor.Label;
                ConductorColorBox.Text = conductor.Color;
                ConductorGaugeBox.Value = conductor.GaugeMm2;
                ConductorLockedBox.IsChecked = conductor.RouteLocked;
                ConductorEndpointsText.Text = $"{conductor.Start.Key} ↔ {conductor.End.Key}";
                return;
            }

            if (inspector.TerminalKey is { } terminalKey)
            {
                TerminalPropertiesPanel.Visibility = Visibility.Visible;
                TerminalReferenceText.Text = terminalKey;
                return;
            }

            NoSelectionPanel.Visibility = Visibility.Visible;
        }
        finally
        {
            _refreshingInspector = false;
        }
    }

    private async Task ReplaceStoreAsync(WorkshopDocumentV5 document, string? currentPath = null)
    {
        await _session.ReplaceAsync(document, currentPath);
        WiringCanvas.Store = Store;
        _selection = CanvasSelection.Empty;
        RefreshFromStore();
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

    private static WorkshopDocumentV5 CreateEmptyDocument()
    {
        var document = new WorkshopDocumentV5
        {
            DocumentId = Guid.NewGuid().ToString("D"),
            Revision = 1,
            Name = "새 결선 문서",
            Devices = [],
            Conductors = [],
            TerminalBridges = [],
            Panel = new PanelLayoutV5(1500, 950),
            Viewport = new ViewportV5(1, 40, 40),
            Settings = new WorkshopSettingsV5(10, true),
            Extensions = new Dictionary<string, JsonElement>(),
        };
        return DocumentHasher.WithContentHash(document);
    }

    private WorkshopDocumentV5 CreateExampleDocument()
    {
        DeviceInstanceV5 supply = Device("supply", "mean-well:mdr-100-24", "MDR-100-24", 120, 430);
        DeviceInstanceV5 sensor = Device("sensor-npn", "prox-npn-v2", "NPN 근접 센서", 430, 170);
        DeviceInstanceV5 plc = Device("plc-input", "ls-electric:xbc-dn32h", "XBC-DN32H", 760, 120);
        WorkshopDocumentV5 document = CreateEmptyDocument() with
        {
            DocumentId = "starter-panel",
            Name = "NPN 결선 점검 예제",
            Devices = [supply, sensor, plc],
            Conductors =
            [
                Wire("sensor-plus", "W001", "supply", "V+1", "sensor-npn", "BN", "#EF4444"),
                Wire("sensor-zero", "W002", "supply", "V-1", "sensor-npn", "BU", "#3B82F6"),
                Wire("sensor-signal", "W003", "sensor-npn", "BK", "plc-input", "P00", "#111827"),
                // NPN sinking 입력은 COM이 +24V여야 하므로 이 예제에는 의도적으로 찾을 수 있는 오류를 둡니다.
                Wire("plc-common-wrong", "W004", "plc-input", "COMI", "supply", "V-2", "#3B82F6"),
            ],
        };
        return DocumentHasher.WithContentHash(document);
    }

    private DeviceInstanceV5 Device(
        string id,
        string profileId,
        string label,
        double x,
        double y)
    {
        if (!_catalog.TryGet(profileId, out DeviceProfileV5 profile))
        {
            throw new InvalidOperationException($"예제 장비 프로필을 찾지 못했습니다: {profileId}");
        }

        (double width, double height) = GetInitialDeviceSize(profile);
        return new(
            id,
            profileId,
            profile.Version,
            profile.EvidenceGrade,
            label,
            x,
            y,
            0,
            width,
            height,
            false,
            new Dictionary<string, string>())
        {
            CatalogEntryId = profile.LegacyType,
        };
    }

    private static (double Width, double Height) GetInitialDeviceSize(DeviceProfileV5 profile)
    {
        double maxDimension = profile.Category.ToLowerInvariant() switch
        {
            "plc" => 360,
            "hmi" => 340,
            "motion" => 300,
            "power" => 240,
            "wiring" => 260,
            "sensor" or "switch" or "actuator" => 220,
            _ => 240,
        };
        double sourceWidth = Math.Max(40, profile.DefaultWidth);
        double sourceHeight = Math.Max(40, profile.DefaultHeight);
        double scale = Math.Min(1, maxDimension / Math.Max(sourceWidth, sourceHeight));
        return (Math.Max(40, sourceWidth * scale), Math.Max(40, sourceHeight * scale));
    }

    private static ConductorV5 Wire(
        string id,
        string label,
        string startDevice,
        string startTerminal,
        string endDevice,
        string endTerminal,
        string color)
        => new(
            id,
            new TerminalRefV5(startDevice, startTerminal),
            new TerminalRefV5(endDevice, endTerminal),
            [],
            label,
            color,
            0.75,
            false);
}
