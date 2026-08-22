using System.Globalization;
using System.Numerics;
using System.Runtime.InteropServices;
using Microsoft.Graphics.Canvas;
using Microsoft.Graphics.Canvas.Svg;
using Microsoft.Graphics.Canvas.Text;
using Microsoft.Graphics.Canvas.UI;
using Microsoft.Graphics.Canvas.UI.Xaml;
using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Navigation;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Wiring;
using PlcWiringTrainer.Core.Workbench;
using Windows.ApplicationModel.DataTransfer;
using Windows.Foundation;
using Windows.System;
using Windows.UI;

namespace PlcWiringTrainer.App.Controls;

public enum CanvasSelectionKind
{
    None,
    Device,
    Conductor,
    Terminal,
}

public sealed record CanvasSelection(
    CanvasSelectionKind Kind,
    string Id,
    string? DeviceId = null,
    string? TerminalId = null)
{
    public static CanvasSelection Empty { get; } = new(CanvasSelectionKind.None, string.Empty);
}

public sealed partial class WiringCanvas : UserControl
{
    private readonly DeviceProfileCatalog _catalog = DeviceProfileCatalog.CreateDefault();
    private readonly Dictionary<string, CanvasBitmap> _deviceBitmaps = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CanvasSvgDocument> _deviceSvgDocuments = new(StringComparer.Ordinal);
    private readonly DispatcherTimer _highlightTimer;
    private readonly WireDraftMachine _wireDraft = new();
    private readonly IRoutePlanner _routePlanner = new OrthogonalRoutePlanner();
    private WorkbenchStore? _store;
    private CanvasSelection _selection = CanvasSelection.Empty;
    private PointV5? _wirePointerWorld;
    private bool _wireDragActive;
    private string? _reconnectConductorId;
    private bool _reconnectStartEndpoint;
    private PointV5? _contextWorld;
    private string? _dragDeviceId;
    private PointV5? _dragStartWorld;
    private PointV5? _dragDeviceOrigin;
    private PointV5? _dragPreview;
    private bool _isPanning;
    private Point _lastPointer;
    private double _zoom = 1;
    private double _offsetX = 40;
    private double _offsetY = 40;

    public WiringCanvas()
    {
        InitializeComponent();
        _highlightTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2.4) };
        _highlightTimer.Tick += (_, _) =>
        {
            _highlightTimer.Stop();
            NativeCanvas.Invalidate();
        };
    }

    public WorkbenchStore? Store
    {
        get => _store;
        set
        {
            _store = value;
            _selection = CanvasSelection.Empty;
            _wireDraft.Cancel();
            _wirePointerWorld = null;
            _reconnectConductorId = null;
            UpdateWireHint();
            NativeCanvas.Invalidate();
        }
    }

    public CanvasSelection Selection => _selection;

    public event EventHandler<CanvasSelection>? SelectionChanged;

    public event EventHandler<(TerminalRefV5 Start, TerminalRefV5 End, PointV5[] Waypoints)>? WireCreationRequested;

    public event EventHandler<(string DeviceId, double X, double Y)>? DeviceMoveRequested;

    public event EventHandler<(string ProfileId, double X, double Y)>? DeviceDropRequested;

    public event EventHandler<CanvasSelection>? SelectionDeleteRequested;

    public void Refresh() => NativeCanvas.Invalidate();

    public void ResetView()
    {
        _zoom = 1;
        _offsetX = 40;
        _offsetY = 40;
        UpdateZoomText();
        NativeCanvas.Invalidate();
    }

    public void NavigateTo(NavigationTarget target)
    {
        ArgumentNullException.ThrowIfNull(target);
        double width = Math.Max(1, NativeCanvas.ActualWidth);
        double height = Math.Max(1, NativeCanvas.ActualHeight);
        double availableWidth = Math.Max(200, width - 160);
        double availableHeight = Math.Max(200, height - 160);
        _zoom = Math.Clamp(
            Math.Min(availableWidth / target.FocusBounds.Width, availableHeight / target.FocusBounds.Height),
            0.4,
            3.5);
        double centerX = target.FocusBounds.X + (target.FocusBounds.Width / 2);
        double centerY = target.FocusBounds.Y + (target.FocusBounds.Height / 2);
        _offsetX = (width / 2) - (centerX * _zoom);
        _offsetY = (height / 2) - (centerY * _zoom);
        _selection = target.Kind switch
        {
            NavigationSelectionKind.Conductor => new CanvasSelection(CanvasSelectionKind.Conductor, target.Id),
            NavigationSelectionKind.Terminal => new CanvasSelection(
                CanvasSelectionKind.Terminal,
                target.Id,
                target.DeviceId,
                target.TerminalId),
            _ => new CanvasSelection(CanvasSelectionKind.Device, target.Id, target.DeviceId ?? target.Id),
        };
        UpdateZoomText();
        _highlightTimer.Stop();
        _highlightTimer.Start();
        AutomationProperties.SetName(this, target.Kind == NavigationSelectionKind.Conductor
            ? $"선택된 전선: {target.Id}"
            : $"선택된 대상: {target.Id}");
        SelectionChanged?.Invoke(this, _selection);
        NativeCanvas.Invalidate();
    }

    private Matrix3x2 ViewMatrix => new((float)_zoom, 0, 0, (float)_zoom, (float)_offsetX, (float)_offsetY);

    private void Canvas_CreateResources(CanvasControl sender, CanvasCreateResourcesEventArgs args)
        => args.TrackAsyncAction(LoadDeviceAssetsAsync(sender).AsAsyncAction());

    private async Task LoadDeviceAssetsAsync(CanvasControl sender)
    {
        DisposeDeviceAssets();
        foreach (DeviceProfileV5 profile in _catalog.ResolvableProfiles.Where(profile => !string.IsNullOrWhiteSpace(profile.AssetPath)))
        {
            string assetPath = Path.Combine(
                AppContext.BaseDirectory,
                profile.AssetPath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(assetPath))
            {
                continue;
            }

            try
            {
                if (string.Equals(Path.GetExtension(assetPath), ".svg", StringComparison.OrdinalIgnoreCase))
                {
                    string svg = await File.ReadAllTextAsync(assetPath).ConfigureAwait(true);
                    _deviceSvgDocuments[profile.Id] = CanvasSvgDocument.LoadFromXml(sender, svg);
                }
                else
                {
                    _deviceBitmaps[profile.Id] = await CanvasBitmap.LoadAsync(sender, assetPath);
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException or COMException)
            {
                // 개별 교육용 이미지가 손상돼도 편집 문서와 나머지 카탈로그는 계속 사용할 수 있어야 합니다.
            }
        }

        sender.Invalidate();
    }

    private void Canvas_Draw(CanvasControl sender, CanvasDrawEventArgs args)
    {
        WorkbenchStore? store = _store;
        if (store is null)
        {
            return;
        }

        CanvasDrawingSession drawing = args.DrawingSession;
        drawing.Transform = ViewMatrix;
        DrawGrid(drawing, store.Document);
        foreach (ConductorV5 conductor in store.Document.Conductors)
        {
            DrawConductor(drawing, store.Document, conductor);
        }

        foreach (DeviceInstanceV5 device in store.Document.Devices)
        {
            DrawDevice(drawing, device);
        }

        if (_wireDraft.Current is { } draft
            && TryGetTerminalPoint(store.Document, draft.Start, out PointV5 pendingPoint))
        {
            drawing.DrawCircle((float)pendingPoint.X, (float)pendingPoint.Y, 12, Color.FromArgb(255, 250, 204, 21), 3);
            if (_wirePointerWorld is not null)
            {
                PointV5[] preview = GetDraftRoutePoints(store.Document, draft, _wirePointerWorld);
                for (int index = 0; index < preview.Length - 1; index++)
                {
                    drawing.DrawLine(ToVector(preview[index]), ToVector(preview[index + 1]), Color.FromArgb(190, 250, 204, 21), 2);
                }
            }
        }
    }

    private static void DrawGrid(CanvasDrawingSession drawing, WorkshopDocumentV5 document)
    {
        double spacing = Math.Max(5, document.Settings.GridSize);
        Color minor = Color.FromArgb(55, 100, 116, 139);
        Color border = Color.FromArgb(230, 71, 85, 105);
        for (double x = 0; x <= document.Panel.Width; x += spacing)
        {
            drawing.DrawLine((float)x, 0, (float)x, (float)document.Panel.Height, minor, 0.5f);
        }

        for (double y = 0; y <= document.Panel.Height; y += spacing)
        {
            drawing.DrawLine(0, (float)y, (float)document.Panel.Width, (float)y, minor, 0.5f);
        }

        drawing.DrawRectangle(0, 0, (float)document.Panel.Width, (float)document.Panel.Height, border, 2);
    }

    private void DrawConductor(CanvasDrawingSession drawing, WorkshopDocumentV5 document, ConductorV5 conductor)
    {
        PointV5[] points = GetRoutePoints(document, conductor);
        if (points.Length < 2)
        {
            return;
        }

        bool selected = _selection.Kind == CanvasSelectionKind.Conductor && _selection.Id == conductor.Id;
        bool emphasized = selected && _highlightTimer.IsEnabled;
        Color color = ParseColor(conductor.Color, Color.FromArgb(255, 239, 68, 68));
        float width = selected ? 5 : 2.5f;
        if (emphasized)
        {
            for (int index = 0; index < points.Length - 1; index++)
            {
                drawing.DrawLine(ToVector(points[index]), ToVector(points[index + 1]), Color.FromArgb(130, 250, 204, 21), 13);
            }
        }

        for (int index = 0; index < points.Length - 1; index++)
        {
            drawing.DrawLine(ToVector(points[index]), ToVector(points[index + 1]), color, width);
        }

        PointV5 labelPoint = points[points.Length / 2];
        drawing.DrawText(conductor.Label, (float)labelPoint.X + 5, (float)labelPoint.Y - 20, Color.FromArgb(255, 226, 232, 240));
    }

    private void DrawDevice(CanvasDrawingSession drawing, DeviceInstanceV5 device)
    {
        double x = device.X;
        double y = device.Y;
        if (_dragDeviceId == device.Id && _dragPreview is not null)
        {
            x = _dragPreview.X;
            y = _dragPreview.Y;
        }

        DeviceInstanceV5 renderDevice = device with { X = x, Y = y };
        _catalog.TryGet(device.ProfileId, out DeviceProfileV5? profile);
        Matrix3x2 originalTransform = drawing.Transform;
        Vector2 center = new((float)(x + (device.Width / 2)), (float)(y + (device.Height / 2)));
        drawing.Transform = Matrix3x2.CreateRotation((float)(device.Rotation * Math.PI / 180), center) * originalTransform;
        try
        {
            bool selected = _selection.Kind == CanvasSelectionKind.Device && _selection.Id == device.Id;
            Color fill = Color.FromArgb(255, 30, 41, 59);
            Color outline = selected ? Color.FromArgb(255, 56, 189, 248) : Color.FromArgb(255, 148, 163, 184);
            drawing.FillRoundedRectangle(new Rect(x, y, device.Width, device.Height), 7, 7, fill);
            DrawDeviceAsset(drawing, profile?.Id ?? device.ProfileId, x, y, device.Width, device.Height);
            drawing.DrawRoundedRectangle(new Rect(x, y, device.Width, device.Height), 7, 7, outline, selected ? 3 : 1.5f);

            var titleFormat = new CanvasTextFormat { FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold };
            drawing.FillRectangle(new Rect(x + 1, y + 1, Math.Max(1, device.Width - 2), 27), Color.FromArgb(205, 15, 23, 42));
            drawing.DrawText(device.Label, new Rect(x + 10, y + 5, Math.Max(20, device.Width - 20), 22), Color.FromArgb(255, 248, 250, 252), titleFormat);

            if (profile is not null)
            {
                foreach (TerminalDefinitionV5 terminal in profile.Terminals)
                {
                    PointV5 position = UnrotatedTerminalPoint(renderDevice, profile, terminal);
                    bool terminalSelected = _selection.Kind == CanvasSelectionKind.Terminal
                        && _selection.DeviceId == device.Id
                        && _selection.TerminalId == terminal.Id;
                    drawing.FillCircle((float)position.X, (float)position.Y, terminalSelected ? 7 : 5, TerminalColor(terminal));
                    drawing.DrawCircle((float)position.X, (float)position.Y, terminalSelected ? 8 : 6, Color.FromArgb(255, 15, 23, 42), 1.5f);
                    drawing.DrawText(terminal.Id, (float)position.X + 8, (float)position.Y - 9, Color.FromArgb(255, 226, 232, 240));
                }
            }

            if (device.Locked)
            {
                drawing.DrawText("LOCK", (float)(x + device.Width - 42), (float)(y + device.Height - 18), Color.FromArgb(255, 251, 191, 36));
            }
        }
        finally
        {
            drawing.Transform = originalTransform;
        }
    }

    private void DrawDeviceAsset(
        CanvasDrawingSession drawing,
        string profileId,
        double x,
        double y,
        double width,
        double height)
    {
        double imageX = x + 8;
        double imageY = y + 30;
        double imageWidth = Math.Max(1, width - 16);
        double imageHeight = Math.Max(1, height - 38);
        if (_deviceBitmaps.TryGetValue(profileId, out CanvasBitmap? bitmap))
        {
            drawing.DrawImage(
                bitmap,
                new Rect(imageX, imageY, imageWidth, imageHeight),
                bitmap.Bounds);
        }
        else if (_deviceSvgDocuments.TryGetValue(profileId, out CanvasSvgDocument? svgDocument))
        {
            drawing.DrawSvg(
                svgDocument,
                new Size(imageWidth, imageHeight),
                new Vector2((float)imageX, (float)imageY));
        }
    }

    private void WiringCanvas_Unloaded(object sender, RoutedEventArgs e)
    {
        _highlightTimer.Stop();
        DisposeDeviceAssets();
        NativeCanvas.RemoveFromVisualTree();
    }

    private void DisposeDeviceAssets()
    {
        foreach (CanvasBitmap bitmap in _deviceBitmaps.Values)
        {
            bitmap.Dispose();
        }

        foreach (CanvasSvgDocument document in _deviceSvgDocuments.Values)
        {
            document.Dispose();
        }

        _deviceBitmaps.Clear();
        _deviceSvgDocuments.Clear();
    }

    private void Canvas_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        WorkbenchStore? store = _store;
        if (store is null)
        {
            return;
        }

        PointerPoint pointer = e.GetCurrentPoint(NativeCanvas);
        _lastPointer = pointer.Position;
        if (pointer.Properties.IsMiddleButtonPressed)
        {
            _isPanning = true;
            NativeCanvas.CapturePointer(e.Pointer);
            e.Handled = true;
            return;
        }

        if (!pointer.Properties.IsLeftButtonPressed)
        {
            return;
        }

        PointV5 world = ScreenToWorld(pointer.Position);
        TerminalRefV5? terminal = HitTerminal(store.Document, world);
        if (terminal is not null)
        {
            Select(new CanvasSelection(CanvasSelectionKind.Terminal, terminal.Key, terminal.DeviceId, terminal.TerminalId));
            HandleTerminalPressed(terminal, e.Pointer);
            e.Handled = true;
            return;
        }

        ConductorV5? conductor = HitConductor(store.Document, world);
        if (conductor is not null)
        {
            Select(new CanvasSelection(CanvasSelectionKind.Conductor, conductor.Id));
            e.Handled = true;
            return;
        }

        DeviceInstanceV5? device = HitDevice(store.Document, world);
        if (device is not null)
        {
            Select(new CanvasSelection(CanvasSelectionKind.Device, device.Id, device.Id));
            if (!device.Locked)
            {
                _dragDeviceId = device.Id;
                _dragStartWorld = world;
                _dragDeviceOrigin = new PointV5(device.X, device.Y);
                _dragPreview = _dragDeviceOrigin;
                NativeCanvas.CapturePointer(e.Pointer);
            }

            e.Handled = true;
            return;
        }

        if (_wireDraft.Current is not null)
        {
            _wireDraft.AddWaypoint(world);
            _wirePointerWorld = world;
            UpdateWireHint();
            NativeCanvas.Invalidate();
            e.Handled = true;
            return;
        }

        Select(CanvasSelection.Empty);
    }

    private void Canvas_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        PointerPoint pointer = e.GetCurrentPoint(NativeCanvas);
        if (_wireDraft.Current is not null)
        {
            _wirePointerWorld = ScreenToWorld(pointer.Position);
            NativeCanvas.Invalidate();
        }

        if (_isPanning)
        {
            _offsetX += pointer.Position.X - _lastPointer.X;
            _offsetY += pointer.Position.Y - _lastPointer.Y;
            _lastPointer = pointer.Position;
            NativeCanvas.Invalidate();
            return;
        }

        if (_dragDeviceId is not null && _dragStartWorld is not null && _dragDeviceOrigin is not null)
        {
            PointV5 world = ScreenToWorld(pointer.Position);
            _dragPreview = new PointV5(
                _dragDeviceOrigin.X + world.X - _dragStartWorld.X,
                _dragDeviceOrigin.Y + world.Y - _dragStartWorld.Y);
            NativeCanvas.Invalidate();
        }
    }

    private void Canvas_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        WorkbenchStore? store = _store;
        if (_isPanning)
        {
            _isPanning = false;
            NativeCanvas.ReleasePointerCapture(e.Pointer);
        }

        if (_dragDeviceId is not null && _dragPreview is not null)
        {
            DeviceMoveRequested?.Invoke(this, (_dragDeviceId, _dragPreview.X, _dragPreview.Y));
            _dragDeviceId = null;
            _dragStartWorld = null;
            _dragDeviceOrigin = null;
            _dragPreview = null;
            NativeCanvas.ReleasePointerCapture(e.Pointer);
            NativeCanvas.Invalidate();
        }

        if (_wireDragActive && store is not null && _wireDraft.Current is { } draft)
        {
            PointV5 world = ScreenToWorld(e.GetCurrentPoint(NativeCanvas).Position);
            TerminalRefV5? end = HitTerminal(store.Document, world);
            if (end is not null && end != draft.Start)
            {
                CompleteWire(end);
            }

            _wireDragActive = false;
            NativeCanvas.ReleasePointerCapture(e.Pointer);
            UpdateWireHint();
            NativeCanvas.Invalidate();
        }
    }

    private void Canvas_PointerWheelChanged(object sender, PointerRoutedEventArgs e)
    {
        PointerPoint pointer = e.GetCurrentPoint(NativeCanvas);
        PointV5 before = ScreenToWorld(pointer.Position);
        double factor = pointer.Properties.MouseWheelDelta > 0 ? 1.12 : 1 / 1.12;
        _zoom = Math.Clamp(_zoom * factor, 0.25, 4);
        _offsetX = pointer.Position.X - (before.X * _zoom);
        _offsetY = pointer.Position.Y - (before.Y * _zoom);
        UpdateZoomText();
        NativeCanvas.Invalidate();
        e.Handled = true;
    }

    private void HandleTerminalPressed(TerminalRefV5 terminal, Pointer pointer)
    {
        if (_reconnectConductorId is not null && _store is not null)
        {
            string conductorId = _reconnectConductorId;
            _store.UpdateConductor(conductorId, conductor => _reconnectStartEndpoint
                ? conductor with { Start = terminal }
                : conductor with { End = terminal });
            _reconnectConductorId = null;
            Select(new CanvasSelection(CanvasSelectionKind.Conductor, conductorId));
            UpdateWireHint();
            return;
        }

        if (_wireDraft.Current is null)
        {
            _wireDraft.Begin(terminal, dragInitiated: true);
            _wireDragActive = true;
            NativeCanvas.CapturePointer(pointer);
        }
        else if (_wireDraft.Current.Start == terminal)
        {
            _wireDraft.Cancel();
            _wirePointerWorld = null;
        }
        else
        {
            CompleteWire(terminal);
        }

        UpdateWireHint();
        NativeCanvas.Invalidate();
    }

    private void CompleteWire(TerminalRefV5 end)
    {
        WireDraftV5? draft = _wireDraft.Current;
        if (draft is null)
        {
            return;
        }

        WireCreationRequested?.Invoke(this, (draft.Start, end, draft.Waypoints));
        _wireDraft.Cancel();
        _wirePointerWorld = null;
    }

    private void Select(CanvasSelection selection)
    {
        _selection = selection;
        SelectionChanged?.Invoke(this, selection);
        NativeCanvas.Invalidate();
    }

    private void UpdateWireHint()
    {
        if (_reconnectConductorId is not null)
        {
            WireHint.Visibility = Visibility.Visible;
            WireHintText.Text = $"{_reconnectConductorId}의 {(_reconnectStartEndpoint ? "시작" : "끝")} 단자를 다시 선택하세요 · Esc 취소";
            return;
        }

        WireDraftV5? draft = _wireDraft.Current;
        WireHint.Visibility = draft is null ? Visibility.Collapsed : Visibility.Visible;
        WireHintText.Text = draft is null
            ? string.Empty
            : $"{draft.Start.Key} · 경로점 {draft.Waypoints.Length}개 · 빈 곳 클릭, Backspace, Esc";
    }

    private void WiringCanvas_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Escape && (_wireDraft.Current is not null || _reconnectConductorId is not null))
        {
            _wireDraft.Cancel();
            _wirePointerWorld = null;
            _reconnectConductorId = null;
            _wireDragActive = false;
            NativeCanvas.ReleasePointerCaptures();
            UpdateWireHint();
            NativeCanvas.Invalidate();
            e.Handled = true;
            return;
        }

        if (e.Key == VirtualKey.Back && _wireDraft.RemoveLastWaypoint())
        {
            UpdateWireHint();
            NativeCanvas.Invalidate();
            e.Handled = true;
            return;
        }

        if (e.Key == VirtualKey.Delete && _selection.Kind is CanvasSelectionKind.Device or CanvasSelectionKind.Conductor)
        {
            SelectionDeleteRequested?.Invoke(this, _selection);
            e.Handled = true;
        }
    }

    private void WiringCanvas_DragOver(object sender, DragEventArgs e)
    {
        if (e.DataView.Contains(StandardDataFormats.Text))
        {
            e.AcceptedOperation = DataPackageOperation.Copy;
            e.DragUIOverride.Caption = "장비 배치";
            e.Handled = true;
        }
    }

    private async void WiringCanvas_Drop(object sender, DragEventArgs e)
    {
        if (!e.DataView.Contains(StandardDataFormats.Text))
        {
            return;
        }

        string profileId = await e.DataView.GetTextAsync();
        if (string.IsNullOrWhiteSpace(profileId))
        {
            return;
        }

        PointV5 world = ScreenToWorld(e.GetPosition(NativeCanvas));
        DeviceDropRequested?.Invoke(this, (profileId, world.X, world.Y));
        e.Handled = true;
    }

    private void Canvas_RightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        if (_store is null)
        {
            return;
        }

        _contextWorld = ScreenToWorld(e.GetPosition(NativeCanvas));
        ConductorV5? conductor = HitConductor(_store.Document, _contextWorld);
        if (conductor is null)
        {
            return;
        }

        Select(new CanvasSelection(CanvasSelectionKind.Conductor, conductor.Id));
        var flyout = new MenuFlyout();
        flyout.Items.Add(MenuItem("현재 위치에 경로점 추가", AddWaypoint_Click));
        flyout.Items.Add(MenuItem(conductor.RouteLocked ? "경로 잠금 해제" : "경로 잠금", ToggleRouteLock_Click));
        flyout.Items.Add(MenuItem("경로점 초기화", ResetRoute_Click));
        flyout.Items.Add(new MenuFlyoutSeparator());
        flyout.Items.Add(MenuItem("시작 단자 재연결", ReconnectStart_Click));
        flyout.Items.Add(MenuItem("끝 단자 재연결", ReconnectEnd_Click));
        flyout.Items.Add(new MenuFlyoutSeparator());
        flyout.Items.Add(MenuItem("전선 삭제", DeleteConductor_Click));
        flyout.ShowAt(NativeCanvas, new FlyoutShowOptions { Position = e.GetPosition(NativeCanvas) });
        e.Handled = true;
    }

    private static MenuFlyoutItem MenuItem(string text, RoutedEventHandler click)
    {
        var item = new MenuFlyoutItem { Text = text };
        item.Click += click;
        return item;
    }

    private void AddWaypoint_Click(object sender, RoutedEventArgs e)
    {
        if (_store is not null && _selection.Kind == CanvasSelectionKind.Conductor && _contextWorld is not null)
        {
            _store.UpdateConductor(_selection.Id, conductor => conductor with
            {
                Waypoints = [.. conductor.Waypoints, _contextWorld],
            });
        }
    }

    private void ToggleRouteLock_Click(object sender, RoutedEventArgs e)
    {
        if (_store is not null && _selection.Kind == CanvasSelectionKind.Conductor)
        {
            _store.UpdateConductor(_selection.Id, conductor => conductor with { RouteLocked = !conductor.RouteLocked });
        }
    }

    private void ResetRoute_Click(object sender, RoutedEventArgs e)
    {
        if (_store is not null && _selection.Kind == CanvasSelectionKind.Conductor)
        {
            _store.UpdateConductor(_selection.Id, conductor => conductor with { Waypoints = [], RouteLocked = false });
        }
    }

    private void ReconnectStart_Click(object sender, RoutedEventArgs e) => BeginReconnect(startEndpoint: true);

    private void ReconnectEnd_Click(object sender, RoutedEventArgs e) => BeginReconnect(startEndpoint: false);

    private void BeginReconnect(bool startEndpoint)
    {
        if (_selection.Kind != CanvasSelectionKind.Conductor)
        {
            return;
        }

        _wireDraft.Cancel();
        _reconnectConductorId = _selection.Id;
        _reconnectStartEndpoint = startEndpoint;
        UpdateWireHint();
    }

    private void DeleteConductor_Click(object sender, RoutedEventArgs e)
    {
        if (_selection.Kind == CanvasSelectionKind.Conductor)
        {
            SelectionDeleteRequested?.Invoke(this, _selection);
        }
    }

    private void UpdateZoomText() => ZoomText.Text = $"{_zoom:P0}";

    private PointV5 ScreenToWorld(Point point)
    {
        Matrix3x2.Invert(ViewMatrix, out Matrix3x2 inverse);
        Vector2 world = Vector2.Transform(new Vector2((float)point.X, (float)point.Y), inverse);
        return new PointV5(world.X, world.Y);
    }

    private TerminalRefV5? HitTerminal(WorkshopDocumentV5 document, PointV5 point)
    {
        double radius = 13 / _zoom;
        foreach (DeviceInstanceV5 device in document.Devices.Reverse())
        {
            if (!_catalog.TryGet(device.ProfileId, out DeviceProfileV5 profile))
            {
                continue;
            }

            foreach (TerminalDefinitionV5 terminal in profile.Terminals)
            {
                PointV5 terminalPoint = TerminalPoint(device, profile, terminal);
                if (Distance(point, terminalPoint) <= radius)
                {
                    return new TerminalRefV5(device.Id, terminal.Id);
                }
            }
        }

        return null;
    }

    private ConductorV5? HitConductor(WorkshopDocumentV5 document, PointV5 point)
    {
        double tolerance = 9 / _zoom;
        foreach (ConductorV5 conductor in document.Conductors.Reverse())
        {
            PointV5[] route = GetRoutePoints(document, conductor);
            for (int index = 0; index < route.Length - 1; index++)
            {
                if (DistanceToSegment(point, route[index], route[index + 1]) <= tolerance)
                {
                    return conductor;
                }
            }
        }

        return null;
    }

    private static DeviceInstanceV5? HitDevice(WorkshopDocumentV5 document, PointV5 point)
        => document.Devices.Reverse().FirstOrDefault(device =>
            DeviceTransform.Contains(device, point));

    private PointV5[] GetRoutePoints(WorkshopDocumentV5 document, ConductorV5 conductor)
    {
        if (!TryGetTerminalPoint(document, conductor.Start, out PointV5 start)
            || !TryGetTerminalPoint(document, conductor.End, out PointV5 end))
        {
            return [];
        }

        if (!TryGetTerminalDefinition(document, conductor.Start, out DeviceInstanceV5? startDevice, out DeviceProfileV5? startProfile, out TerminalDefinitionV5? startTerminal)
            || !TryGetTerminalDefinition(document, conductor.End, out DeviceInstanceV5? endDevice, out DeviceProfileV5? endProfile, out TerminalDefinitionV5? endTerminal))
        {
            return [];
        }

        RectV5[] obstacles = document.Devices
            .Where(device => device.Id != conductor.Start.DeviceId && device.Id != conductor.End.DeviceId)
            .Select(DeviceTransform.AxisAlignedBounds)
            .Select(bounds => bounds.Inflate(8))
            .ToArray();
        return _routePlanner.Plan(new RouteRequestV5(
            start,
            end,
            LeadOutPoint(startDevice, startProfile, startTerminal),
            LeadOutPoint(endDevice, endProfile, endTerminal),
            conductor.Waypoints,
            obstacles,
            conductor.RouteLocked));
    }

    private PointV5[] GetDraftRoutePoints(WorkshopDocumentV5 document, WireDraftV5 draft, PointV5 pointer)
    {
        if (!TryGetTerminalDefinition(document, draft.Start, out DeviceInstanceV5? device, out DeviceProfileV5? profile, out TerminalDefinitionV5? terminal)
            || !TryGetTerminalPoint(document, draft.Start, out PointV5 start))
        {
            return [];
        }

        RectV5[] obstacles = document.Devices
            .Where(item => item.Id != draft.Start.DeviceId)
            .Select(DeviceTransform.AxisAlignedBounds)
            .Select(bounds => bounds.Inflate(8))
            .ToArray();
        return _routePlanner.Plan(new RouteRequestV5(
            start,
            pointer,
            LeadOutPoint(device, profile, terminal),
            pointer,
            draft.Waypoints,
            obstacles,
            false));
    }

    private bool TryGetTerminalPoint(
        WorkshopDocumentV5 document,
        TerminalRefV5 terminal,
        out PointV5 point)
    {
        if (TryGetTerminalDefinition(document, terminal, out DeviceInstanceV5? device, out DeviceProfileV5? profile, out TerminalDefinitionV5? definition))
        {
            point = TerminalPoint(device, profile, definition);
            return true;
        }

        point = new PointV5(0, 0);
        return false;
    }

    private bool TryGetTerminalDefinition(
        WorkshopDocumentV5 document,
        TerminalRefV5 terminal,
        out DeviceInstanceV5 device,
        out DeviceProfileV5 profile,
        out TerminalDefinitionV5 definition)
    {
        device = document.Devices.FirstOrDefault(item => item.Id == terminal.DeviceId)!;
        if (device is not null && _catalog.TryGet(device.ProfileId, out profile!))
        {
            definition = profile.Terminals.FirstOrDefault(item =>
                item.Id == terminal.TerminalId || item.Aliases.Contains(terminal.TerminalId, StringComparer.Ordinal))!;
            if (definition is not null)
            {
                return true;
            }
        }

        device = null!;
        profile = null!;
        definition = null!;
        return false;
    }

    private static PointV5 TerminalPoint(
        DeviceInstanceV5 device,
        DeviceProfileV5 profile,
        TerminalDefinitionV5 terminal)
        => DeviceTransform.TerminalToWorld(
            device,
            new PointV5(profile.DefaultWidth, profile.DefaultHeight),
            new PointV5(terminal.OffsetX, terminal.OffsetY));

    private static PointV5 UnrotatedTerminalPoint(
        DeviceInstanceV5 device,
        DeviceProfileV5 profile,
        TerminalDefinitionV5 terminal)
        => new(
            device.X + ((terminal.OffsetX / Math.Max(1, profile.DefaultWidth)) * device.Width),
            device.Y + ((terminal.OffsetY / Math.Max(1, profile.DefaultHeight)) * device.Height));

    private static PointV5 LeadOutPoint(
        DeviceInstanceV5 device,
        DeviceProfileV5 profile,
        TerminalDefinitionV5 terminal)
    {
        PointV5 terminalPoint = TerminalPoint(device, profile, terminal);
        double centerX = device.X + (device.Width / 2);
        double centerY = device.Y + (device.Height / 2);
        double dx = terminalPoint.X - centerX;
        double dy = terminalPoint.Y - centerY;
        double distance = Math.Max(8, terminal.LeadOutDistance);
        if (Math.Abs(dx) >= Math.Abs(dy))
        {
            return new PointV5(terminalPoint.X + (Math.Sign(dx == 0 ? 1 : dx) * distance), terminalPoint.Y);
        }

        return new PointV5(terminalPoint.X, terminalPoint.Y + (Math.Sign(dy == 0 ? 1 : dy) * distance));
    }

    private static Color TerminalColor(TerminalDefinitionV5 terminal)
        => terminal.Polarity switch
        {
            TerminalPolarity.Positive => Color.FromArgb(255, 239, 68, 68),
            TerminalPolarity.Negative => Color.FromArgb(255, 59, 130, 246),
            TerminalPolarity.ProtectiveEarth => Color.FromArgb(255, 34, 197, 94),
            _ => Color.FromArgb(255, 250, 204, 21),
        };

    private static Color ParseColor(string value, Color fallback)
    {
        if (value.Length == 7 && value[0] == '#'
            && byte.TryParse(value.AsSpan(1, 2), NumberStyles.HexNumber, null, out byte red)
            && byte.TryParse(value.AsSpan(3, 2), NumberStyles.HexNumber, null, out byte green)
            && byte.TryParse(value.AsSpan(5, 2), NumberStyles.HexNumber, null, out byte blue))
        {
            return Color.FromArgb(255, red, green, blue);
        }

        return fallback;
    }

    private static Vector2 ToVector(PointV5 point) => new((float)point.X, (float)point.Y);

    private static double Distance(PointV5 left, PointV5 right)
        => Math.Sqrt(Math.Pow(left.X - right.X, 2) + Math.Pow(left.Y - right.Y, 2));

    private static double DistanceToSegment(PointV5 point, PointV5 start, PointV5 end)
    {
        double dx = end.X - start.X;
        double dy = end.Y - start.Y;
        if (Math.Abs(dx) < double.Epsilon && Math.Abs(dy) < double.Epsilon)
        {
            return Distance(point, start);
        }

        double t = Math.Clamp(
            (((point.X - start.X) * dx) + ((point.Y - start.Y) * dy)) / ((dx * dx) + (dy * dy)),
            0,
            1);
        return Distance(point, new PointV5(start.X + (t * dx), start.Y + (t * dy)));
    }
}
