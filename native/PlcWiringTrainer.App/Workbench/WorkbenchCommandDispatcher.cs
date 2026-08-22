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

    public bool TryAddDevice(DeviceInstanceV5 device, Func<WorkshopDocumentV5, bool> candidateGuard)
        => _store().TryAddDevice(device, candidateGuard);

    public ConnectionAssessmentV5 AddConductor(ConductorV5 conductor) => _store().AddConductor(conductor);

    public ConnectionAssessmentV5 AddTerminalBridge(TerminalBridgeV5 bridge)
        => _store().AddTerminalBridge(bridge);

    public void UpdateDevice(string id, Func<DeviceInstanceV5, DeviceInstanceV5> update)
        => _store().UpdateDevice(id, update);

    public bool TryUpdateDevice(
        string id,
        Func<DeviceInstanceV5, DeviceInstanceV5> update,
        Func<WorkshopDocumentV5, bool> candidateGuard)
        => _store().TryUpdateDevice(id, update, candidateGuard);

    public void UpdateConductor(string id, Func<ConductorV5, ConductorV5> update)
        => _store().UpdateConductor(id, update);

    public void RemoveDevice(string id) => _store().RemoveDevice(id);

    public void RemoveConductor(string id) => _store().RemoveConductor(id);

    public void RemoveConductors(IReadOnlyCollection<string> ids) => _store().RemoveConductors(ids);

    public void ChangeConductorColors(IReadOnlyCollection<string> ids, string color)
        => _store().UpdateConductors(ids, conductor => WireRouteEditor.ChangeColor(conductor, color));

    public void ReplaceUnlockedRoutes(IReadOnlyDictionary<string, PointV5[]> routes)
        => _store().ReplaceUnlockedRoutes(routes);

    public ConnectionAssessmentV5? Apply(ConductorEditRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Kind is ConductorEditKind.ReconnectStart or ConductorEditKind.ReconnectEnd)
        {
            return _store().ReconnectConductor(
                request.ConductorId,
                request.Kind == ConductorEditKind.ReconnectStart,
                request.Terminal ?? throw Missing(nameof(request.Terminal)));
        }

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
            ConductorEditKind.ToggleRouteLock => conductor.RouteLocked
                ? WireRouteEditor.UnlockRoute(conductor)
                : WireRouteEditor.LockRoute(
                    conductor,
                    request.Waypoints ?? throw Missing(nameof(request.Waypoints))),
            ConductorEditKind.ClearWaypoints => WireRouteEditor.ClearWaypoints(conductor),
            _ => throw new ArgumentOutOfRangeException(nameof(request)),
        });
        return null;
    }

    private static InvalidOperationException Missing(string member)
        => new($"캔버스 편집 명령에 {member} 값이 없습니다.");
}
