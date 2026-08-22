using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Wiring;

public enum ConnectionDispositionV5
{
    Allowed,
    Warning,
    Blocked,
}

public sealed record ConnectionAssessmentV5(
    ConnectionDispositionV5 Disposition,
    string Code,
    string Message,
    TerminalRefV5 Start,
    TerminalRefV5 End,
    bool RequiresDiagnosticOverride = false);

public interface IConnectionAssessmentService
{
    ConnectionAssessmentV5 Assess(
        WorkshopDocumentV5 document,
        TerminalRefV5 start,
        TerminalRefV5 destination);
}

/// <summary>영속 전선을 만들기 전에 연습, 사전결선, 고장 주입 정책을 판정합니다.</summary>
public sealed class ConnectionAssessmentService : IConnectionAssessmentService
{
    private readonly DeviceProfileCatalog _catalog;

    public ConnectionAssessmentService(DeviceProfileCatalog catalog)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
    }

    public ConnectionAssessmentV5 Assess(
        WorkshopDocumentV5 document,
        TerminalRefV5 start,
        TerminalRefV5 destination)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(start);
        ArgumentNullException.ThrowIfNull(destination);
        if (start == destination)
        {
            return Blocked("SAME_TERMINAL", "같은 단자를 서로 연결할 수 없습니다.", start, destination);
        }

        if (!TryResolve(document, start, out TerminalDefinitionV5? left, out DeviceProfileV5? leftProfile)
            || !TryResolve(document, destination, out TerminalDefinitionV5? right, out DeviceProfileV5? rightProfile))
        {
            return Blocked("UNKNOWN_TERMINAL", "장비 프로필에 없는 단자는 연결할 수 없습니다.", start, destination);
        }

        if (document.Conductors.Any(conductor =>
            (conductor.Start == start && conductor.End == destination)
            || (conductor.Start == destination && conductor.End == start)))
        {
            return Blocked("DUPLICATE_CONNECTION", "두 단자는 이미 연결되어 있습니다.", start, destination);
        }

        ConnectionAssessmentV5? capacity = AssessCapacity(document, start, destination, left, right);
        if (capacity is not null)
        {
            return capacity;
        }

        bool leftPe = left.Domain == TerminalDomain.ProtectiveEarth;
        bool rightPe = right.Domain == TerminalDomain.ProtectiveEarth;
        if (leftPe != rightPe)
        {
            return Risk(document, "PE_DOMAIN_MISMATCH", "PE 단자는 다른 전위나 신호 단자와 직접 연결하면 안 됩니다.", start, destination);
        }

        bool leftAc = left.Domain == TerminalDomain.AcPower;
        bool rightAc = right.Domain == TerminalDomain.AcPower;
        bool leftDc = left.Domain == TerminalDomain.DcPower;
        bool rightDc = right.Domain == TerminalDomain.DcPower;
        if ((leftAc && rightDc) || (leftDc && rightAc))
        {
            return Risk(document, "AC_DC_DOMAIN_MISMATCH", "AC 단자와 DC 단자를 직접 연결하려고 합니다.", start, destination);
        }

        if ((left.Potential == TerminalPotential.Positive24V && right.Potential == TerminalPotential.ZeroVolt)
            || (left.Potential == TerminalPotential.ZeroVolt && right.Potential == TerminalPotential.Positive24V)
            || (left.Potential == TerminalPotential.Line1 && right.Potential == TerminalPotential.Neutral)
            || (left.Potential == TerminalPotential.Neutral && right.Potential == TerminalPotential.Line1))
        {
            return Risk(document, "DIRECT_SUPPLY_SHORT", "전원측과 귀로를 부하 없이 직접 연결하려고 합니다.", start, destination);
        }

        if (leftProfile.ManualEvidence != ManualEvidenceStatusV5.ExactProduct
            || rightProfile.ManualEvidence != ManualEvidenceStatusV5.ExactProduct)
        {
            const string message = "제조사와 전체 품번이 확정되지 않은 장비는 연습 결선만 가능하며 사전결선 승인을 받을 수 없습니다.";
            return document.Mode == WorkshopMode.Prewire
                ? Blocked("MANUAL_EVIDENCE_REQUIRED", message, start, destination)
                : new ConnectionAssessmentV5(
                    ConnectionDispositionV5.Warning,
                    "MANUAL_EVIDENCE_REQUIRED",
                    message,
                    start,
                    destination);
        }

        return new ConnectionAssessmentV5(
            ConnectionDispositionV5.Allowed,
            "CONNECTION_ALLOWED",
            "단자 계약상 연결할 수 있습니다.",
            start,
            destination);
    }

    private static ConnectionAssessmentV5? AssessCapacity(
        WorkshopDocumentV5 document,
        TerminalRefV5 start,
        TerminalRefV5 end,
        TerminalDefinitionV5 left,
        TerminalDefinitionV5 right)
    {
        int startCount = document.Conductors.Count(conductor => conductor.Start == start || conductor.End == start);
        int endCount = document.Conductors.Count(conductor => conductor.Start == end || conductor.End == end);
        if (startCount >= left.MaxConductors || endCount >= right.MaxConductors)
        {
            return Risk(document, "TERMINAL_CAPACITY_EXCEEDED", "단자의 허용 전선 수를 초과합니다.", start, end);
        }

        return null;
    }

    private bool TryResolve(
        WorkshopDocumentV5 document,
        TerminalRefV5 reference,
        out TerminalDefinitionV5 terminal,
        out DeviceProfileV5 profile)
    {
        DeviceInstanceV5? device = document.Devices.FirstOrDefault(item => item.Id == reference.DeviceId);
        if (device is not null && _catalog.TryGet(device.ProfileId, out profile!))
        {
            terminal = profile.Terminals.FirstOrDefault(item =>
                item.Id == reference.TerminalId
                || item.Aliases.Contains(reference.TerminalId, StringComparer.Ordinal))!;
            return terminal is not null;
        }

        terminal = null!;
        profile = null!;
        return false;
    }

    private static ConnectionAssessmentV5 Risk(
        WorkshopDocumentV5 document,
        string code,
        string message,
        TerminalRefV5 start,
        TerminalRefV5 end)
    {
        if (document.Settings.FaultInjectionEnabled)
        {
            return new ConnectionAssessmentV5(
                ConnectionDispositionV5.Warning,
                code,
                $"고장 주입: {message}",
                start,
                end,
                true);
        }

        return document.Mode == WorkshopMode.Prewire
            ? Blocked(code, message, start, end)
            : new ConnectionAssessmentV5(ConnectionDispositionV5.Warning, code, message, start, end);
    }

    private static ConnectionAssessmentV5 Blocked(
        string code,
        string message,
        TerminalRefV5 start,
        TerminalRefV5 end)
        => new(ConnectionDispositionV5.Blocked, code, message, start, end);
}
