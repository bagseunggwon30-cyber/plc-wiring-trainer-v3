using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Validation;

public sealed class VirtualMeterService : IVirtualMeterService
{
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
