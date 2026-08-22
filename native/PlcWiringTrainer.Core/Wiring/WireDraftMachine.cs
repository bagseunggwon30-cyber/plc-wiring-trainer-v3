using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Wiring;

/// <summary>WireDraftV5 공개 계약을 나타냅니다.</summary>
/// <param name="Start">Start 계약 값입니다.</param>
/// <param name="Waypoints">Waypoints 계약 값입니다.</param>
/// <param name="DragInitiated">DragInitiated 계약 값입니다.</param>
public sealed record WireDraftV5(
    TerminalRefV5 Start,
    PointV5[] Waypoints,
    bool DragInitiated);

/// <summary>클릭 결선과 드래그 결선이 공유하는 비영속 상태기입니다.</summary>
public sealed class WireDraftMachine
{
    /// <summary>Current 값을 제공합니다.</summary>
    public WireDraftV5? Current { get; private set; }

    /// <summary>Begin 작업을 수행합니다.</summary>
    public void Begin(TerminalRefV5 start, bool dragInitiated)
    {
        ArgumentNullException.ThrowIfNull(start);
        Current = new WireDraftV5(start, [], dragInitiated);
    }

    /// <summary>ToggleTerminal 작업을 수행합니다.</summary>
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

    /// <summary>AddWaypoint 작업을 수행합니다.</summary>
    public void AddWaypoint(PointV5 point)
    {
        EnsureActive();
        Current = Current! with { Waypoints = [.. Current.Waypoints, point] };
    }

    /// <summary>RemoveLastWaypoint 작업을 수행합니다.</summary>
    public bool RemoveLastWaypoint()
    {
        if (Current is null || Current.Waypoints.Length == 0)
        {
            return false;
        }

        Current = Current with { Waypoints = Current.Waypoints[..^1] };
        return true;
    }

    /// <summary>Cancel 작업을 수행합니다.</summary>
    public void Cancel() => Current = null;

    /// <summary>Complete 작업을 수행합니다.</summary>
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
