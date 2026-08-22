using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Wiring;

/// <summary>ConnectionDispositionV5 값의 종류를 정의합니다.</summary>
public enum ConnectionDispositionV5
{
    /// <summary>Allowed 상태를 나타냅니다.</summary>
    Allowed,
    /// <summary>Warning 상태를 나타냅니다.</summary>
    Warning,
    /// <summary>Blocked 상태를 나타냅니다.</summary>
    Blocked,
}

/// <summary>영속 편집 전에 계산한 단자 호환성, 안전성 및 점유량 판정입니다.</summary>
/// <param name="Disposition">허용, 경고 후 허용 또는 차단 결과입니다.</param>
/// <param name="Code">UI 문구와 독립적인 판정 코드입니다.</param>
/// <param name="Message">사용자에게 표시할 판정 근거입니다.</param>
/// <param name="Start">alias를 허용하는 입력 시작 단자입니다.</param>
/// <param name="End">alias를 허용하는 입력 도착 단자입니다.</param>
/// <param name="RequiresDiagnosticOverride">명시적 고장 주입 모드에서만 허용된 위험 결선인지 나타냅니다.</param>
public sealed record ConnectionAssessmentV5(
    ConnectionDispositionV5 Disposition,
    string Code,
    string Message,
    TerminalRefV5 Start,
    TerminalRefV5 End,
    bool RequiresDiagnosticOverride = false)
{
    /// <summary>판정 전 시작 단자에 이미 연결된 conductor와 bridge 수입니다.</summary>
    public int StartOccupancy { get; init; }

    /// <summary>시작 단자가 허용하는 최대 conductor와 bridge 수입니다.</summary>
    public int StartCapacity { get; init; }

    /// <summary>판정 전 도착 단자에 이미 연결된 conductor와 bridge 수입니다.</summary>
    public int EndOccupancy { get; init; }

    /// <summary>도착 단자가 허용하는 최대 conductor와 bridge 수입니다.</summary>
    public int EndCapacity { get; init; }

    /// <summary>수동 override가 없을 때 두 단자 계약으로 계산한 #RRGGBB 전선색입니다.</summary>
    public string SuggestedColor { get; init; } = "#374151";
}

/// <summary>신규 전선, 재결선과 점퍼가 공유하는 candidate-document 사전판정 계약입니다.</summary>
public interface IConnectionAssessmentService
{
    /// <summary>Assess 작업을 수행합니다.</summary>
    ConnectionAssessmentV5 Assess(
        WorkshopDocumentV5 document,
        TerminalRefV5 start,
        TerminalRefV5 destination);

    /// <summary>전선 굵기, 선번, 중복과 끝단 안전성을 함께 판정합니다.</summary>
    /// <param name="document">편집 전의 현재 문서 스냅샷입니다.</param>
    /// <param name="conductor">확정하려는 candidate 전선입니다.</param>
    /// <param name="replacingConductorId">재결선이면 점유량과 중복 검사에서 제외할 기존 전선 ID입니다.</param>
    ConnectionAssessmentV5 AssessConductor(
        WorkshopDocumentV5 document,
        ConductorV5 conductor,
        string? replacingConductorId = null);

    /// <summary>점퍼의 모든 단자 쌍과 conductor/bridge 합산 점유량을 판정합니다.</summary>
    ConnectionAssessmentV5 AssessBridge(WorkshopDocumentV5 document, TerminalBridgeV5 bridge);
}

/// <summary>영속 전선을 만들기 전에 연습, 사전결선, 고장 주입 정책을 판정합니다.</summary>
public sealed class ConnectionAssessmentService : IConnectionAssessmentService
{
    private readonly TerminalResolver _resolver;

    /// <summary>ConnectionAssessmentService 작업을 수행합니다.</summary>
    public ConnectionAssessmentService(DeviceProfileCatalog catalog)
    {
        _resolver = new TerminalResolver(catalog ?? throw new ArgumentNullException(nameof(catalog)));
    }

    /// <summary>Assess 작업을 수행합니다.</summary>
    public ConnectionAssessmentV5 Assess(
        WorkshopDocumentV5 document,
        TerminalRefV5 start,
        TerminalRefV5 destination)
        => EnrichOccupancy(
            document,
            AssessCore(document, start, destination, null, null, checkDuplicate: true));

    /// <summary>AssessConductor 작업을 수행합니다.</summary>
    public ConnectionAssessmentV5 AssessConductor(
        WorkshopDocumentV5 document,
        ConductorV5 conductor,
        string? replacingConductorId = null)
    {
        ArgumentNullException.ThrowIfNull(conductor);
        ConnectionAssessmentV5 assessment = EnrichOccupancy(
            document,
            AssessCore(
                document,
                conductor.Start,
                conductor.End,
                replacingConductorId,
                conductor.GaugeMm2,
                checkDuplicate: true),
            replacingConductorId);
        if (assessment.Disposition != ConnectionDispositionV5.Allowed)
        {
            return assessment;
        }

        if (!string.IsNullOrWhiteSpace(conductor.WireNumber)
            && document.Conductors.Any(existing =>
                !string.Equals(existing.Id, replacingConductorId, StringComparison.Ordinal)
                && string.Equals(existing.WireNumber, conductor.WireNumber, StringComparison.OrdinalIgnoreCase)))
        {
            return EnrichOccupancy(document, new ConnectionAssessmentV5(
                ConnectionDispositionV5.Warning,
                "DUPLICATE_WIRE_NUMBER",
                $"선번 '{conductor.WireNumber}'이(가) 이미 사용 중입니다.",
                conductor.Start,
                conductor.End), replacingConductorId);
        }

        return assessment;
    }

    private ConnectionAssessmentV5 EnrichOccupancy(
        WorkshopDocumentV5 document,
        ConnectionAssessmentV5 assessment,
        string? excludingConductorId = null)
    {
        bool hasStart = _resolver.TryResolve(document, assessment.Start, out ResolvedTerminal? start);
        bool hasEnd = _resolver.TryResolve(document, assessment.End, out ResolvedTerminal? end);
        return assessment with
        {
            StartOccupancy = hasStart ? _resolver.CountOccupancy(document, start, excludingConductorId) : 0,
            StartCapacity = hasStart ? start.MaximumConductors : 0,
            EndOccupancy = hasEnd ? _resolver.CountOccupancy(document, end, excludingConductorId) : 0,
            EndCapacity = hasEnd ? end.MaximumConductors : 0,
            SuggestedColor = hasStart && hasEnd ? AutomaticColor(start.Terminal, end.Terminal) : "#374151",
        };
    }

    private static string AutomaticColor(TerminalDefinitionV5 left, TerminalDefinitionV5 right)
    {
        TerminalPotential[] potentials = [left.Potential, right.Potential];
        if (potentials.Contains(TerminalPotential.ProtectiveEarth))
        {
            return "#22C55E";
        }

        if (potentials.Contains(TerminalPotential.Positive24V))
        {
            return "#EF4444";
        }

        if (potentials.Contains(TerminalPotential.ZeroVolt) || potentials.Contains(TerminalPotential.Neutral))
        {
            return "#3B82F6";
        }

        if (potentials.Any(potential => potential is TerminalPotential.Line1 or TerminalPotential.Line2 or TerminalPotential.Line3))
        {
            return "#92400E";
        }

        return left.Domain is TerminalDomain.AnalogInput or TerminalDomain.AnalogOutput or TerminalDomain.Communication
            || right.Domain is TerminalDomain.AnalogInput or TerminalDomain.AnalogOutput or TerminalDomain.Communication
                ? "#8B5CF6"
                : "#374151";
    }

    /// <summary>AssessBridge 작업을 수행합니다.</summary>
    public ConnectionAssessmentV5 AssessBridge(WorkshopDocumentV5 document, TerminalBridgeV5 bridge)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(bridge);
        if (bridge.Terminals.Length < 2)
        {
            TerminalRefV5 empty = new(string.Empty, string.Empty);
            return Blocked("BRIDGE_TERMINALS_REQUIRED", "점퍼에는 서로 다른 두 개 이상의 단자가 필요합니다.", empty, empty);
        }

        var resolved = new List<ResolvedTerminal>(bridge.Terminals.Length);
        foreach (TerminalRefV5 terminal in bridge.Terminals)
        {
            if (!_resolver.TryResolve(document, terminal, out ResolvedTerminal? value))
            {
                return Blocked("UNKNOWN_TERMINAL", "장비 프로필에 없는 단자는 점퍼로 연결할 수 없습니다.", bridge.Terminals[0], terminal);
            }

            if (resolved.Any(existing => existing.Reference == value.Reference))
            {
                return Blocked("DUPLICATE_BRIDGE_TERMINAL", "같은 단자를 한 점퍼에 두 번 넣을 수 없습니다.", bridge.Terminals[0], terminal);
            }

            if (_resolver.CountOccupancy(document, value) >= value.MaximumConductors)
            {
                return Risk(document, "TERMINAL_CAPACITY_EXCEEDED", "점퍼가 단자의 허용 전선 수를 초과합니다.", bridge.Terminals[0], terminal);
            }

            resolved.Add(value);
        }

        ConnectionAssessmentV5? strongestRisk = null;
        for (int leftIndex = 0; leftIndex < resolved.Count - 1; leftIndex++)
        {
            for (int rightIndex = leftIndex + 1; rightIndex < resolved.Count; rightIndex++)
            {
                if (HasExistingDirectConnection(
                    document,
                    resolved[leftIndex].Reference,
                    resolved[rightIndex].Reference))
                {
                    return Blocked(
                        "DUPLICATE_CONNECTION",
                        "두 단자는 기존 전선이나 점퍼로 이미 직접 연결되어 있습니다.",
                        bridge.Terminals[leftIndex],
                        bridge.Terminals[rightIndex]);
                }

                ConnectionAssessmentV5 pair = AssessElectricalPolicy(
                    document,
                    resolved[leftIndex],
                    resolved[rightIndex],
                    bridge.Terminals[leftIndex],
                    bridge.Terminals[rightIndex]);
                if (pair.Disposition != ConnectionDispositionV5.Allowed
                    && (strongestRisk is null || RiskPriority(pair) > RiskPriority(strongestRisk)))
                {
                    strongestRisk = pair;
                }
            }
        }

        if (strongestRisk is not null)
        {
            return strongestRisk;
        }

        return new ConnectionAssessmentV5(
            ConnectionDispositionV5.Allowed,
            "BRIDGE_ALLOWED",
            "단자 계약상 점퍼로 연결할 수 있습니다.",
            bridge.Terminals[0],
            bridge.Terminals[^1]);
    }

    private bool HasExistingDirectConnection(
        WorkshopDocumentV5 document,
        TerminalRefV5 left,
        TerminalRefV5 right)
    {
        if (document.Conductors.Any(conductor =>
            (_resolver.IsSame(document, conductor.Start, left)
                && _resolver.IsSame(document, conductor.End, right))
            || (_resolver.IsSame(document, conductor.Start, right)
                && _resolver.IsSame(document, conductor.End, left))))
        {
            return true;
        }

        foreach (TerminalBridgeV5 bridge in document.TerminalBridges)
        {
            bool hasLeft = bridge.Terminals.Any(terminal => _resolver.IsSame(document, terminal, left));
            bool hasRight = bridge.Terminals.Any(terminal => _resolver.IsSame(document, terminal, right));
            if (hasLeft && hasRight)
            {
                return true;
            }
        }

        return false;
    }

    private static int RiskPriority(ConnectionAssessmentV5 assessment)
    {
        int disposition = assessment.Disposition switch
        {
            ConnectionDispositionV5.Blocked => 1_000,
            ConnectionDispositionV5.Warning => 500,
            _ => 0,
        };
        int electricalSafety = assessment.Code switch
        {
            "DIRECT_SUPPLY_SHORT" => 100,
            "PE_DOMAIN_MISMATCH" => 90,
            "AC_DC_DOMAIN_MISMATCH" => 80,
            _ => 0,
        };
        return disposition + electricalSafety;
    }

    private ConnectionAssessmentV5 AssessCore(
        WorkshopDocumentV5 document,
        TerminalRefV5 start,
        TerminalRefV5 destination,
        string? replacingConductorId,
        double? gaugeMm2,
        bool checkDuplicate)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(start);
        ArgumentNullException.ThrowIfNull(destination);
        if (!_resolver.TryResolve(document, start, out ResolvedTerminal? left)
            || !_resolver.TryResolve(document, destination, out ResolvedTerminal? right))
        {
            return Blocked("UNKNOWN_TERMINAL", "장비 프로필에 없는 단자는 연결할 수 없습니다.", start, destination);
        }

        if (left.Reference == right.Reference)
        {
            return Blocked("SAME_TERMINAL", "같은 단자를 서로 연결할 수 없습니다.", start, destination);
        }

        if (checkDuplicate && document.Conductors.Any(conductor =>
            !string.Equals(conductor.Id, replacingConductorId, StringComparison.Ordinal)
            && ((_resolver.IsSame(document, conductor.Start, left.Reference)
                    && _resolver.IsSame(document, conductor.End, right.Reference))
                || (_resolver.IsSame(document, conductor.Start, right.Reference)
                    && _resolver.IsSame(document, conductor.End, left.Reference)))))
        {
            return Blocked("DUPLICATE_CONNECTION", "두 단자는 이미 연결되어 있습니다.", start, destination);
        }

        if (_resolver.CountOccupancy(document, left, replacingConductorId) >= left.MaximumConductors
            || _resolver.CountOccupancy(document, right, replacingConductorId) >= right.MaximumConductors)
        {
            return Risk(document, "TERMINAL_CAPACITY_EXCEEDED", "단자의 허용 전선 수를 초과합니다.", start, destination);
        }

        if (gaugeMm2 is double gauge && IsGaugeOutside(left.Terminal, right.Terminal, gauge))
        {
            return Risk(document, "CONDUCTOR_GAUGE_OUT_OF_RANGE", "전선 굵기가 연결 단자의 허용 범위를 벗어납니다.", start, destination);
        }

        return AssessElectricalPolicy(document, left, right, start, destination);
    }

    private static bool IsGaugeOutside(TerminalDefinitionV5 left, TerminalDefinitionV5 right, double gauge)
        => !double.IsFinite(gauge)
            || gauge <= 0
            || left.MinimumConductorMm2 is double leftMinimum && gauge < leftMinimum
            || left.MaximumConductorMm2 is double leftMaximum && gauge > leftMaximum
            || right.MinimumConductorMm2 is double rightMinimum && gauge < rightMinimum
            || right.MaximumConductorMm2 is double rightMaximum && gauge > rightMaximum;

    private static ConnectionAssessmentV5 AssessElectricalPolicy(
        WorkshopDocumentV5 document,
        ResolvedTerminal left,
        ResolvedTerminal right,
        TerminalRefV5 start,
        TerminalRefV5 destination)
    {
        bool leftPe = left.Terminal.Domain == TerminalDomain.ProtectiveEarth;
        bool rightPe = right.Terminal.Domain == TerminalDomain.ProtectiveEarth;
        if (leftPe != rightPe)
        {
            return Risk(document, "PE_DOMAIN_MISMATCH", "PE 단자는 다른 전위나 신호 단자와 직접 연결하면 안 됩니다.", start, destination);
        }

        bool leftAc = left.Terminal.Domain == TerminalDomain.AcPower;
        bool rightAc = right.Terminal.Domain == TerminalDomain.AcPower;
        bool leftDc = left.Terminal.Domain == TerminalDomain.DcPower;
        bool rightDc = right.Terminal.Domain == TerminalDomain.DcPower;
        if ((leftAc && rightDc) || (leftDc && rightAc))
        {
            return Risk(document, "AC_DC_DOMAIN_MISMATCH", "AC 단자와 DC 단자를 직접 연결하려고 합니다.", start, destination);
        }

        TerminalPotential leftPotential = left.Terminal.Potential;
        TerminalPotential rightPotential = right.Terminal.Potential;
        bool acSupplyShort = IsAcPhase(leftPotential) && rightPotential == TerminalPotential.Neutral
            || IsAcPhase(rightPotential) && leftPotential == TerminalPotential.Neutral
            || IsAcPhase(leftPotential) && IsAcPhase(rightPotential) && leftPotential != rightPotential;
        if ((leftPotential == TerminalPotential.Positive24V && rightPotential == TerminalPotential.ZeroVolt)
            || (left.Terminal.Potential == TerminalPotential.ZeroVolt && right.Terminal.Potential == TerminalPotential.Positive24V)
            || acSupplyShort)
        {
            return Risk(document, "DIRECT_SUPPLY_SHORT", "전원측과 귀로를 부하 없이 직접 연결하려고 합니다.", start, destination);
        }

        if (left.Profile.ManualEvidence != ManualEvidenceStatusV5.ExactProduct
            || right.Profile.ManualEvidence != ManualEvidenceStatusV5.ExactProduct)
        {
            const string message = "제조사와 전체 품번이 확정되지 않은 장비는 연습 결선만 가능하며 사전결선 승인을 받을 수 없습니다.";
            return document.Mode == WorkshopMode.Prewire
                ? Blocked("MANUAL_EVIDENCE_REQUIRED", message, start, destination)
                : new ConnectionAssessmentV5(ConnectionDispositionV5.Warning, "MANUAL_EVIDENCE_REQUIRED", message, start, destination);
        }

        return new ConnectionAssessmentV5(
            ConnectionDispositionV5.Allowed,
            "CONNECTION_ALLOWED",
            "단자 계약상 연결할 수 있습니다.",
            start,
            destination);
    }

    private static bool IsAcPhase(TerminalPotential potential)
        => potential is TerminalPotential.Line1 or TerminalPotential.Line2 or TerminalPotential.Line3;

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
