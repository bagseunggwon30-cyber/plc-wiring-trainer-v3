using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Wiring;

/// <summary>장비 회전을 포함한 단자 좌표와 선택 영역 변환을 제공합니다.</summary>
public static class DeviceTransform
{
    public static PointV5 TerminalToWorld(
        DeviceInstanceV5 device,
        PointV5 profileSize,
        PointV5 terminalOffset)
    {
        ArgumentNullException.ThrowIfNull(device);
        double profileWidth = Math.Max(1, profileSize.X);
        double profileHeight = Math.Max(1, profileSize.Y);
        double localX = device.X + ((terminalOffset.X / profileWidth) * device.Width);
        double localY = device.Y + ((terminalOffset.Y / profileHeight) * device.Height);
        return RotateAroundCenter(device, new PointV5(localX, localY), device.Rotation);
    }

    public static bool Contains(DeviceInstanceV5 device, PointV5 worldPoint)
    {
        ArgumentNullException.ThrowIfNull(device);
        PointV5 local = RotateAroundCenter(device, worldPoint, -device.Rotation);
        return local.X >= device.X
            && local.X <= device.X + device.Width
            && local.Y >= device.Y
            && local.Y <= device.Y + device.Height;
    }

    public static RectV5 AxisAlignedBounds(DeviceInstanceV5 device)
    {
        PointV5[] corners =
        [
            new(device.X, device.Y),
            new(device.X + device.Width, device.Y),
            new(device.X + device.Width, device.Y + device.Height),
            new(device.X, device.Y + device.Height),
        ];
        PointV5[] rotated = corners.Select(point => RotateAroundCenter(device, point, device.Rotation)).ToArray();
        double minX = rotated.Min(point => point.X);
        double minY = rotated.Min(point => point.Y);
        return new RectV5(
            minX,
            minY,
            rotated.Max(point => point.X) - minX,
            rotated.Max(point => point.Y) - minY);
    }

    private static PointV5 RotateAroundCenter(DeviceInstanceV5 device, PointV5 point, double degrees)
    {
        double radians = degrees * Math.PI / 180;
        double cosine = Math.Cos(radians);
        double sine = Math.Sin(radians);
        double centerX = device.X + (device.Width / 2);
        double centerY = device.Y + (device.Height / 2);
        double x = point.X - centerX;
        double y = point.Y - centerY;
        return new PointV5(
            centerX + (x * cosine) - (y * sine),
            centerY + (x * sine) + (y * cosine));
    }
}
