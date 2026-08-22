using System.Numerics;
using PlcWiringTrainer.Core.Documents;
using Windows.Foundation;

namespace PlcWiringTrainer.App.Controls;

/// <summary>캔버스의 화면 좌표와 문서 좌표 변환을 한 곳에서 관리합니다.</summary>
internal sealed class CanvasViewport
{
    public double Zoom { get; private set; } = 1;

    public double OffsetX { get; private set; } = 40;

    public double OffsetY { get; private set; } = 40;

    public Matrix3x2 Matrix => new(
        (float)Zoom,
        0,
        0,
        (float)Zoom,
        (float)OffsetX,
        (float)OffsetY);

    public void Reset(WorkshopDocumentV5? document, double viewportWidth, double viewportHeight)
    {
        double width = Math.Max(1, viewportWidth);
        double height = Math.Max(1, viewportHeight);
        if (document is null || width <= 1 || height <= 1)
        {
            Zoom = 1;
            OffsetX = 40;
            OffsetY = 40;
            return;
        }

        DeviceInstanceV5[] devices = document.Devices;
        double contentLeft = devices.Length == 0 ? 0 : devices.Min(device => device.X);
        double contentTop = devices.Length == 0 ? 0 : devices.Min(device => device.Y);
        double contentRight = devices.Length == 0
            ? document.Panel.Width
            : devices.Max(device => device.X + device.Width);
        double contentBottom = devices.Length == 0
            ? document.Panel.Height
            : devices.Max(device => device.Y + device.Height);
        double contentWidth = Math.Max(1, contentRight - contentLeft);
        double contentHeight = Math.Max(1, contentBottom - contentTop);
        Zoom = Math.Clamp(
            Math.Min((width - 96) / contentWidth, (height - 96) / contentHeight),
            0.25,
            1.5);
        CenterOn(
            contentLeft + (contentWidth / 2),
            contentTop + (contentHeight / 2),
            width,
            height);
    }

    public void Focus(RectV5 bounds, double viewportWidth, double viewportHeight)
    {
        ArgumentNullException.ThrowIfNull(bounds);
        double width = Math.Max(1, viewportWidth);
        double height = Math.Max(1, viewportHeight);
        Zoom = Math.Clamp(
            Math.Min(
                Math.Max(200, width - 160) / bounds.Width,
                Math.Max(200, height - 160) / bounds.Height),
            0.4,
            3.5);
        CenterOn(
            bounds.X + (bounds.Width / 2),
            bounds.Y + (bounds.Height / 2),
            width,
            height);
    }

    public void Pan(double deltaX, double deltaY)
    {
        OffsetX += deltaX;
        OffsetY += deltaY;
    }

    public void ZoomAt(Point screen, double factor)
    {
        PointV5 before = ScreenToWorld(screen);
        Zoom = Math.Clamp(Zoom * factor, 0.25, 4);
        OffsetX = screen.X - (before.X * Zoom);
        OffsetY = screen.Y - (before.Y * Zoom);
    }

    public PointV5 ScreenToWorld(Point screen)
    {
        if (!Matrix3x2.Invert(Matrix, out Matrix3x2 inverse))
        {
            throw new InvalidOperationException("캔버스 좌표 변환 행렬을 역변환할 수 없습니다.");
        }

        Vector2 world = Vector2.Transform(new Vector2((float)screen.X, (float)screen.Y), inverse);
        return new PointV5(world.X, world.Y);
    }

    public Point WorldToScreen(PointV5 world)
    {
        Vector2 screen = Vector2.Transform(
            new Vector2((float)world.X, (float)world.Y),
            Matrix);
        return new Point(screen.X, screen.Y);
    }

    private void CenterOn(double worldX, double worldY, double viewportWidth, double viewportHeight)
    {
        OffsetX = (viewportWidth / 2) - (worldX * Zoom);
        OffsetY = (viewportHeight / 2) - (worldY * Zoom);
    }
}
