using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Wiring;

namespace PlcWiringTrainer.App.Controls;

/// <summary>단자, 전선, 장비 순서의 hit-test를 렌더링 입력과 같은 좌표 계약으로 계산합니다.</summary>
internal sealed class CanvasHitTester
{
    private readonly DeviceProfileCatalog _catalog;

    public CanvasHitTester(DeviceProfileCatalog catalog)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
    }

    public TerminalRefV5? Terminal(WorkshopDocumentV5 document, PointV5 point, double zoom)
    {
        double radius = 13 / zoom;
        foreach (DeviceInstanceV5 device in document.Devices.Reverse())
        {
            if (!_catalog.TryGet(device.ProfileId, out DeviceProfileV5 profile))
            {
                continue;
            }

            foreach (TerminalDefinitionV5 terminal in profile.Terminals)
            {
                PointV5 terminalPoint = DeviceTransform.TerminalToWorld(
                    device,
                    new PointV5(profile.DefaultWidth, profile.DefaultHeight),
                    new PointV5(terminal.OffsetX, terminal.OffsetY));
                if (Distance(point, terminalPoint) <= radius)
                {
                    return new TerminalRefV5(device.Id, terminal.Id);
                }
            }
        }

        return null;
    }

    public static ConductorV5? Conductor(
        WorkshopDocumentV5 document,
        PointV5 point,
        double zoom,
        Func<ConductorV5, PointV5[]> route)
    {
        double tolerance = 9 / zoom;
        foreach (ConductorV5 conductor in document.Conductors.Reverse())
        {
            PointV5[] points = route(conductor);
            for (int index = 0; index < points.Length - 1; index++)
            {
                if (DistanceToSegment(point, points[index], points[index + 1]) <= tolerance)
                {
                    return conductor;
                }
            }
        }

        return null;
    }

    public static DeviceInstanceV5? Device(WorkshopDocumentV5 document, PointV5 point)
        => document.Devices.Reverse().FirstOrDefault(device => DeviceTransform.Contains(device, point));

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

        double amount = Math.Clamp(
            (((point.X - start.X) * dx) + ((point.Y - start.Y) * dy)) / ((dx * dx) + (dy * dy)),
            0,
            1);
        return Distance(point, new PointV5(start.X + (amount * dx), start.Y + (amount * dy)));
    }
}
