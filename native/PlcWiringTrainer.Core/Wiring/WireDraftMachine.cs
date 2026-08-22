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
