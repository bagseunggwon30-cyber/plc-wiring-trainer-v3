using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Wiring;

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
        if ((start.X == target.X || start.Y == target.Y) && !CrossesAny(start, target, obstacles))
        {
            Append(route, target);
            return;
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
