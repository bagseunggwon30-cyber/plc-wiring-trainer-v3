using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Wiring;

public sealed record WireDraftV5(
    TerminalRefV5 Start,
    PointV5[] Waypoints,
    bool DragInitiated);

/// <summary>클릭 결선과 드래그 결선이 공유하는 비영속 상태기입니다.</summary>
public sealed class WireDraftMachine
{
    public WireDraftV5? Current { get; private set; }

    public void Begin(TerminalRefV5 start, bool dragInitiated)
    {
        ArgumentNullException.ThrowIfNull(start);
        Current = new WireDraftV5(start, [], dragInitiated);
    }

    public bool ToggleTerminal(TerminalRefV5 terminal, bool dragInitiated)
    {
        ArgumentNullException.ThrowIfNull(terminal);
        if (Current is null)
        {
            Begin(terminal, dragInitiated);
            return false;
        }

        if (Current.Start == terminal)
        {
            Cancel();
            return true;
        }

        return false;
    }

    public void AddWaypoint(PointV5 point)
    {
        EnsureActive();
        Current = Current! with { Waypoints = [.. Current.Waypoints, point] };
    }

    public bool RemoveLastWaypoint()
    {
        if (Current is null || Current.Waypoints.Length == 0)
        {
            return false;
        }

        Current = Current with { Waypoints = Current.Waypoints[..^1] };
        return true;
    }

    public void Cancel() => Current = null;

    public ConductorV5 Complete(
        TerminalRefV5 end,
        string id,
        string label,
        string color,
        double gaugeMm2)
    {
        EnsureActive();
        ArgumentNullException.ThrowIfNull(end);
        if (Current!.Start == end)
        {
            throw new InvalidOperationException("시작 단자와 끝 단자는 달라야 합니다.");
        }

        var conductor = new ConductorV5(
            id,
            Current.Start,
            end,
            Current.Waypoints,
            label,
            color,
            gaugeMm2,
            false);
        Current = null;
        return conductor;
    }

    private void EnsureActive()
    {
        if (Current is null)
        {
            throw new InvalidOperationException("진행 중인 결선이 없습니다.");
        }
    }
}

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

public sealed record RouteRequestV5(
    PointV5 Start,
    PointV5 End,
    PointV5 StartLeadOut,
    PointV5 EndLeadOut,
    PointV5[] ManualWaypoints,
    RectV5[] Obstacles,
    bool RouteLocked);

public interface IRoutePlanner
{
    PointV5[] Plan(RouteRequestV5 request);
}

/// <summary>수동 경로점을 보존하면서 장비 내부를 통과하지 않는 결정적 직교 경로를 만듭니다.</summary>
public sealed class OrthogonalRoutePlanner : IRoutePlanner
{
    private const double ObstacleClearance = 12;

    public PointV5[] Plan(RouteRequestV5 request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var route = new List<PointV5> { request.Start };
        Append(route, request.StartLeadOut);
        PointV5[] anchors = [.. request.ManualWaypoints, request.EndLeadOut];
        foreach (PointV5 anchor in anchors)
        {
            AppendOrthogonal(route, anchor, request.Obstacles);
        }

        Append(route, request.End);
        return route.ToArray();
    }

    private static void AppendOrthogonal(List<PointV5> route, PointV5 target, RectV5[] obstacles)
    {
        PointV5 start = route[^1];
        if (start.X == target.X || start.Y == target.Y)
        {
            if (!CrossesAny(start, target, obstacles))
            {
                Append(route, target);
                return;
            }
        }

        PointV5 horizontalFirst = new(target.X, start.Y);
        if (!CrossesAny(start, horizontalFirst, obstacles)
            && !CrossesAny(horizontalFirst, target, obstacles))
        {
            Append(route, horizontalFirst);
            Append(route, target);
            return;
        }

        PointV5 verticalFirst = new(start.X, target.Y);
        if (!CrossesAny(start, verticalFirst, obstacles)
            && !CrossesAny(verticalFirst, target, obstacles))
        {
            Append(route, verticalFirst);
            Append(route, target);
            return;
        }

        RectV5 obstacle = obstacles.First(bounds =>
            CrossesInterior(start, horizontalFirst, bounds)
            || CrossesInterior(horizontalFirst, target, bounds)
            || CrossesInterior(start, verticalFirst, bounds)
            || CrossesInterior(verticalFirst, target, bounds));
        double above = obstacle.Y - ObstacleClearance;
        double below = obstacle.Y + obstacle.Height + ObstacleClearance;
        double detourY = Math.Abs(start.Y - above) + Math.Abs(target.Y - above)
            <= Math.Abs(start.Y - below) + Math.Abs(target.Y - below)
                ? above
                : below;
        Append(route, new PointV5(start.X, detourY));
        Append(route, new PointV5(target.X, detourY));
        Append(route, target);
    }

    private static bool CrossesAny(PointV5 start, PointV5 end, RectV5[] obstacles)
        => obstacles.Any(bounds => CrossesInterior(start, end, bounds));

    private static bool CrossesInterior(PointV5 start, PointV5 end, RectV5 bounds)
    {
        if (start.X == end.X)
        {
            return start.X > bounds.X && start.X < bounds.X + bounds.Width
                && Math.Max(start.Y, end.Y) > bounds.Y
                && Math.Min(start.Y, end.Y) < bounds.Y + bounds.Height;
        }

        if (start.Y == end.Y)
        {
            return start.Y > bounds.Y && start.Y < bounds.Y + bounds.Height
                && Math.Max(start.X, end.X) > bounds.X
                && Math.Min(start.X, end.X) < bounds.X + bounds.Width;
        }

        return true;
    }

    private static void Append(List<PointV5> points, PointV5 point)
    {
        if (points.Count == 0 || points[^1] != point)
        {
            points.Add(point);
        }
    }

}
