using PlcWiringTrainer.App.Controls;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Wiring;
using PlcWiringTrainer.Core.Workbench;

namespace PlcWiringTrainer.App.Workbench;

/// <summary>WinUI 입력을 문서 편집 명령으로 모아 캔버스의 직접 변경을 차단합니다.</summary>
internal sealed class WorkbenchCommandDispatcher
{
    private readonly Func<WorkbenchStore> _store;

    public WorkbenchCommandDispatcher(Func<WorkbenchStore> store)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
    }

    public void AddDevice(DeviceInstanceV5 device) => _store().AddDevice(device);

    public void AddConductor(ConductorV5 conductor) => _store().AddConductor(conductor);

    public void UpdateDevice(string id, Func<DeviceInstanceV5, DeviceInstanceV5> update)
        => _store().UpdateDevice(id, update);

    public void UpdateConductor(string id, Func<ConductorV5, ConductorV5> update)
        => _store().UpdateConductor(id, update);

    public void RemoveDevice(string id) => _store().RemoveDevice(id);

    public void RemoveConductor(string id) => _store().RemoveConductor(id);

    public void Apply(ConductorEditRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        UpdateConductor(request.ConductorId, conductor => request.Kind switch
        {
            ConductorEditKind.ReplaceWaypoints => conductor with
            {
                Waypoints = request.Waypoints ?? throw Missing(nameof(request.Waypoints)),
            },
            ConductorEditKind.ChangeColor => WireRouteEditor.ChangeColor(
                conductor,
                request.Color ?? throw Missing(nameof(request.Color))),
            ConductorEditKind.InsertWaypoint => WireRouteEditor.InsertWaypoint(
                conductor,
                request.WaypointIndex,
                request.Waypoint ?? throw Missing(nameof(request.Waypoint))),
            ConductorEditKind.ToggleRouteLock => conductor with { RouteLocked = !conductor.RouteLocked },
            ConductorEditKind.ClearWaypoints => WireRouteEditor.ClearWaypoints(conductor),
            ConductorEditKind.ReconnectStart => conductor with
            {
                Start = request.Terminal ?? throw Missing(nameof(request.Terminal)),
            },
            ConductorEditKind.ReconnectEnd => conductor with
            {
                End = request.Terminal ?? throw Missing(nameof(request.Terminal)),
            },
            _ => throw new ArgumentOutOfRangeException(nameof(request)),
        });
    }

    private static InvalidOperationException Missing(string member)
        => new($"캔버스 편집 명령에 {member} 값이 없습니다.");
}
