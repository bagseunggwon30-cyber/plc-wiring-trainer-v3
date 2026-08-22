using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Validation;

/// <summary>ValidationSeverity 값의 종류를 정의합니다.</summary>
public enum ValidationSeverity
{
    /// <summary>Error 상태를 나타냅니다.</summary>
    Error,
    /// <summary>Warning 상태를 나타냅니다.</summary>
    Warning,
    /// <summary>Information 상태를 나타냅니다.</summary>
    Information,
}

/// <summary>ValidationTargetKind 값의 종류를 정의합니다.</summary>
public enum ValidationTargetKind
{
    /// <summary>Conductor 상태를 나타냅니다.</summary>
    Conductor,
    /// <summary>Terminal 상태를 나타냅니다.</summary>
    Terminal,
    /// <summary>Device 상태를 나타냅니다.</summary>
    Device,
}

/// <summary>ValidationTargetV5 공개 계약을 나타냅니다.</summary>
/// <param name="Kind">Kind 계약 값입니다.</param>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="DeviceId">DeviceId 계약 값입니다.</param>
/// <param name="TerminalId">TerminalId 계약 값입니다.</param>
public sealed record ValidationTargetV5(
    ValidationTargetKind Kind,
    string Id,
    string? DeviceId = null,
    string? TerminalId = null);

/// <summary>검증 목록과 캔버스 탐색을 연결하는 형식화된 문제 계약입니다.</summary>
/// <param name="Code">UI 문구와 독립적으로 유지되는 회귀 검사용 문제 코드입니다.</param>
/// <param name="Severity">목록 정렬과 표시에 사용하는 심각도입니다.</param>
/// <param name="Blocking">사전결선 승인이나 편집 확정을 막는 문제인지 나타냅니다.</param>
/// <param name="Message">사용자에게 보여 줄 한국어 설명입니다.</param>
/// <param name="Revision">검증을 시작한 문서 revision입니다.</param>
/// <param name="ContentHash">검증을 시작한 canonical content hash입니다.</param>
/// <param name="Targets">전선, 단자, 장비 순으로 문제 위치를 찾는 형식화된 대상입니다.</param>
/// <param name="ScenarioId">문제가 특정 시나리오에 속하면 그 ID이고 아니면 빈 문자열입니다.</param>
public sealed record ValidationIssueV5(
    string Code,
    ValidationSeverity Severity,
    bool Blocking,
    string Message,
    int Revision,
    string ContentHash,
    ValidationTargetV5[] Targets,
    string ScenarioId);

/// <summary>TerminalElectricalStateV5 공개 계약을 나타냅니다.</summary>
/// <param name="TerminalKey">TerminalKey 계약 값입니다.</param>
/// <param name="ConductionGroup">ConductionGroup 계약 값입니다.</param>
/// <param name="Potential">Potential 계약 값입니다.</param>
/// <param name="Voltage">Voltage 계약 값입니다.</param>
public sealed record TerminalElectricalStateV5(
    string TerminalKey,
    string ConductionGroup,
    TerminalPotential Potential,
    double? Voltage);

/// <summary>CircuitPathV5 공개 계약을 나타냅니다.</summary>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="Kind">Kind 계약 값입니다.</param>
/// <param name="TerminalKeys">TerminalKeys 계약 값입니다.</param>
/// <param name="ConductorIds">ConductorIds 계약 값입니다.</param>
public sealed record CircuitPathV5(
    string Id,
    string Kind,
    string[] TerminalKeys,
    string[] ConductorIds);

/// <summary>SimulationResultV5 공개 계약을 나타냅니다.</summary>
/// <param name="EnergizedDeviceIds">EnergizedDeviceIds 계약 값입니다.</param>
public sealed record SimulationResultV5(string[] EnergizedDeviceIds)
{
    /// <summary>TerminalStates 값을 제공합니다.</summary>
    public TerminalElectricalStateV5[] TerminalStates { get; init; } = [];

    /// <summary>ConductionGroups 값을 제공합니다.</summary>
    public Dictionary<string, string[]> ConductionGroups { get; init; } = new(StringComparer.Ordinal);

    /// <summary>ConductorCurrents 값을 제공합니다.</summary>
    public Dictionary<string, double?> ConductorCurrents { get; init; } = new(StringComparer.Ordinal);

    /// <summary>ContactStates 값을 제공합니다.</summary>
    public Dictionary<string, bool> ContactStates { get; init; } = new(StringComparer.Ordinal);

    /// <summary>Paths 값을 제공합니다.</summary>
    public CircuitPathV5[] Paths { get; init; } = [];

    /// <summary>Iterations 값을 제공합니다.</summary>
    public int Iterations { get; init; } = 1;

    /// <summary>Converged 값을 제공합니다.</summary>
    public bool Converged { get; init; } = true;
}

/// <summary>CircuitSolutionV5 공개 계약을 나타냅니다.</summary>
/// <param name="Revision">Revision 계약 값입니다.</param>
/// <param name="ContentHash">ContentHash 계약 값입니다.</param>
/// <param name="Simulation">Simulation 계약 값입니다.</param>
/// <param name="ElectricalIssues">ElectricalIssues 계약 값입니다.</param>
public sealed record CircuitSolutionV5(
    int Revision,
    string ContentHash,
    SimulationResultV5 Simulation,
    ValidationIssueV5[] ElectricalIssues);

/// <summary>ValidationResultV5 공개 계약을 나타냅니다.</summary>
/// <param name="Revision">Revision 계약 값입니다.</param>
/// <param name="ContentHash">ContentHash 계약 값입니다.</param>
/// <param name="Issues">Issues 계약 값입니다.</param>
/// <param name="Simulation">Simulation 계약 값입니다.</param>
public sealed record ValidationResultV5(
    int Revision,
    string ContentHash,
    ValidationIssueV5[] Issues,
    SimulationResultV5 Simulation);

/// <summary>현재 문서 revision과 content hash에 결합된 전기·물리 검증 결과를 계산합니다.</summary>
public interface IValidationService
{
    /// <summary>취소 가능한 오프라인 검증을 수행합니다. 호출자는 결과의 revision/hash가 최신 문서와 같은 경우에만 표시해야 합니다.</summary>
    Task<ValidationResultV5> ValidateAsync(
        WorkshopDocumentV5 document,
        CancellationToken cancellationToken = default);
}

/// <summary>문서와 단자 프로필에서 파생한 회로 해를 계산합니다.</summary>
public interface ICircuitService
{
    /// <summary>회로의 전위, 도통과 장비 상태를 비동기로 풉니다. solver 중간 모델은 문서에 저장하지 않습니다.</summary>
    Task<CircuitSolutionV5> SolveAsync(
        WorkshopDocumentV5 document,
        CancellationToken cancellationToken = default);
}

/// <summary>IVirtualMeterService 값을 제공합니다.</summary>
public interface IVirtualMeterService
{
    /// <summary>MeasureVoltage 작업을 수행합니다.</summary>
    double? MeasureVoltage(
        CircuitSolutionV5 solution,
        TerminalRefV5 positiveProbe,
        TerminalRefV5 negativeProbe);
}
