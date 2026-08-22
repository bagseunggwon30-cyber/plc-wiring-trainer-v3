using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Wiring;

/// <summary>완료된 전선의 수동 경로와 표시 색을 한 규칙으로 편집합니다.</summary>
public static class WireRouteEditor
{
    public static ConductorV5 InsertWaypoint(ConductorV5 conductor, int index, PointV5 point)
    {
        ArgumentNullException.ThrowIfNull(conductor);
        if (conductor.RouteLocked)
        {
            return conductor;
        }

        ArgumentOutOfRangeException.ThrowIfNegative(index);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(index, conductor.Waypoints.Length);
        return conductor with
        {
            Waypoints = [.. conductor.Waypoints[..index], point, .. conductor.Waypoints[index..]],
        };
    }

    public static ConductorV5 MoveWaypoint(ConductorV5 conductor, int index, PointV5 point)
    {
        ArgumentNullException.ThrowIfNull(conductor);
        if (conductor.RouteLocked)
        {
            return conductor;
        }

        ArgumentOutOfRangeException.ThrowIfNegative(index);
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(index, conductor.Waypoints.Length);
        PointV5[] waypoints = [.. conductor.Waypoints];
        waypoints[index] = point;
        return conductor with { Waypoints = waypoints };
    }

    public static ConductorV5 ClearWaypoints(ConductorV5 conductor)
    {
        ArgumentNullException.ThrowIfNull(conductor);
        return conductor.RouteLocked || conductor.Waypoints.Length == 0
            ? conductor
            : conductor with { Waypoints = [] };
    }

    public static ConductorV5 ChangeColor(ConductorV5 conductor, string color)
    {
        ArgumentNullException.ThrowIfNull(conductor);
        ArgumentException.ThrowIfNullOrWhiteSpace(color);
        return conductor.Color == color ? conductor : conductor with { Color = color };
    }
}
