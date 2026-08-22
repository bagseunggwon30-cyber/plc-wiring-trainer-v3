using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Validation;

public enum ValidationSeverity
{
    Error,
    Warning,
    Information,
}

public enum ValidationTargetKind
{
    Conductor,
    Terminal,
    Device,
}

public sealed record ValidationTargetV5(
    ValidationTargetKind Kind,
    string Id,
    string? DeviceId = null,
    string? TerminalId = null);

/// <summary>검증 목록과 캔버스 탐색을 연결하는 형식화된 문제 계약입니다.</summary>
public sealed record ValidationIssueV5(
    string Code,
    ValidationSeverity Severity,
    bool Blocking,
    string Message,
    int Revision,
    string ContentHash,
    ValidationTargetV5[] Targets,
    string ScenarioId);

public sealed record TerminalElectricalStateV5(
    string TerminalKey,
    string ConductionGroup,
    TerminalPotential Potential,
    double? Voltage);

public sealed record CircuitPathV5(
    string Id,
    string Kind,
    string[] TerminalKeys,
    string[] ConductorIds);

public sealed record SimulationResultV5(string[] EnergizedDeviceIds)
{
    public TerminalElectricalStateV5[] TerminalStates { get; init; } = [];

    public Dictionary<string, string[]> ConductionGroups { get; init; } = new(StringComparer.Ordinal);

    public Dictionary<string, double?> ConductorCurrents { get; init; } = new(StringComparer.Ordinal);

    public Dictionary<string, bool> ContactStates { get; init; } = new(StringComparer.Ordinal);

    public CircuitPathV5[] Paths { get; init; } = [];

    public int Iterations { get; init; } = 1;

    public bool Converged { get; init; } = true;
}

public sealed record CircuitSolutionV5(
    int Revision,
    string ContentHash,
    SimulationResultV5 Simulation,
    ValidationIssueV5[] ElectricalIssues);

public sealed record ValidationResultV5(
    int Revision,
    string ContentHash,
    ValidationIssueV5[] Issues,
    SimulationResultV5 Simulation);

/// <summary>현재 문서 revision과 content hash에 결합된 전기·물리 검증 결과를 계산합니다.</summary>
public interface IValidationService
{
    /// <summary>취소 가능한 오프라인 검증을 수행합니다.</summary>
    Task<ValidationResultV5> ValidateAsync(
        WorkshopDocumentV5 document,
        CancellationToken cancellationToken = default);
}

/// <summary>문서와 단자 프로필에서 파생한 회로 해를 계산합니다.</summary>
public interface ICircuitService
{
    /// <summary>회로의 전위, 도통과 장비 상태를 비동기로 풉니다.</summary>
    Task<CircuitSolutionV5> SolveAsync(
        WorkshopDocumentV5 document,
        CancellationToken cancellationToken = default);
}

public interface IVirtualMeterService
{
    double? MeasureVoltage(
        CircuitSolutionV5 solution,
        TerminalRefV5 positiveProbe,
        TerminalRefV5 negativeProbe);
}
