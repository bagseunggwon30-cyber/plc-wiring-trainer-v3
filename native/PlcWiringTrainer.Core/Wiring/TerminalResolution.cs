using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Wiring;

internal sealed record ResolvedTerminal(
    TerminalRefV5 Reference,
    DeviceInstanceV5 Device,
    DeviceProfileV5 Profile,
    TerminalDefinitionV5 Terminal,
    int MaximumConductors);

internal sealed class TerminalResolver
{
    private readonly DeviceProfileCatalog _catalog;

    public TerminalResolver(DeviceProfileCatalog catalog)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
    }

    public bool TryResolve(WorkshopDocumentV5 document, TerminalRefV5 reference, out ResolvedTerminal resolved)
    {
        DeviceInstanceV5? device = document.Devices.FirstOrDefault(item => item.Id == reference.DeviceId);
        if (device is null || !_catalog.TryGet(device.ProfileId, out DeviceProfileV5 profile))
        {
            resolved = null!;
            return false;
        }

        TerminalDefinitionV5? terminal = profile.Terminals.FirstOrDefault(item =>
            item.Id == reference.TerminalId
            || item.Aliases.Contains(reference.TerminalId, StringComparer.Ordinal));
        if (terminal is null)
        {
            resolved = null!;
            return false;
        }

        int maximumConductors = document.TerminalAssemblies
            .Where(assembly => assembly.DeviceId == device.Id
                && assembly.TerminalIds.Contains(terminal.Id, StringComparer.Ordinal)
                && assembly.MaximumConductorsPerTerminal is > 0)
            .Select(assembly => assembly.MaximumConductorsPerTerminal!.Value)
            .DefaultIfEmpty(terminal.MaxConductors)
            .Min();
        resolved = new ResolvedTerminal(
            new TerminalRefV5(device.Id, terminal.Id),
            device,
            profile,
            terminal,
            maximumConductors);
        return true;
    }

    public int CountOccupancy(WorkshopDocumentV5 document, ResolvedTerminal terminal, string? excludingConductorId = null)
    {
        int conductorCount = document.Conductors
            .Where(conductor => !string.Equals(conductor.Id, excludingConductorId, StringComparison.Ordinal))
            .SelectMany(conductor => new[] { conductor.Start, conductor.End })
            .Count(reference => IsSame(document, terminal.Reference, reference));
        int bridgeCount = document.TerminalBridges
            .SelectMany(bridge => bridge.Terminals)
            .Count(reference => IsSame(document, terminal.Reference, reference));
        return conductorCount + bridgeCount;
    }

    public bool IsSame(WorkshopDocumentV5 document, TerminalRefV5 left, TerminalRefV5 right)
    {
        if (!TryResolve(document, left, out ResolvedTerminal? resolvedLeft)
            || !TryResolve(document, right, out ResolvedTerminal? resolvedRight))
        {
            return left == right;
        }

        return resolvedLeft.Reference == resolvedRight.Reference;
    }
}
