using System.Globalization;
using System.Numerics;
using Microsoft.Graphics.Canvas;
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
using Windows.UI.Core;

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

public sealed record CanvasQuickInsertRequest(
    PointV5 World,
    Point Screen);

public sealed partial class WiringCanvas : UserControl
{
    private readonly DeviceProfileCatalog _catalog = DeviceProfileCatalog.CreateDefault();
    private readonly ConnectionAssessmentService _connectionAssessment;
    private readonly CanvasAssetCache _assetCache = new();
    private readonly HashSet<string> _selectedConductorIds = new(StringComparer.Ordinal);
    private readonly DispatcherTimer _highlightTimer;
    private readonly CanvasHitTester _hitTester;
    private readonly WireDraftMachine _wireDraft = new();
    private readonly OrthogonalRoutePlanner _routePlanner = new();
    private readonly List<TerminalRefV5> _bridgeDraftTerminals = [];
    private readonly CanvasViewport _viewport = new();
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
    private Point _dragStartScreen;
    private bool _dragDeviceMoved;
    private string? _dragWaypointConductorId;
    private int _dragWaypointIndex = -1;
    private bool _dragWaypointCreated;
    private PointV5[]? _dragWaypointOriginals;
    private PointV5? _dragWaypointPreview;
    private bool _isPanning;
    private bool _panStartedWithRightButton;
    private bool _panMoved;
    private bool _suppressNextRightTap;
    private Point _panStartScreen;
    private Point _lastPointer;

    public WiringCanvas()
    {
        InitializeComponent();
        _connectionAssessment = new ConnectionAssessmentService(_catalog);
        _hitTester = new CanvasHitTester(_catalog);
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
            _selectedConductorIds.Clear();
            _wireDraft.Cancel();
            _wirePointerWorld = null;
            _reconnectConductorId = null;
            CancelWaypointDrag();
            UpdateWireHint();
            NativeCanvas.Invalidate();
        }
    }

    public CanvasSelection Selection => _selection;

    public bool BridgeModeEnabled { get; private set; }

    public event EventHandler<CanvasSelection>? SelectionChanged;

    public event EventHandler<(TerminalRefV5 Start, TerminalRefV5 End, PointV5[] Waypoints)>? WireCreationRequested;

    public event EventHandler<(string DeviceId, double X, double Y)>? DeviceMoveRequested;

    public event EventHandler<(string ProfileId, double X, double Y)>? DeviceDropRequested;

    public event EventHandler<CanvasSelection>? SelectionDeleteRequested;

    public event EventHandler<string>? DeviceDuplicateRequested;

    public event EventHandler<string>? DeviceRotateRequested;

    public event EventHandler<string>? DeviceLockToggleRequested;

    public event EventHandler<CanvasQuickInsertRequest>? QuickInsertRequested;

    public event EventHandler<ConductorEditRequest>? ConductorEditRequested;

    public event EventHandler<(string[] ConductorIds, string Color)>? ConductorBatchColorRequested;

    public event EventHandler<TerminalRefV5[]>? BridgeCreationRequested;

    public event EventHandler<bool>? BridgeModeChanged;

    public event EventHandler<string[]>? ConductorBatchDeleteRequested;

    public void Refresh()
    {
        UpdateAutomationMetadata();
        NativeCanvas.Invalidate();
    }

    public void SetBridgeMode(bool enabled)
    {
        BridgeModeEnabled = enabled;
        _bridgeDraftTerminals.Clear();
        if (enabled)
        {
            _wireDraft.Cancel();
            _wirePointerWorld = null;
            _reconnectConductorId = null;
        }

        UpdateWireHint();
        NativeCanvas.Invalidate();
        BridgeModeChanged?.Invoke(this, enabled);
    }

    public void RestoreBridgeDraft(IEnumerable<TerminalRefV5> terminals)
    {
        BridgeModeEnabled = true;
        _bridgeDraftTerminals.Clear();
        _bridgeDraftTerminals.AddRange(terminals.Distinct());
        UpdateWireHint();
        NativeCanvas.Invalidate();
        BridgeModeChanged?.Invoke(this, true);
    }

    public void RestoreWireDraft(TerminalRefV5 start, IEnumerable<PointV5> waypoints)
    {
        _wireDraft.Begin(start, dragInitiated: false);
        foreach (PointV5 waypoint in waypoints)
        {
            _wireDraft.AddWaypoint(waypoint);
        }

        UpdateWireHint();
        NativeCanvas.Invalidate();
    }

    public bool LockedRoutesAreSafe(WorkshopDocumentV5 candidate, out string? conflictConductorId)
    {
        foreach (ConductorV5 conductor in candidate.Conductors.Where(conductor => conductor.RouteLocked))
        {
            if (GetRoutePoints(candidate, conductor).Length == 0)
            {
                conflictConductorId = conductor.Id;
                return false;
            }
        }

        conflictConductorId = null;
        return true;
    }

    internal PointV5[] GetRenderedRoute(string conductorId)
    {
        if (_store is null)
        {
            return [];
        }

        ConductorV5? conductor = _store.Document.Conductors.FirstOrDefault(item => item.Id == conductorId);
        return conductor is null ? [] : GetRoutePoints(_store.Document, conductor);
    }

    internal IReadOnlyDictionary<string, PointV5[]> GetUnlockedRouteWaypoints()
    {
        if (_store is null)
        {
            return new Dictionary<string, PointV5[]>();
        }

        return _store.Document.Conductors
            .Where(conductor => !conductor.RouteLocked)
            .ToDictionary(
                conductor => conductor.Id,
                conductor =>
                {
                    PointV5[] route = GetRoutePoints(_store.Document, conductor);
                    return route.Length > 2 ? route[1..^1] : [];
                },
                StringComparer.Ordinal);
    }

    private void UpdateAutomationMetadata()
    {
        if (_store is null || NativeCanvas.ActualWidth <= 0 || NativeCanvas.ActualHeight <= 0)
        {
            return;
        }

        WorkshopDocumentV5 document = _store.Document;
        Dictionary<string, PointV5[]> routes = document.Conductors.ToDictionary(
            conductor => conductor.Id,
            conductor => GetRoutePoints(document, conductor),
            StringComparer.Ordinal);
        RebuildAutomationTargets(document, routes);

        for (double y = 48; y < NativeCanvas.ActualHeight - 48; y += 36)
        {
            for (double x = 48; x < NativeCanvas.ActualWidth - 48; x += 36)
            {
                PointV5 world = ScreenToWorld(new Point(x, y));
                if (HitTerminal(document, world) is null
                    && CanvasHitTester.Conductor(
                        document,
                        world,
                        _viewport.Zoom,
                        conductor => routes[conductor.Id]) is null
                    && HitDevice(document, world) is null)
                {
                    AutomationProperties.SetHelpText(this, $"blank-local:{x:F0},{y:F0}");
                    return;
                }
            }
        }

        AutomationProperties.SetHelpText(this, "blank-local:unavailable");
    }

    private void RebuildAutomationTargets(
        WorkshopDocumentV5 document,
        Dictionary<string, PointV5[]> routes)
    {
        AutomationOverlay.Children.Clear();
        foreach (DeviceInstanceV5 device in document.Devices)
        {
            AddAutomationTarget(
                $"Device:{device.Id}",
                $"장비 {device.Label} ({device.Id})",
                DeviceTransform.AxisAlignedBounds(device));
            if (!_catalog.TryGet(device.ProfileId, out DeviceProfileV5 profile))
            {
                continue;
            }

            foreach (TerminalDefinitionV5 terminal in profile.Terminals)
            {
                PointV5 point = TerminalPoint(device, profile, terminal);
                AddAutomationTarget(
                    $"Terminal:{device.Id}:{terminal.Id}",
                    $"단자 {device.Id}:{terminal.Id}",
                    new RectV5(point.X - 7, point.Y - 7, 14, 14));
            }
        }

        foreach (ConductorV5 conductor in document.Conductors)
        {
            PointV5[] route = routes[conductor.Id];
            if (route.Length == 0)
            {
                continue;
            }

            double left = route.Min(point => point.X);
            double top = route.Min(point => point.Y);
            double right = route.Max(point => point.X);
            double bottom = route.Max(point => point.Y);
            AddAutomationTarget(
                $"Conductor:{conductor.Id}",
                $"전선 {conductor.WireNumber} ({conductor.Id})",
                new RectV5(left - 5, top - 5, Math.Max(10, right - left + 10), Math.Max(10, bottom - top + 10)));
        }

        foreach (TerminalBridgeV5 bridge in document.TerminalBridges)
        {
            PointV5[] points = bridge.Terminals
                .Select(terminal => TryGetTerminalPoint(document, terminal, out PointV5 point) ? point : null)
                .OfType<PointV5>()
                .ToArray();
            if (points.Length == 0)
            {
                continue;
            }

            double left = points.Min(point => point.X);
            double top = points.Min(point => point.Y);
            double right = points.Max(point => point.X);
            double bottom = points.Max(point => point.Y);
            AddAutomationTarget(
                $"Bridge:{bridge.Id}",
                $"점퍼 {bridge.Id}",
                new RectV5(left - 7, top - 7, Math.Max(14, right - left + 14), Math.Max(14, bottom - top + 14)));
        }
    }

    private void AddAutomationTarget(string automationId, string name, RectV5 worldBounds)
    {
        Point topLeft = _viewport.WorldToScreen(new PointV5(worldBounds.X, worldBounds.Y));
        var target = new Border
        {
            Width = Math.Max(1, worldBounds.Width * _viewport.Zoom),
            Height = Math.Max(1, worldBounds.Height * _viewport.Zoom),
            Opacity = 0,
            IsHitTestVisible = false,
        };
        AutomationProperties.SetAutomationId(target, automationId);
        AutomationProperties.SetName(target, name);
        Canvas.SetLeft(target, topLeft.X);
        Canvas.SetTop(target, topLeft.Y);
        AutomationOverlay.Children.Add(target);
    }

    public void ResetView()
    {
        _viewport.Reset(_store?.Document, NativeCanvas.ActualWidth, NativeCanvas.ActualHeight);

        UpdateZoomText();
        UpdateAutomationMetadata();
        NativeCanvas.Invalidate();
    }

    public void NavigateTo(NavigationTarget target)
    {
        ArgumentNullException.ThrowIfNull(target);
        _viewport.Focus(target.FocusBounds, NativeCanvas.ActualWidth, NativeCanvas.ActualHeight);
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
        _selectedConductorIds.Clear();
        if (_selection.Kind == CanvasSelectionKind.Conductor)
        {
            _selectedConductorIds.Add(_selection.Id);
        }
        UpdateZoomText();
        _highlightTimer.Stop();
        _highlightTimer.Start();
        AutomationProperties.SetName(this, target.Kind == NavigationSelectionKind.Conductor
            ? $"선택된 전선: {target.Id}"
            : $"선택된 대상: {target.Id}");
        SelectionChanged?.Invoke(this, _selection);
        UpdateAutomationMetadata();
        NativeCanvas.Invalidate();
    }

    private void Canvas_CreateResources(CanvasControl sender, CanvasCreateResourcesEventArgs args)
        => args.TrackAsyncAction(_assetCache.LoadAsync(sender, _catalog.ResolvableProfiles).AsAsyncAction());

    private void Canvas_Draw(CanvasControl sender, CanvasDrawEventArgs args)
    {
        WorkbenchStore? store = _store;
        if (store is null)
        {
            return;
        }

        CanvasDrawingSession drawing = args.DrawingSession;
        drawing.Transform = _viewport.Matrix;
        DrawGrid(drawing, store.Document);
        foreach (ConductorV5 conductor in store.Document.Conductors)
        {
            DrawConductor(drawing, store.Document, conductor);
        }

        foreach (TerminalBridgeV5 bridge in store.Document.TerminalBridges)
        {
            DrawBridge(drawing, store.Document, bridge);
        }

        foreach (DeviceInstanceV5 device in store.Document.Devices)
        {
            DrawDevice(drawing, device);
        }

        if (_wireDraft.Current is { } draft
            && TryGetTerminalPoint(store.Document, draft.Start, out PointV5 pendingPoint))
        {
            ConnectionAssessmentV5? assessment = CurrentDraftAssessment();
            Color previewColor = AssessmentColor(assessment);
            drawing.DrawCircle((float)pendingPoint.X, (float)pendingPoint.Y, 12, previewColor, 3);
            if (_wirePointerWorld is not null)
            {
                PointV5[] preview = GetDraftRoutePoints(store.Document, draft, _wirePointerWorld);
                for (int index = 0; index < preview.Length - 1; index++)
                {
                    drawing.DrawLine(ToVector(preview[index]), ToVector(preview[index + 1]), previewColor, 2);
                }
            }
        }


        if (BridgeModeEnabled)
        {
            foreach (TerminalRefV5 terminal in _bridgeDraftTerminals)
            {
                if (TryGetTerminalPoint(store.Document, terminal, out PointV5 point))
                {
                    drawing.DrawCircle((float)point.X, (float)point.Y, 12, Color.FromArgb(255, 34, 197, 94), 3);
                }
            }
        }
    }

    private void DrawBridge(CanvasDrawingSession drawing, WorkshopDocumentV5 document, TerminalBridgeV5 bridge)
    {
        PointV5[] points = bridge.Terminals
            .Select(terminal => TryGetTerminalPoint(document, terminal, out PointV5 point) ? point : null)
            .OfType<PointV5>()
            .ToArray();
        Color color = ParseColor(bridge.Color, Color.FromArgb(255, 249, 115, 22));
        for (int index = 1; index < points.Length; index++)
        {
            PointV5 start = points[index - 1];
            PointV5 end = points[index];
            PointV5 corner = new(end.X, start.Y);
            drawing.DrawLine(ToVector(start), ToVector(corner), color, 4);
            drawing.DrawLine(ToVector(corner), ToVector(end), color, 4);
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
        ConductorV5 renderConductor = PreviewWaypointEdit(conductor);
        PointV5[] points = GetRoutePoints(document, renderConductor);
        if (points.Length < 2)
        {
            return;
        }

        bool selected = _selectedConductorIds.Contains(conductor.Id);
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
        drawing.DrawText(conductor.WireNumber, (float)labelPoint.X + 5, (float)labelPoint.Y - 20, Color.FromArgb(255, 226, 232, 240));

        if (selected)
        {
            PointV5[] waypoints = renderConductor.Waypoints;
            float radius = (float)(6 / _viewport.Zoom);
            for (int index = 0; index < waypoints.Length; index++)
            {
                PointV5 waypoint = waypoints[index];
                drawing.FillCircle((float)waypoint.X, (float)waypoint.Y, radius, Color.FromArgb(255, 251, 146, 60));
                drawing.DrawCircle((float)waypoint.X, (float)waypoint.Y, radius + (float)(2 / _viewport.Zoom), Color.FromArgb(255, 15, 23, 42), (float)(1.5 / _viewport.Zoom));
            }
        }
    }

    private ConductorV5 PreviewWaypointEdit(ConductorV5 conductor)
    {
        if (_dragWaypointConductorId != conductor.Id
            || _dragWaypointOriginals is null
            || _dragWaypointPreview is null)
        {
            return conductor;
        }

        ConductorV5 original = conductor with { Waypoints = _dragWaypointOriginals };
        return _dragWaypointCreated
            ? WireRouteEditor.InsertWaypoint(original, _dragWaypointIndex, _dragWaypointPreview)
            : WireRouteEditor.MoveWaypoint(original, _dragWaypointIndex, _dragWaypointPreview);
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
            var titleFormat = new CanvasTextFormat { FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold };
            bool hasAsset = _assetCache.Draw(drawing, profile?.Id ?? device.ProfileId, x, y, device.Width, device.Height);
            if (hasAsset)
            {
                if (selected)
                {
                    drawing.DrawRoundedRectangle(new Rect(x - 4, y - 4, device.Width + 8, device.Height + 8), 7, 7, outline, 3);
                }

                drawing.DrawText(device.Label, (float)x + 1, (float)y - 21, Color.FromArgb(230, 2, 6, 23), titleFormat);
                drawing.DrawText(device.Label, (float)x, (float)y - 22, Color.FromArgb(255, 248, 250, 252), titleFormat);
            }
            else
            {
                drawing.FillRoundedRectangle(new Rect(x, y, device.Width, device.Height), 7, 7, fill);
                drawing.DrawRoundedRectangle(new Rect(x, y, device.Width, device.Height), 7, 7, outline, selected ? 3 : 1.5f);
                drawing.DrawText(device.Label, new Rect(x + 10, y + 5, Math.Max(20, device.Width - 20), 22), Color.FromArgb(255, 248, 250, 252), titleFormat);
            }

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

    private void WiringCanvas_Unloaded(object sender, RoutedEventArgs e)
    {
        _highlightTimer.Stop();
        _assetCache.Clear();
        NativeCanvas.RemoveFromVisualTree();
    }

    private void Canvas_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        WorkbenchStore? store = _store;
        if (store is null)
        {
            return;
        }

        PointerPoint pointer = e.GetCurrentPoint(NativeCanvas);
        Focus(FocusState.Pointer);
        _lastPointer = pointer.Position;
        if (pointer.Properties.IsMiddleButtonPressed || pointer.Properties.IsRightButtonPressed)
        {
            _isPanning = true;
            _panStartedWithRightButton = pointer.Properties.IsRightButtonPressed;
            _panMoved = false;
            _panStartScreen = pointer.Position;
            NativeCanvas.CapturePointer(e.Pointer);
            e.Handled = pointer.Properties.IsMiddleButtonPressed;
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

        if (TryBeginExistingWaypointDrag(store.Document, world, e.Pointer))
        {
            e.Handled = true;
            return;
        }

        ConductorV5? conductor = HitConductor(store.Document, world);
        if (conductor is not null)
        {
            bool additiveSelection = (InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Control)
                & CoreVirtualKeyStates.Down) != 0;
            if (_selection.Kind == CanvasSelectionKind.Conductor
                && _selection.Id == conductor.Id
                && !additiveSelection
                && !conductor.RouteLocked)
            {
                BeginNewWaypointDrag(store.Document, conductor, world, e.Pointer);
                e.Handled = true;
                return;
            }

            SelectConductor(conductor.Id, additiveSelection);
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
                _dragStartScreen = pointer.Position;
                _dragDeviceMoved = false;
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
            if (!_panMoved)
            {
                if (Distance(pointer.Position, _panStartScreen) <= 3)
                {
                    return;
                }

                _panMoved = true;
                _viewport.Pan(
                    pointer.Position.X - _panStartScreen.X,
                    pointer.Position.Y - _panStartScreen.Y);
            }
            else
            {
                _viewport.Pan(pointer.Position.X - _lastPointer.X, pointer.Position.Y - _lastPointer.Y);
            }

            _lastPointer = pointer.Position;
            NativeCanvas.Invalidate();
            return;
        }

        if (_dragDeviceId is not null && _dragStartWorld is not null && _dragDeviceOrigin is not null)
        {
            if (!_dragDeviceMoved && Distance(pointer.Position, _dragStartScreen) <= 3)
            {
                return;
            }

            _dragDeviceMoved = true;
            PointV5 world = ScreenToWorld(pointer.Position);
            _dragPreview = new PointV5(
                _dragDeviceOrigin.X + world.X - _dragStartWorld.X,
                _dragDeviceOrigin.Y + world.Y - _dragStartWorld.Y);
            NativeCanvas.Invalidate();
            return;
        }

        if (_dragWaypointConductorId is not null && _store is not null)
        {
            _dragWaypointPreview = SnapPoint(_store.Document, ScreenToWorld(pointer.Position));
            NativeCanvas.Invalidate();
        }
    }

    private void Canvas_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        WorkbenchStore? store = _store;
        if (_isPanning)
        {
            _isPanning = false;
            _suppressNextRightTap = _panStartedWithRightButton && _panMoved;
            _panStartedWithRightButton = false;
            NativeCanvas.ReleasePointerCapture(e.Pointer);
        }

        if (_dragDeviceId is not null && _dragPreview is not null)
        {
            if (_dragDeviceMoved)
            {
                DeviceMoveRequested?.Invoke(this, (_dragDeviceId, _dragPreview.X, _dragPreview.Y));
            }

            _dragDeviceId = null;
            _dragStartWorld = null;
            _dragDeviceOrigin = null;
            _dragPreview = null;
            _dragDeviceMoved = false;
            NativeCanvas.ReleasePointerCapture(e.Pointer);
            NativeCanvas.Invalidate();
        }

        if (_dragWaypointConductorId is not null && store is not null)
        {
            CommitWaypointDrag(store);
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

        UpdateAutomationMetadata();
    }

    private void Canvas_PointerWheelChanged(object sender, PointerRoutedEventArgs e)
    {
        PointerPoint pointer = e.GetCurrentPoint(NativeCanvas);
        double factor = pointer.Properties.MouseWheelDelta > 0 ? 1.12 : 1 / 1.12;
        _viewport.ZoomAt(pointer.Position, factor);
        UpdateZoomText();
        UpdateAutomationMetadata();
        NativeCanvas.Invalidate();
        e.Handled = true;
    }

    private void HandleTerminalPressed(TerminalRefV5 terminal, Pointer pointer)
    {
        if (BridgeModeEnabled)
        {
            int existing = _bridgeDraftTerminals.FindIndex(item => item == terminal);
            if (existing >= 0)
            {
                _bridgeDraftTerminals.RemoveAt(existing);
            }
            else
            {
                _bridgeDraftTerminals.Add(terminal);
            }

            UpdateWireHint();
            NativeCanvas.Invalidate();
            return;
        }

        if (_reconnectConductorId is not null && _store is not null)
        {
            string conductorId = _reconnectConductorId;
            ConductorEditRequested?.Invoke(
                this,
                new ConductorEditRequest(
                    _reconnectStartEndpoint ? ConductorEditKind.ReconnectStart : ConductorEditKind.ReconnectEnd,
                    conductorId,
                    Terminal: terminal));
            _reconnectConductorId = null;
            Select(new CanvasSelection(CanvasSelectionKind.Conductor, conductorId));
            UpdateWireHint();
            return;
        }

        if (_wireDraft.Current is null)
        {
            _wireDraft.Begin(terminal, dragInitiated: false);
            _wireDragActive = true;
            NativeCanvas.CapturePointer(pointer);
        }
        else if (_wireDraft.Current.Start == terminal)
        {
            _wireDraft.Cancel();
            _wirePointerWorld = null;
            _wireDragActive = false;
            NativeCanvas.ReleasePointerCaptures();
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
        WorkbenchStore? store = _store;
        if (draft is null || store is null)
        {
            return;
        }

        var candidate = new ConductorV5(
            "wire-draft-preview",
            draft.Start,
            end,
            draft.Waypoints,
            string.Empty,
            "#111827",
            0.75,
            false);
        if (GetRoutePoints(store.Document, candidate).Length < 2)
        {
            WireHint.Visibility = Visibility.Visible;
            WireHintText.Text = "Blocked [ROUTE_NOT_FOUND] 장애물과 금지 영역을 피하는 직교 경로가 없습니다. 경로점을 조정하거나 Esc로 취소하세요.";
            return;
        }

        _wireDraft.Cancel();
        _wirePointerWorld = null;
        _wireDragActive = false;
        NativeCanvas.ReleasePointerCaptures();
        WireCreationRequested?.Invoke(this, (draft.Start, end, draft.Waypoints));
    }

    private void Select(CanvasSelection selection)
    {
        _selectedConductorIds.Clear();
        if (selection.Kind == CanvasSelectionKind.Conductor)
        {
            _selectedConductorIds.Add(selection.Id);
        }

        _selection = selection;
        SelectionChanged?.Invoke(this, selection);
        NativeCanvas.Invalidate();
    }

    private void SelectConductor(string conductorId, bool additive)
    {
        if (!additive)
        {
            _selectedConductorIds.Clear();
        }

        if (additive && !_selectedConductorIds.Add(conductorId))
        {
            _selectedConductorIds.Remove(conductorId);
        }
        else
        {
            _selectedConductorIds.Add(conductorId);
        }

        string? primary = _selectedConductorIds.Contains(conductorId)
            ? conductorId
            : _selectedConductorIds.Order(StringComparer.Ordinal).FirstOrDefault();
        _selection = primary is null
            ? CanvasSelection.Empty
            : new CanvasSelection(CanvasSelectionKind.Conductor, primary);
        SelectionChanged?.Invoke(this, _selection);
        NativeCanvas.Invalidate();
    }

    private void UpdateWireHint()
    {
        if (BridgeModeEnabled)
        {
            WireHint.Visibility = Visibility.Visible;
            WireHintText.Text = $"점퍼 단자 {_bridgeDraftTerminals.Count}개 선택 · Enter 확정 · 선택 단자 재클릭 해제 · Esc 취소";
            return;
        }

        if (_reconnectConductorId is not null)
        {
            WireHint.Visibility = Visibility.Visible;
            WireHintText.Text = $"{_reconnectConductorId}의 {(_reconnectStartEndpoint ? "시작" : "끝")} 단자를 다시 선택하세요 · Esc 취소";
            return;
        }

        WireDraftV5? draft = _wireDraft.Current;
        WireHint.Visibility = draft is null ? Visibility.Collapsed : Visibility.Visible;
        ConnectionAssessmentV5? assessment = CurrentDraftAssessment();
        WireHintText.Text = draft is null
            ? string.Empty
            : assessment is null
                ? $"{draft.Start.Key} · 경로점 {draft.Waypoints.Length}개 · 빈 곳 클릭, Backspace, Esc"
                : $"{assessment.Disposition} [{assessment.Code}] {assessment.Message} · 점유 "
                    + $"{assessment.StartOccupancy}/{assessment.StartCapacity} → "
                    + $"{assessment.EndOccupancy}/{assessment.EndCapacity}";
    }

    private ConnectionAssessmentV5? CurrentDraftAssessment()
    {
        if (_store is null || _wireDraft.Current is not { } draft || _wirePointerWorld is null)
        {
            return null;
        }

        TerminalRefV5? destination = HitTerminal(_store.Document, _wirePointerWorld);
        return destination is null || destination == draft.Start
            ? null
            : _connectionAssessment.Assess(_store.Document, draft.Start, destination);
    }

    private static Color AssessmentColor(ConnectionAssessmentV5? assessment)
        => assessment?.Disposition switch
        {
            ConnectionDispositionV5.Allowed => Color.FromArgb(230, 34, 197, 94),
            ConnectionDispositionV5.Warning => Color.FromArgb(230, 250, 204, 21),
            ConnectionDispositionV5.Blocked => Color.FromArgb(230, 239, 68, 68),
            _ => Color.FromArgb(190, 250, 204, 21),
        };

    private void WiringCanvas_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.J && _wireDraft.Current is null && _reconnectConductorId is null)
        {
            SetBridgeMode(!BridgeModeEnabled);
            e.Handled = true;
            return;
        }

        if (BridgeModeEnabled && e.Key == VirtualKey.Enter && _bridgeDraftTerminals.Count >= 2)
        {
            TerminalRefV5[] terminals = [.. _bridgeDraftTerminals];
            _bridgeDraftTerminals.Clear();
            BridgeCreationRequested?.Invoke(this, terminals);
            UpdateWireHint();
            NativeCanvas.Invalidate();
            e.Handled = true;
            return;
        }

        if (BridgeModeEnabled && e.Key == VirtualKey.Escape)
        {
            _bridgeDraftTerminals.Clear();
            UpdateWireHint();
            NativeCanvas.Invalidate();
            e.Handled = true;
            return;
        }

        if (e.Key == VirtualKey.Escape
            && (_wireDraft.Current is not null || _reconnectConductorId is not null || _dragWaypointConductorId is not null))
        {
            _wireDraft.Cancel();
            _wirePointerWorld = null;
            _reconnectConductorId = null;
            _wireDragActive = false;
            CancelWaypointDrag();
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
            if (_selection.Kind == CanvasSelectionKind.Conductor && _selectedConductorIds.Count > 1)
            {
                ConductorBatchDeleteRequested?.Invoke(
                    this,
                    _selectedConductorIds.Order(StringComparer.Ordinal).ToArray());
            }
            else
            {
                SelectionDeleteRequested?.Invoke(this, _selection);
            }

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

    private bool TryBeginExistingWaypointDrag(WorkshopDocumentV5 document, PointV5 world, Pointer pointer)
    {
        if (_selection.Kind != CanvasSelectionKind.Conductor)
        {
            return false;
        }

        ConductorV5? conductor = document.Conductors.FirstOrDefault(item => item.Id == _selection.Id);
        if (conductor is null || conductor.RouteLocked)
        {
            return false;
        }

        double radius = 11 / _viewport.Zoom;
        for (int index = conductor.Waypoints.Length - 1; index >= 0; index--)
        {
            if (Distance(world, conductor.Waypoints[index]) > radius)
            {
                continue;
            }

            _dragWaypointConductorId = conductor.Id;
            _dragWaypointIndex = index;
            _dragWaypointCreated = false;
            _dragWaypointOriginals = [.. conductor.Waypoints];
            _dragWaypointPreview = conductor.Waypoints[index];
            NativeCanvas.CapturePointer(pointer);
            return true;
        }

        return false;
    }

    private void BeginNewWaypointDrag(
        WorkshopDocumentV5 document,
        ConductorV5 conductor,
        PointV5 world,
        Pointer pointer)
    {
        PointV5 snapped = SnapPoint(document, world);
        _dragWaypointConductorId = conductor.Id;
        _dragWaypointIndex = GetWaypointInsertIndex(document, conductor, snapped);
        _dragWaypointCreated = true;
        _dragWaypointOriginals = [.. conductor.Waypoints];
        _dragWaypointPreview = snapped;
        NativeCanvas.CapturePointer(pointer);
        NativeCanvas.Invalidate();
    }

    private void CommitWaypointDrag(WorkbenchStore store)
    {
        string? conductorId = _dragWaypointConductorId;
        if (conductorId is null)
        {
            return;
        }

        ConductorV5? conductor = store.Document.Conductors.FirstOrDefault(item => item.Id == conductorId);
        if (conductor is not null && !conductor.RouteLocked)
        {
            PointV5[] edited = PreviewWaypointEdit(conductor).Waypoints;
            if (!edited.SequenceEqual(conductor.Waypoints))
            {
                ConductorEditRequested?.Invoke(
                    this,
                    new ConductorEditRequest(
                        ConductorEditKind.ReplaceWaypoints,
                        conductorId,
                        Waypoints: edited));
            }
        }

        CancelWaypointDrag();
    }

    private void CancelWaypointDrag()
    {
        _dragWaypointConductorId = null;
        _dragWaypointIndex = -1;
        _dragWaypointCreated = false;
        _dragWaypointOriginals = null;
        _dragWaypointPreview = null;
    }

    private int GetWaypointInsertIndex(WorkshopDocumentV5 document, ConductorV5 conductor, PointV5 point)
    {
        PointV5[] route = GetRoutePoints(document, conductor);
        double pointOffset = RouteOffset(route, point);
        for (int index = 0; index < conductor.Waypoints.Length; index++)
        {
            if (RouteOffset(route, conductor.Waypoints[index]) > pointOffset)
            {
                return index;
            }
        }

        return conductor.Waypoints.Length;
    }

    private static double RouteOffset(PointV5[] route, PointV5 point)
    {
        double bestDistance = double.MaxValue;
        double bestOffset = 0;
        double traversed = 0;
        for (int index = 0; index < route.Length - 1; index++)
        {
            PointV5 start = route[index];
            PointV5 end = route[index + 1];
            double dx = end.X - start.X;
            double dy = end.Y - start.Y;
            double lengthSquared = (dx * dx) + (dy * dy);
            double amount = lengthSquared == 0
                ? 0
                : Math.Clamp((((point.X - start.X) * dx) + ((point.Y - start.Y) * dy)) / lengthSquared, 0, 1);
            var closest = new PointV5(start.X + (dx * amount), start.Y + (dy * amount));
            double distance = Distance(point, closest);
            double segmentLength = Math.Sqrt(lengthSquared);
            if (distance < bestDistance)
            {
                bestDistance = distance;
                bestOffset = traversed + (segmentLength * amount);
            }

            traversed += segmentLength;
        }

        return bestOffset;
    }

    private static PointV5 SnapPoint(WorkshopDocumentV5 document, PointV5 point)
    {
        if (!document.Settings.SnapToGrid)
        {
            return point;
        }

        double grid = Math.Max(1, document.Settings.GridSize);
        return new PointV5(
            Math.Round(point.X / grid) * grid,
            Math.Round(point.Y / grid) * grid);
    }

    private void Canvas_RightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        if (_suppressNextRightTap)
        {
            _suppressNextRightTap = false;
            e.Handled = true;
            return;
        }

        if (_store is null)
        {
            return;
        }

        _contextWorld = ScreenToWorld(e.GetPosition(NativeCanvas));
        ConductorV5? conductor = HitConductor(_store.Document, _contextWorld);
        if (conductor is null)
        {
            DeviceInstanceV5? device = HitDevice(_store.Document, _contextWorld);
            if (device is not null)
            {
                ShowDeviceContextMenu(device, e.GetPosition(NativeCanvas));
                e.Handled = true;
                return;
            }

            Select(CanvasSelection.Empty);
            QuickInsertRequested?.Invoke(
                this,
                new CanvasQuickInsertRequest(_contextWorld, e.GetPosition(NativeCanvas)));
            e.Handled = true;
            return;
        }

        if (!_selectedConductorIds.Contains(conductor.Id))
        {
            Select(new CanvasSelection(CanvasSelectionKind.Conductor, conductor.Id));
        }

        bool singleSelected = _selectedConductorIds.Count == 1;
        var flyout = new MenuFlyout();
        var colorMenu = new MenuFlyoutSubItem { Text = "선 색상" };
        foreach ((string label, string color) in new[]
        {
            ("갈색", "#8B4513"),
            ("검정", "#111111"),
            ("회색", "#6B7280"),
            ("초록", "#15803D"),
            ("노랑", "#FACC15"),
            ("빨강", "#DC2626"),
            ("파랑", "#2563EB"),
            ("주황", "#F97316"),
        })
        {
            var colorItem = new MenuFlyoutItem { Text = label, Tag = color };
            colorItem.Click += WireColor_Click;
            colorMenu.Items.Add(colorItem);
        }

        flyout.Items.Add(colorMenu);
        flyout.Items.Add(new MenuFlyoutSeparator());
        flyout.Items.Add(MenuItem("현재 위치에 경로점 추가", AddWaypoint_Click, singleSelected && !conductor.RouteLocked));
        flyout.Items.Add(MenuItem(conductor.RouteLocked ? "경로 잠금 해제" : "경로 잠금", ToggleRouteLock_Click, singleSelected));
        flyout.Items.Add(MenuItem("경로점 초기화", ResetRoute_Click, singleSelected && !conductor.RouteLocked && conductor.Waypoints.Length > 0));
        flyout.Items.Add(new MenuFlyoutSeparator());
        flyout.Items.Add(MenuItem("시작 단자 재연결", ReconnectStart_Click, singleSelected));
        flyout.Items.Add(MenuItem("끝 단자 재연결", ReconnectEnd_Click, singleSelected));
        flyout.Items.Add(new MenuFlyoutSeparator());
        flyout.Items.Add(MenuItem(
            singleSelected ? "전선 삭제" : $"선택 전선 {_selectedConductorIds.Count}개 삭제",
            DeleteConductor_Click));
        flyout.ShowAt(NativeCanvas, new FlyoutShowOptions { Position = e.GetPosition(NativeCanvas) });
        e.Handled = true;
    }

    private void ShowDeviceContextMenu(DeviceInstanceV5 device, Point position)
    {
        Select(new CanvasSelection(CanvasSelectionKind.Device, device.Id, device.Id));
        var flyout = new MenuFlyout();
        flyout.Items.Add(MenuItem("복제", DuplicateDevice_Click));
        flyout.Items.Add(MenuItem("오른쪽으로 90° 회전", RotateDevice_Click));
        flyout.Items.Add(MenuItem(device.Locked ? "잠금 해제" : "위치 잠금", ToggleDeviceLock_Click));
        flyout.Items.Add(new MenuFlyoutSeparator());
        flyout.Items.Add(MenuItem("장비 삭제", DeleteSelectedDevice_Click));
        flyout.ShowAt(NativeCanvas, new FlyoutShowOptions { Position = position });
    }

    private void DuplicateDevice_Click(object sender, RoutedEventArgs e)
    {
        if (_selection.Kind == CanvasSelectionKind.Device)
        {
            DeviceDuplicateRequested?.Invoke(this, _selection.Id);
        }
    }

    private void RotateDevice_Click(object sender, RoutedEventArgs e)
    {
        if (_selection.Kind == CanvasSelectionKind.Device)
        {
            DeviceRotateRequested?.Invoke(this, _selection.Id);
        }
    }

    private void ToggleDeviceLock_Click(object sender, RoutedEventArgs e)
    {
        if (_selection.Kind == CanvasSelectionKind.Device)
        {
            DeviceLockToggleRequested?.Invoke(this, _selection.Id);
        }
    }

    private void DeleteSelectedDevice_Click(object sender, RoutedEventArgs e)
    {
        if (_selection.Kind == CanvasSelectionKind.Device)
        {
            SelectionDeleteRequested?.Invoke(this, _selection);
        }
    }

    private static MenuFlyoutItem MenuItem(string text, RoutedEventHandler click, bool enabled = true)
    {
        var item = new MenuFlyoutItem { Text = text, IsEnabled = enabled };
        item.Click += click;
        return item;
    }

    private void WireColor_Click(object sender, RoutedEventArgs e)
    {
        if (_store is not null
            && _selection.Kind == CanvasSelectionKind.Conductor
            && sender is MenuFlyoutItem { Tag: string color })
        {
            if (_selectedConductorIds.Count > 1)
            {
                ConductorBatchColorRequested?.Invoke(
                    this,
                    (_selectedConductorIds.Order(StringComparer.Ordinal).ToArray(), color));
            }
            else
            {
                ConductorEditRequested?.Invoke(
                    this,
                    new ConductorEditRequest(ConductorEditKind.ChangeColor, _selection.Id, Color: color));
            }
        }
    }

    private void AddWaypoint_Click(object sender, RoutedEventArgs e)
    {
        if (_store is not null && _selection.Kind == CanvasSelectionKind.Conductor && _contextWorld is not null)
        {
            WorkshopDocumentV5 document = _store.Document;
            ConductorV5 conductor = document.Conductors.First(item => item.Id == _selection.Id);
            ConductorEditRequested?.Invoke(
                this,
                new ConductorEditRequest(
                    ConductorEditKind.InsertWaypoint,
                    _selection.Id,
                    WaypointIndex: GetWaypointInsertIndex(document, conductor, _contextWorld),
                    Waypoint: SnapPoint(document, _contextWorld)));
        }
    }

    private void ToggleRouteLock_Click(object sender, RoutedEventArgs e)
    {
        if (_store is not null && _selection.Kind == CanvasSelectionKind.Conductor)
        {
            ConductorV5 conductor = _store.Document.Conductors.First(item => item.Id == _selection.Id);
            ConductorEditRequested?.Invoke(
                this,
                new ConductorEditRequest(
                    ConductorEditKind.ToggleRouteLock,
                    _selection.Id,
                    Waypoints: GetRoutePoints(_store.Document, conductor)));
        }
    }

    private void ResetRoute_Click(object sender, RoutedEventArgs e)
    {
        if (_store is not null && _selection.Kind == CanvasSelectionKind.Conductor)
        {
            ConductorEditRequested?.Invoke(
                this,
                new ConductorEditRequest(ConductorEditKind.ClearWaypoints, _selection.Id));
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
            if (_selectedConductorIds.Count > 1)
            {
                ConductorBatchDeleteRequested?.Invoke(
                    this,
                    _selectedConductorIds.Order(StringComparer.Ordinal).ToArray());
            }
            else
            {
                SelectionDeleteRequested?.Invoke(this, _selection);
            }
        }
    }

    private void UpdateZoomText() => ZoomText.Text = $"{_viewport.Zoom:P0}";

    private PointV5 ScreenToWorld(Point point)
    {
        return _viewport.ScreenToWorld(point);
    }

    private TerminalRefV5? HitTerminal(WorkshopDocumentV5 document, PointV5 point)
        => _hitTester.Terminal(document, point, _viewport.Zoom);

    private ConductorV5? HitConductor(WorkshopDocumentV5 document, PointV5 point)
        => CanvasHitTester.Conductor(
            document,
            point,
            _viewport.Zoom,
            conductor => GetRoutePoints(document, conductor));

    private static DeviceInstanceV5? HitDevice(WorkshopDocumentV5 document, PointV5 point)
        => CanvasHitTester.Device(document, point);

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
            .Concat(RoutingKeepOuts(document))
            .ToArray();
        return _routePlanner.Plan(new RouteRequestV5(
            start,
            end,
            LeadOutPoint(startDevice, startProfile, startTerminal),
            LeadOutPoint(endDevice, endProfile, endTerminal),
            conductor.Waypoints,
            obstacles,
            conductor.RouteLocked)
        {
            ExistingRoutes = ExistingStoredRoutes(document, conductor.Id),
        });
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
            .Concat(RoutingKeepOuts(document))
            .ToArray();
        return _routePlanner.Plan(new RouteRequestV5(
            start,
            pointer,
            LeadOutPoint(device, profile, terminal),
            pointer,
            draft.Waypoints,
            obstacles,
            false)
        {
            ExistingRoutes = ExistingStoredRoutes(document),
        });
    }

    private PointV5[][] ExistingStoredRoutes(WorkshopDocumentV5 document, string? excludedConductorId = null)
        => document.Conductors
            .Where(conductor => conductor.Id != excludedConductorId)
            .Select(conductor => StoredRoutePolyline(document, conductor))
            .Where(route => route.Length >= 2)
            .ToArray();

    private PointV5[] StoredRoutePolyline(WorkshopDocumentV5 document, ConductorV5 conductor)
    {
        if (!TryGetTerminalPoint(document, conductor.Start, out PointV5 start)
            || !TryGetTerminalPoint(document, conductor.End, out PointV5 end))
        {
            return [];
        }

        var route = new List<PointV5> { start };
        foreach (PointV5 point in conductor.Waypoints.Append(end))
        {
            PointV5 previous = route[^1];
            if (previous.X != point.X && previous.Y != point.Y)
            {
                route.Add(new PointV5(point.X, previous.Y));
            }

            route.Add(point);
        }

        return route.ToArray();
    }

    private static IEnumerable<RectV5> RoutingKeepOuts(WorkshopDocumentV5 document)
        => document.PanelElements
            .Where(element => element.Kind == PanelElementKind.Door
                || string.Equals(
                    element.Properties.GetValueOrDefault("routingKeepOut"),
                    "true",
                    StringComparison.OrdinalIgnoreCase))
            .Select(element => element.Bounds.Inflate(8));

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

    private static double Distance(Point left, Point right)
        => Math.Sqrt(Math.Pow(left.X - right.X, 2) + Math.Pow(left.Y - right.Y, 2));

}
