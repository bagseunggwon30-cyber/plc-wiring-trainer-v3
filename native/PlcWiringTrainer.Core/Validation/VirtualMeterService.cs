using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Validation;

/// <summary>VirtualMeterService 값을 제공합니다.</summary>
public sealed class VirtualMeterService : IVirtualMeterService
{
    /// <summary>MeasureVoltage 작업을 수행합니다.</summary>
    public double? MeasureVoltage(
        CircuitSolutionV5 solution,
        TerminalRefV5 positiveProbe,
        TerminalRefV5 negativeProbe)
    {
        ArgumentNullException.ThrowIfNull(solution);
        ArgumentNullException.ThrowIfNull(positiveProbe);
        ArgumentNullException.ThrowIfNull(negativeProbe);
        TerminalElectricalStateV5? positive = solution.Simulation.TerminalStates
            .FirstOrDefault(state => state.TerminalKey == positiveProbe.Key);
        TerminalElectricalStateV5? negative = solution.Simulation.TerminalStates
            .FirstOrDefault(state => state.TerminalKey == negativeProbe.Key);
        return positive?.Voltage is double positiveVoltage && negative?.Voltage is double negativeVoltage
            ? positiveVoltage - negativeVoltage
            : null;
    }
}
