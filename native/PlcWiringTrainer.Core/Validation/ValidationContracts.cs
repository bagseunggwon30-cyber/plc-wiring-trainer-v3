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

public sealed record ValidationTargetV4(
    ValidationTargetKind Kind,
    string Id,
    string? DeviceId = null,
    string? TerminalId = null);

/// <summary>검증 목록과 캔버스 탐색을 연결하는 형식화된 문제 계약입니다.</summary>
public sealed record ValidationIssueV4(
    string Code,
    ValidationSeverity Severity,
    bool Blocking,
    string Message,
    int Revision,
    string ContentHash,
    ValidationTargetV4[] Targets,
    string ScenarioId);

public sealed record SimulationResultV4(string[] EnergizedDeviceIds);

public sealed record ValidationResultV4(
    int Revision,
    string ContentHash,
    ValidationIssueV4[] Issues,
    SimulationResultV4 Simulation);

public interface IValidationService
{
    Task<ValidationResultV4> ValidateAsync(
        WorkshopDocumentV4 document,
        CancellationToken cancellationToken = default);
}
