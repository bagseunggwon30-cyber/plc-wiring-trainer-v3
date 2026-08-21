using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Navigation;

public enum NavigationSelectionKind
{
    Conductor,
    Terminal,
    Device,
}

public sealed record NavigationTarget(
    NavigationSelectionKind Kind,
    string Id,
    RectV4 FocusBounds,
    string? DeviceId = null,
    string? TerminalId = null);

/// <summary>검증 대상의 우선순위를 실제 캔버스 선택과 이동 범위로 해석합니다.</summary>
public static class IssueNavigator
{
    public static NavigationTarget? Resolve(WorkshopDocumentV4 document, ValidationIssueV4 issue)
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
        WorkshopDocumentV4 document,
        IEnumerable<ValidationTargetV4> targets)
    {
        foreach (ValidationTargetV4 target in targets.Where(item => item.Kind == ValidationTargetKind.Conductor))
        {
            ConductorV4? conductor = document.Conductors.FirstOrDefault(item => item.Id == target.Id);
            if (conductor is not null)
            {
                return FromConductor(document, conductor);
            }
        }

        return null;
    }

    private static NavigationTarget? ResolveTerminal(
        WorkshopDocumentV4 document,
        IEnumerable<ValidationTargetV4> targets)
    {
        foreach (ValidationTargetV4 target in targets.Where(item => item.Kind == ValidationTargetKind.Terminal))
        {
            if (string.IsNullOrWhiteSpace(target.DeviceId) || string.IsNullOrWhiteSpace(target.TerminalId))
            {
                continue;
            }

            var terminal = new TerminalRefV4(target.DeviceId, target.TerminalId);
            ConductorV4? incident = document.Conductors.FirstOrDefault(
                conductor => conductor.Start == terminal || conductor.End == terminal);
            if (incident is not null)
            {
                return FromConductor(document, incident);
            }

            DeviceInstanceV4? device = document.Devices.FirstOrDefault(item => item.Id == target.DeviceId);
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
        WorkshopDocumentV4 document,
        IEnumerable<ValidationTargetV4> targets)
    {
        foreach (ValidationTargetV4 target in targets.Where(item => item.Kind == ValidationTargetKind.Device))
        {
            string deviceId = target.DeviceId ?? target.Id;
            DeviceInstanceV4? device = document.Devices.FirstOrDefault(item => item.Id == deviceId);
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

    private static NavigationTarget FromConductor(WorkshopDocumentV4 document, ConductorV4 conductor)
    {
        var points = new List<PointV4>();
        AddTerminalPoint(document, conductor.Start, points);
        points.AddRange(conductor.Waypoints);
        AddTerminalPoint(document, conductor.End, points);
        if (points.Count == 0)
        {
            points.Add(new PointV4(0, 0));
        }

        double minX = points.Min(point => point.X);
        double maxX = points.Max(point => point.X);
        double minY = points.Min(point => point.Y);
        double maxY = points.Max(point => point.Y);
        var bounds = new RectV4(minX, minY, Math.Max(1, maxX - minX), Math.Max(1, maxY - minY)).Inflate(64);
        return new NavigationTarget(NavigationSelectionKind.Conductor, conductor.Id, bounds);
    }

    private static void AddTerminalPoint(
        WorkshopDocumentV4 document,
        TerminalRefV4 terminal,
        List<PointV4> points)
    {
        DeviceInstanceV4? device = document.Devices.FirstOrDefault(item => item.Id == terminal.DeviceId);
        if (device is not null)
        {
            points.Add(new PointV4(device.X + (device.Width / 2), device.Y + (device.Height / 2)));
        }
    }

    private static RectV4 DeviceBounds(DeviceInstanceV4 device)
        => new(device.X, device.Y, Math.Max(1, device.Width), Math.Max(1, device.Height));
}
