using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Navigation;

/// <summary>NavigationSelectionKind 값의 종류를 정의합니다.</summary>
public enum NavigationSelectionKind
{
    /// <summary>Conductor 상태를 나타냅니다.</summary>
    Conductor,
    /// <summary>Terminal 상태를 나타냅니다.</summary>
    Terminal,
    /// <summary>Device 상태를 나타냅니다.</summary>
    Device,
}

/// <summary>NavigationTarget 공개 계약을 나타냅니다.</summary>
/// <param name="Kind">Kind 계약 값입니다.</param>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="FocusBounds">FocusBounds 계약 값입니다.</param>
/// <param name="DeviceId">DeviceId 계약 값입니다.</param>
/// <param name="TerminalId">TerminalId 계약 값입니다.</param>
public sealed record NavigationTarget(
    NavigationSelectionKind Kind,
    string Id,
    RectV5 FocusBounds,
    string? DeviceId = null,
    string? TerminalId = null);

/// <summary>검증 대상의 우선순위를 실제 캔버스 선택과 이동 범위로 해석합니다.</summary>
public static class IssueNavigator
{
    /// <summary>Resolve 작업을 수행합니다.</summary>
    public static NavigationTarget? Resolve(WorkshopDocumentV5 document, ValidationIssueV5 issue)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(issue);

        NavigationTarget? conductor = ResolveConductor(document, issue.Targets);
        if (conductor is not null)
        {
            return conductor;
        }

        NavigationTarget? terminal = ResolveTerminal(document, issue.Targets);
        if (terminal is not null)
        {
            return terminal;
        }

        return ResolveDevice(document, issue.Targets);
    }

    private static NavigationTarget? ResolveConductor(
        WorkshopDocumentV5 document,
        IEnumerable<ValidationTargetV5> targets)
    {
        foreach (ValidationTargetV5 target in targets.Where(item => item.Kind == ValidationTargetKind.Conductor))
        {
            ConductorV5? conductor = document.Conductors.FirstOrDefault(item => item.Id == target.Id);
            if (conductor is not null)
            {
                return FromConductor(document, conductor);
            }
        }

        return null;
    }

    private static NavigationTarget? ResolveTerminal(
        WorkshopDocumentV5 document,
        IEnumerable<ValidationTargetV5> targets)
    {
        foreach (ValidationTargetV5 target in targets.Where(item => item.Kind == ValidationTargetKind.Terminal))
        {
            if (string.IsNullOrWhiteSpace(target.DeviceId) || string.IsNullOrWhiteSpace(target.TerminalId))
            {
                continue;
            }

            var terminal = new TerminalRefV5(target.DeviceId, target.TerminalId);
            ConductorV5? incident = document.Conductors.FirstOrDefault(
                conductor => conductor.Start == terminal || conductor.End == terminal);
            if (incident is not null)
            {
                return FromConductor(document, incident);
            }

            DeviceInstanceV5? device = document.Devices.FirstOrDefault(item => item.Id == target.DeviceId);
            if (device is not null)
            {
                return new NavigationTarget(
                    NavigationSelectionKind.Terminal,
                    terminal.Key,
                    DeviceBounds(device).Inflate(48),
                    device.Id,
                    terminal.TerminalId);
            }
        }

        return null;
    }

    private static NavigationTarget? ResolveDevice(
        WorkshopDocumentV5 document,
        IEnumerable<ValidationTargetV5> targets)
    {
        foreach (ValidationTargetV5 target in targets.Where(item => item.Kind == ValidationTargetKind.Device))
        {
            string deviceId = target.DeviceId ?? target.Id;
            DeviceInstanceV5? device = document.Devices.FirstOrDefault(item => item.Id == deviceId);
            if (device is not null)
            {
                return new NavigationTarget(
                    NavigationSelectionKind.Device,
                    device.Id,
                    DeviceBounds(device).Inflate(48),
                    device.Id);
            }
        }

        return null;
    }

    private static NavigationTarget FromConductor(WorkshopDocumentV5 document, ConductorV5 conductor)
    {
        var points = new List<PointV5>();
        AddTerminalPoint(document, conductor.Start, points);
        points.AddRange(conductor.Waypoints);
        AddTerminalPoint(document, conductor.End, points);
        if (points.Count == 0)
        {
            points.Add(new PointV5(0, 0));
        }

        double minX = points.Min(point => point.X);
        double maxX = points.Max(point => point.X);
        double minY = points.Min(point => point.Y);
        double maxY = points.Max(point => point.Y);
        var bounds = new RectV5(minX, minY, Math.Max(1, maxX - minX), Math.Max(1, maxY - minY)).Inflate(64);
        return new NavigationTarget(NavigationSelectionKind.Conductor, conductor.Id, bounds);
    }

    private static void AddTerminalPoint(
        WorkshopDocumentV5 document,
        TerminalRefV5 terminal,
        List<PointV5> points)
    {
        DeviceInstanceV5? device = document.Devices.FirstOrDefault(item => item.Id == terminal.DeviceId);
        if (device is not null)
        {
            points.Add(new PointV5(device.X + (device.Width / 2), device.Y + (device.Height / 2)));
        }
    }

    private static RectV5 DeviceBounds(DeviceInstanceV5 device)
        => new(device.X, device.Y, Math.Max(1, device.Width), Math.Max(1, device.Height));
}
