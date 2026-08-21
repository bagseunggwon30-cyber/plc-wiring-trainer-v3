using System.Globalization;
using System.Numerics;
using Microsoft.Graphics.Canvas;
using Microsoft.Graphics.Canvas.Text;
using Microsoft.Graphics.Canvas.UI.Xaml;
using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Navigation;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Workbench;
using Windows.Foundation;
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
    private readonly DispatcherTimer _highlightTimer;
    private WorkbenchStore? _store;
    private CanvasSelection _selection = CanvasSelection.Empty;
    private TerminalRefV4? _pendingTerminal;
    private string? _dragDeviceId;
    private PointV4? _dragStartWorld;
    private PointV4? _dragDeviceOrigin;
    private PointV4? _dragPreview;
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
            _pendingTerminal = null;
            UpdateWireHint();
            NativeCanvas.Invalidate();
        }
    }

    public CanvasSelection Selection => _selection;

    public event EventHandler<CanvasSelection>? SelectionChanged;

    public event EventHandler<(TerminalRefV4 Start, TerminalRefV4 End)>? WireCreationRequested;

    public event EventHandler<(string DeviceId, double X, double Y)>? DeviceMoveRequested;

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
        foreach (ConductorV4 conductor in store.Document.Conductors)
        {
            DrawConductor(drawing, store.Document, conductor);
        }

        foreach (DeviceInstanceV4 device in store.Document.Devices)
        {
            DrawDevice(drawing, device);
        }

        if (_pendingTerminal is not null && TryGetTerminalPoint(store.Document, _pendingTerminal, out PointV4 pendingPoint))
        {
            drawing.DrawCircle((float)pendingPoint.X, (float)pendingPoint.Y, 12, Color.FromArgb(255, 250, 204, 21), 3);
        }
    }

    private static void DrawGrid(CanvasDrawingSession drawing, WorkshopDocumentV4 document)
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

    private void DrawConductor(CanvasDrawingSession drawing, WorkshopDocumentV4 document, ConductorV4 conductor)
    {
        PointV4[] points = GetRoutePoints(document, conductor);
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

        PointV4 labelPoint = points[points.Length / 2];
        drawing.DrawText(conductor.Label, (float)labelPoint.X + 5, (float)labelPoint.Y - 20, Color.FromArgb(255, 226, 232, 240));
    }

    private void DrawDevice(CanvasDrawingSession drawing, DeviceInstanceV4 device)
    {
        double x = device.X;
        double y = device.Y;
        if (_dragDeviceId == device.Id && _dragPreview is not null)
        {
            x = _dragPreview.X;
            y = _dragPreview.Y;
        }

        bool selected = _selection.Kind == CanvasSelectionKind.Device && _selection.Id == device.Id;
        Color fill = Color.FromArgb(255, 30, 41, 59);
        Color outline = selected ? Color.FromArgb(255, 56, 189, 248) : Color.FromArgb(255, 148, 163, 184);
        drawing.FillRoundedRectangle(new Rect(x, y, device.Width, device.Height), 7, 7, fill);
        drawing.DrawRoundedRectangle(new Rect(x, y, device.Width, device.Height), 7, 7, outline, selected ? 3 : 1.5f);

        var titleFormat = new CanvasTextFormat { FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold };
        drawing.DrawText(device.Label, new Rect(x + 10, y + 8, Math.Max(20, device.Width - 20), 25), Color.FromArgb(255, 248, 250, 252), titleFormat);
        drawing.DrawText(device.ProfileId, (float)x + 10, (float)y + 36, Color.FromArgb(255, 148, 163, 184));

        if (_catalog.TryGet(device.ProfileId, out DeviceProfileV4 profile))
        {
            foreach (TerminalDefinitionV4 terminal in profile.Terminals)
            {
                PointV4 position = TerminalPoint(device with { X = x, Y = y }, terminal);
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

    private void Canvas_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        WorkbenchStore? store = _store;
        if (store is null)
        {
            return;
        }

        PointerPoint pointer = e.GetCurrentPoint(NativeCanvas);
        _lastPointer = pointer.Position;
        if (pointer.Properties.IsMiddleButtonPressed || pointer.Properties.IsRightButtonPressed)
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

        PointV4 world = ScreenToWorld(pointer.Position);
        TerminalRefV4? terminal = HitTerminal(store.Document, world);
        if (terminal is not null)
        {
            Select(new CanvasSelection(CanvasSelectionKind.Terminal, terminal.Key, terminal.DeviceId, terminal.TerminalId));
            HandleTerminalClick(terminal);
            e.Handled = true;
            return;
        }

        ConductorV4? conductor = HitConductor(store.Document, world);
        if (conductor is not null)
        {
            Select(new CanvasSelection(CanvasSelectionKind.Conductor, conductor.Id));
            e.Handled = true;
            return;
        }

        DeviceInstanceV4? device = HitDevice(store.Document, world);
        if (device is not null)
        {
            Select(new CanvasSelection(CanvasSelectionKind.Device, device.Id, device.Id));
            if (!device.Locked)
            {
                _dragDeviceId = device.Id;
                _dragStartWorld = world;
                _dragDeviceOrigin = new PointV4(device.X, device.Y);
                _dragPreview = _dragDeviceOrigin;
                NativeCanvas.CapturePointer(e.Pointer);
            }

            e.Handled = true;
            return;
        }

        Select(CanvasSelection.Empty);
    }

    private void Canvas_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        PointerPoint pointer = e.GetCurrentPoint(NativeCanvas);
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
            PointV4 world = ScreenToWorld(pointer.Position);
            _dragPreview = new PointV4(
                _dragDeviceOrigin.X + world.X - _dragStartWorld.X,
                _dragDeviceOrigin.Y + world.Y - _dragStartWorld.Y);
            NativeCanvas.Invalidate();
        }
    }

    private void Canvas_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
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
    }

    private void Canvas_PointerWheelChanged(object sender, PointerRoutedEventArgs e)
    {
        PointerPoint pointer = e.GetCurrentPoint(NativeCanvas);
        PointV4 before = ScreenToWorld(pointer.Position);
        double factor = pointer.Properties.MouseWheelDelta > 0 ? 1.12 : 1 / 1.12;
        _zoom = Math.Clamp(_zoom * factor, 0.25, 4);
        _offsetX = pointer.Position.X - (before.X * _zoom);
        _offsetY = pointer.Position.Y - (before.Y * _zoom);
        UpdateZoomText();
        NativeCanvas.Invalidate();
        e.Handled = true;
    }

    private void HandleTerminalClick(TerminalRefV4 terminal)
    {
        if (_pendingTerminal is null)
        {
            _pendingTerminal = terminal;
        }
        else if (_pendingTerminal != terminal)
        {
            WireCreationRequested?.Invoke(this, (_pendingTerminal, terminal));
            _pendingTerminal = null;
        }
        else
        {
            _pendingTerminal = null;
        }

        UpdateWireHint();
        NativeCanvas.Invalidate();
    }

    private void Select(CanvasSelection selection)
    {
        _selection = selection;
        SelectionChanged?.Invoke(this, selection);
        NativeCanvas.Invalidate();
    }

    private void UpdateWireHint()
    {
        WireHint.Visibility = _pendingTerminal is null ? Visibility.Collapsed : Visibility.Visible;
        WireHintText.Text = _pendingTerminal is null
            ? string.Empty
            : $"{_pendingTerminal.Key} 선택됨 · 연결할 두 번째 단자를 누르세요";
    }

    private void UpdateZoomText() => ZoomText.Text = $"{_zoom:P0}";

    private PointV4 ScreenToWorld(Point point)
    {
        Matrix3x2.Invert(ViewMatrix, out Matrix3x2 inverse);
        Vector2 world = Vector2.Transform(new Vector2((float)point.X, (float)point.Y), inverse);
        return new PointV4(world.X, world.Y);
    }

    private TerminalRefV4? HitTerminal(WorkshopDocumentV4 document, PointV4 point)
    {
        double radius = 13 / _zoom;
        foreach (DeviceInstanceV4 device in document.Devices.Reverse())
        {
            if (!_catalog.TryGet(device.ProfileId, out DeviceProfileV4 profile))
            {
                continue;
            }

            foreach (TerminalDefinitionV4 terminal in profile.Terminals)
            {
                PointV4 terminalPoint = TerminalPoint(device, terminal);
                if (Distance(point, terminalPoint) <= radius)
                {
                    return new TerminalRefV4(device.Id, terminal.Id);
                }
            }
        }

        return null;
    }

    private ConductorV4? HitConductor(WorkshopDocumentV4 document, PointV4 point)
    {
        double tolerance = 9 / _zoom;
        foreach (ConductorV4 conductor in document.Conductors.Reverse())
        {
            PointV4[] route = GetRoutePoints(document, conductor);
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

    private static DeviceInstanceV4? HitDevice(WorkshopDocumentV4 document, PointV4 point)
        => document.Devices.Reverse().FirstOrDefault(device =>
            point.X >= device.X
            && point.X <= device.X + device.Width
            && point.Y >= device.Y
            && point.Y <= device.Y + device.Height);

    private PointV4[] GetRoutePoints(WorkshopDocumentV4 document, ConductorV4 conductor)
    {
        if (!TryGetTerminalPoint(document, conductor.Start, out PointV4 start)
            || !TryGetTerminalPoint(document, conductor.End, out PointV4 end))
        {
            return [];
        }

        if (conductor.Waypoints.Length > 0)
        {
            return [start, .. conductor.Waypoints, end];
        }

        double midX = (start.X + end.X) / 2;
        return [start, new PointV4(midX, start.Y), new PointV4(midX, end.Y), end];
    }

    private bool TryGetTerminalPoint(
        WorkshopDocumentV4 document,
        TerminalRefV4 terminal,
        out PointV4 point)
    {
        DeviceInstanceV4? device = document.Devices.FirstOrDefault(item => item.Id == terminal.DeviceId);
        if (device is not null && _catalog.TryGet(device.ProfileId, out DeviceProfileV4 profile))
        {
            TerminalDefinitionV4? definition = profile.Terminals.FirstOrDefault(item => item.Id == terminal.TerminalId);
            if (definition is not null)
            {
                point = TerminalPoint(device, definition);
                return true;
            }
        }

        point = new PointV4(0, 0);
        return false;
    }

    private static PointV4 TerminalPoint(DeviceInstanceV4 device, TerminalDefinitionV4 terminal)
        => new(
            device.X + ((terminal.OffsetX / 120) * device.Width),
            device.Y + ((terminal.OffsetY / 80) * device.Height));

    private static Color TerminalColor(TerminalDefinitionV4 terminal)
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

    private static Vector2 ToVector(PointV4 point) => new((float)point.X, (float)point.Y);

    private static double Distance(PointV4 left, PointV4 right)
        => Math.Sqrt(Math.Pow(left.X - right.X, 2) + Math.Pow(left.Y - right.Y, 2));

    private static double DistanceToSegment(PointV4 point, PointV4 start, PointV4 end)
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
        return Distance(point, new PointV4(start.X + (t * dx), start.Y + (t * dy)));
    }
}
