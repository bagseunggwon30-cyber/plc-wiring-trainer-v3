using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.App.Controls;

public enum ConductorEditKind
{
    ReplaceWaypoints,
    ChangeColor,
    InsertWaypoint,
    ToggleRouteLock,
    ClearWaypoints,
    ReconnectStart,
    ReconnectEnd,
}

public sealed record ConductorEditRequest(
    ConductorEditKind Kind,
    string ConductorId,
    TerminalRefV5? Terminal = null,
    PointV5[]? Waypoints = null,
    string? Color = null,
    int WaypointIndex = -1,
    PointV5? Waypoint = null);
