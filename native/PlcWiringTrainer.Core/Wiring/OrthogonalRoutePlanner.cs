using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Wiring;

/// <summary>결정적 직교 경로를 계산하는 데 필요한 좌표와 비용 입력입니다.</summary>
/// <param name="Start">실제 시작 단자 좌표입니다.</param>
/// <param name="End">실제 끝 단자 좌표입니다.</param>
/// <param name="StartLeadOut">시작 단자의 이탈 방향을 보존하는 첫 좌표입니다.</param>
/// <param name="EndLeadOut">끝 단자의 진입 방향을 보존하는 마지막 내부 좌표입니다.</param>
/// <param name="ManualWaypoints">순서를 바꾸지 않고 반드시 통과할 내부 경로점입니다.</param>
/// <param name="Obstacles">경로가 내부를 관통해서는 안 되는 장비 및 금지 영역입니다.</param>
/// <param name="RouteLocked">저장된 내부 경로를 waypoint로 취급해 유지할지 나타냅니다.</param>
public sealed record RouteRequestV5(
    PointV5 Start,
    PointV5 End,
    PointV5 StartLeadOut,
    PointV5 EndLeadOut,
    PointV5[] ManualWaypoints,
    RectV5[] Obstacles,
    bool RouteLocked)
{
    /// <summary>교차 비용을 계산할 때 참고할 기존 직교 전선 경로입니다.</summary>
    public PointV5[][] ExistingRoutes { get; init; } = [];
}

/// <summary>동일 입력에 항상 같은 직교 경로를 반환하는 라우터 계약입니다.</summary>
public interface IRoutePlanner
{
    /// <summary>장애물을 관통하지 않고 기존 전선 교차 비용을 최소화하는 경로를 계산합니다.</summary>
    PointV5[] Plan(RouteRequestV5 request);
}

/// <summary>수동 경로점을 보존하면서 모든 장비 장애물을 피하는 결정적 직교 경로를 만듭니다.</summary>
public sealed class OrthogonalRoutePlanner : IRoutePlanner
{
    private const double ObstacleClearance = 12;
    private const double WireCrossingPenalty = 160;

    /// <summary>Plan 작업을 수행합니다.</summary>
    public PointV5[] Plan(RouteRequestV5 request)
    {
        ArgumentNullException.ThrowIfNull(request);
        RectV5[] activeObstacles = request.RouteLocked ? [] : request.Obstacles;
        PointV5[][] existingRoutes = request.RouteLocked ? [] : request.ExistingRoutes;
        var route = new List<PointV5> { request.Start };
        Append(route, request.StartLeadOut);
        foreach (PointV5 anchor in request.ManualWaypoints.Append(request.EndLeadOut))
        {
            PointV5[] path = FindPath(route[^1], anchor, activeObstacles, existingRoutes);
            if (path.Length == 0 && route[^1] != anchor)
            {
                return [];
            }

            AppendPath(route, path);
        }

        Append(route, request.End);
        PointV5[] result = route.ToArray();
        return result.Zip(result.Skip(1)).All(pair =>
            (pair.First.X == pair.Second.X || pair.First.Y == pair.Second.Y)
            && !CrossesAny(pair.First, pair.Second, activeObstacles))
                ? result
                : [];
    }

    private static PointV5[] FindPath(
        PointV5 start,
        PointV5 target,
        RectV5[] obstacles,
        PointV5[][] existingRoutes)
    {
        if (start == target)
        {
            return [target];
        }

        if ((start.X == target.X || start.Y == target.Y) && !CrossesAny(start, target, obstacles))
        {
            return [target];
        }

        PointV5 horizontalFirst = new(target.X, start.Y);
        PointV5 verticalFirst = new(start.X, target.Y);
        bool horizontalAvailable = !CrossesAny(start, horizontalFirst, obstacles)
            && !CrossesAny(horizontalFirst, target, obstacles);
        bool verticalAvailable = !CrossesAny(start, verticalFirst, obstacles)
            && !CrossesAny(verticalFirst, target, obstacles);
        if (horizontalAvailable || verticalAvailable)
        {
            double horizontalCost = horizontalAvailable
                ? PathCost([start, horizontalFirst, target], existingRoutes)
                : double.PositiveInfinity;
            double verticalCost = verticalAvailable
                ? PathCost([start, verticalFirst, target], existingRoutes)
                : double.PositiveInfinity;
            return horizontalCost <= verticalCost
                ? [horizontalFirst, target]
                : [verticalFirst, target];
        }

        double[] xs = obstacles
            .SelectMany(bounds => new[] { bounds.X - ObstacleClearance, bounds.X + bounds.Width + ObstacleClearance })
            .Append(start.X)
            .Append(target.X)
            .Distinct()
            .Order()
            .ToArray();
        double[] ys = obstacles
            .SelectMany(bounds => new[] { bounds.Y - ObstacleClearance, bounds.Y + bounds.Height + ObstacleClearance })
            .Append(start.Y)
            .Append(target.Y)
            .Distinct()
            .Order()
            .ToArray();
        PointV5[] nodes = xs
            .SelectMany(x => ys.Select(y => new PointV5(x, y)))
            .Where(point => !obstacles.Any(bounds => IsInsideInterior(point, bounds)))
            .OrderBy(point => point.X)
            .ThenBy(point => point.Y)
            .ToArray();
        int startIndex = Array.IndexOf(nodes, start);
        int targetIndex = Array.IndexOf(nodes, target);
        if (startIndex < 0 || targetIndex < 0)
        {
            return [];
        }

        List<(int Target, double Cost)>[] edges = Enumerable.Range(0, nodes.Length)
            .Select(_ => new List<(int Target, double Cost)>())
            .ToArray();
        AddAxisEdges(nodes, edges, obstacles, existingRoutes, horizontal: true);
        AddAxisEdges(nodes, edges, obstacles, existingRoutes, horizontal: false);

        double[] distances = Enumerable.Repeat(double.PositiveInfinity, nodes.Length).ToArray();
        int[] previous = Enumerable.Repeat(-1, nodes.Length).ToArray();
        var queue = new PriorityQueue<int, (double Distance, int Node)>();
        distances[startIndex] = 0;
        queue.Enqueue(startIndex, (0, startIndex));
        while (queue.TryDequeue(out int current, out (double Distance, int Node) priority))
        {
            if (priority.Distance > distances[current])
            {
                continue;
            }

            if (current == targetIndex)
            {
                break;
            }

            foreach ((int next, double cost) in edges[current].OrderBy(edge => edge.Target))
            {
                double candidate = distances[current] + cost;
                if (candidate < distances[next])
                {
                    distances[next] = candidate;
                    previous[next] = current;
                    queue.Enqueue(next, (candidate, next));
                }
            }
        }

        if (previous[targetIndex] < 0)
        {
            return [];
        }

        var path = new List<PointV5>();
        for (int current = targetIndex; current != startIndex; current = previous[current])
        {
            path.Add(nodes[current]);
        }

        path.Reverse();
        return Compress([start, .. path]).Skip(1).ToArray();
    }

    private static void AddAxisEdges(
        PointV5[] nodes,
        List<(int Target, double Cost)>[] edges,
        RectV5[] obstacles,
        PointV5[][] existingRoutes,
        bool horizontal)
    {
        IEnumerable<IGrouping<double, (PointV5 Point, int Index)>> groups = nodes
            .Select((point, index) => (Point: point, Index: index))
            .GroupBy(item => horizontal ? item.Point.Y : item.Point.X);
        foreach (IGrouping<double, (PointV5 Point, int Index)> group in groups)
        {
            (PointV5 Point, int Index)[] ordered = horizontal
                ? group.OrderBy(item => item.Point.X).ToArray()
                : group.OrderBy(item => item.Point.Y).ToArray();
            for (int index = 0; index < ordered.Length - 1; index++)
            {
                (PointV5 firstPoint, int firstIndex) = ordered[index];
                (PointV5 secondPoint, int secondIndex) = ordered[index + 1];
                if (CrossesAny(firstPoint, secondPoint, obstacles))
                {
                    continue;
                }

                double cost = Math.Abs(firstPoint.X - secondPoint.X) + Math.Abs(firstPoint.Y - secondPoint.Y);
                cost += CountCrossings(firstPoint, secondPoint, existingRoutes) * WireCrossingPenalty;
                edges[firstIndex].Add((secondIndex, cost));
                edges[secondIndex].Add((firstIndex, cost));
            }
        }
    }

    private static IEnumerable<PointV5> Compress(List<PointV5> points)
    {
        if (points.Count == 0)
        {
            yield break;
        }

        yield return points[0];
        for (int index = 1; index < points.Count - 1; index++)
        {
            PointV5 previous = points[index - 1];
            PointV5 current = points[index];
            PointV5 next = points[index + 1];
            if ((previous.X == current.X && current.X == next.X)
                || (previous.Y == current.Y && current.Y == next.Y))
            {
                continue;
            }

            yield return current;
        }

        if (points.Count > 1)
        {
            yield return points[^1];
        }
    }

    private static void AppendPath(List<PointV5> route, PointV5[] path)
    {
        foreach (PointV5 point in path)
        {
            Append(route, point);
        }
    }

    private static bool CrossesAny(PointV5 start, PointV5 end, RectV5[] obstacles)
        => obstacles.Any(bounds => CrossesInterior(start, end, bounds));

    private static double PathCost(PointV5[] path, PointV5[][] existingRoutes)
    {
        double cost = 0;
        for (int index = 0; index < path.Length - 1; index++)
        {
            PointV5 start = path[index];
            PointV5 end = path[index + 1];
            cost += Math.Abs(start.X - end.X) + Math.Abs(start.Y - end.Y);
            cost += CountCrossings(start, end, existingRoutes) * WireCrossingPenalty;
        }

        return cost;
    }

    private static int CountCrossings(PointV5 start, PointV5 end, PointV5[][] existingRoutes)
    {
        int count = 0;
        foreach (PointV5[] route in existingRoutes)
        {
            for (int index = 0; index < route.Length - 1; index++)
            {
                if (SegmentsCrossInside(start, end, route[index], route[index + 1]))
                {
                    count++;
                }
            }
        }

        return count;
    }

    private static bool SegmentsCrossInside(PointV5 firstStart, PointV5 firstEnd, PointV5 secondStart, PointV5 secondEnd)
    {
        bool firstHorizontal = firstStart.Y == firstEnd.Y;
        bool firstVertical = firstStart.X == firstEnd.X;
        bool secondHorizontal = secondStart.Y == secondEnd.Y;
        bool secondVertical = secondStart.X == secondEnd.X;
        if (!(firstHorizontal && secondVertical) && !(firstVertical && secondHorizontal))
        {
            return false;
        }

        PointV5 horizontalStart = firstHorizontal ? firstStart : secondStart;
        PointV5 horizontalEnd = firstHorizontal ? firstEnd : secondEnd;
        PointV5 verticalStart = firstVertical ? firstStart : secondStart;
        PointV5 verticalEnd = firstVertical ? firstEnd : secondEnd;
        return verticalStart.X > Math.Min(horizontalStart.X, horizontalEnd.X)
            && verticalStart.X < Math.Max(horizontalStart.X, horizontalEnd.X)
            && horizontalStart.Y > Math.Min(verticalStart.Y, verticalEnd.Y)
            && horizontalStart.Y < Math.Max(verticalStart.Y, verticalEnd.Y);
    }

    private static bool IsInsideInterior(PointV5 point, RectV5 bounds)
        => point.X > bounds.X && point.X < bounds.X + bounds.Width
            && point.Y > bounds.Y && point.Y < bounds.Y + bounds.Height;

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
