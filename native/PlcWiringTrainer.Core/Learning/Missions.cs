using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Learning;

public sealed record MissionRoleDefinitionV5(string Id, string[] AllowedProfileIds);

public sealed record MissionTerminalRefV5(string RoleId, string TerminalId);

public sealed record MissionConnectionRequirementV5(
    MissionTerminalRefV5 From,
    MissionTerminalRefV5 To);

public sealed record MissionDefinitionV5(
    string Id,
    string CanonicalScenarioId,
    MissionRoleDefinitionV5[] Roles,
    MissionConnectionRequirementV5[] RequiredConnections,
    MissionConnectionRequirementV5[] ForbiddenConnections,
    string[] ExpectedEnergizedRoles,
    string[] Hints);

public sealed record MissionEvaluationIssueV5(
    string Code,
    string Message,
    string[] Targets);

public sealed record MissionEvaluationV5(
    bool Passed,
    MissionEvaluationIssueV5[] Issues,
    string? NextHint);

public interface IMissionEvaluator
{
    MissionEvaluationV5 Evaluate(
        MissionDefinitionV5 mission,
        WorkshopDocumentV5 document,
        CircuitSolutionV5 solution);
}

public sealed class MissionEvaluator : IMissionEvaluator
{
    private readonly DeviceProfileCatalog _catalog;

    public MissionEvaluator(DeviceProfileCatalog catalog)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
    }

    public MissionEvaluationV5 Evaluate(
        MissionDefinitionV5 mission,
        WorkshopDocumentV5 document,
        CircuitSolutionV5 solution)
    {
        ArgumentNullException.ThrowIfNull(mission);
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(solution);
        var issues = new List<MissionEvaluationIssueV5>();
        var bindings = new Dictionary<string, DeviceInstanceV5>(StringComparer.Ordinal);
        foreach (MissionRoleDefinitionV5 role in mission.Roles)
        {
            if (!document.MissionState.RoleBindings.TryGetValue(role.Id, out string? deviceId)
                || document.Devices.FirstOrDefault(device => device.Id == deviceId) is not DeviceInstanceV5 device)
            {
                issues.Add(new MissionEvaluationIssueV5(
                    "ROLE_BINDING_REQUIRED",
                    $"'{role.Id}' 역할에 장비를 지정해야 합니다.",
                    [role.Id]));
                continue;
            }

            if (!_catalog.TryGet(device.ProfileId, out _)
                || !role.AllowedProfileIds.Contains(device.ProfileId, StringComparer.Ordinal))
            {
                issues.Add(new MissionEvaluationIssueV5(
                    "ROLE_PROFILE_MISMATCH",
                    $"'{role.Id}' 역할에 허용되지 않은 프로필입니다: {device.ProfileId}",
                    [role.Id, device.Id]));
                continue;
            }

            bindings[role.Id] = device;
        }

        foreach (MissionConnectionRequirementV5 requirement in mission.RequiredConnections)
        {
            if (!AreConnected(requirement, bindings, solution))
            {
                issues.Add(new MissionEvaluationIssueV5(
                    "REQUIRED_CONNECTION_MISSING",
                    "필수 결선이 같은 도통 그룹에 포함되지 않았습니다.",
                    Targets(requirement, bindings)));
            }
        }

        foreach (MissionConnectionRequirementV5 forbidden in mission.ForbiddenConnections)
        {
            if (AreConnected(forbidden, bindings, solution))
            {
                issues.Add(new MissionEvaluationIssueV5(
                    "FORBIDDEN_CONNECTION_PRESENT",
                    "금지된 결선이 존재합니다.",
                    Targets(forbidden, bindings)));
            }
        }

        foreach (string roleId in mission.ExpectedEnergizedRoles)
        {
            if (!bindings.TryGetValue(roleId, out DeviceInstanceV5? device)
                || !solution.Simulation.EnergizedDeviceIds.Contains(device.Id, StringComparer.Ordinal))
            {
                issues.Add(new MissionEvaluationIssueV5(
                    "EXPECTED_DEVICE_STATE_MISMATCH",
                    $"'{roleId}' 역할 장비가 기대한 통전 상태가 아닙니다.",
                    bindings.TryGetValue(roleId, out device) ? [roleId, device.Id] : [roleId]));
            }
        }

        string? hint = issues.Count == 0 || mission.Hints.Length == 0
            ? null
            : mission.Hints[Math.Clamp(document.MissionState.HintLevel, 0, mission.Hints.Length - 1)];
        return new MissionEvaluationV5(issues.Count == 0, [.. issues], hint);
    }

    private static bool AreConnected(
        MissionConnectionRequirementV5 requirement,
        Dictionary<string, DeviceInstanceV5> bindings,
        CircuitSolutionV5 solution)
    {
        if (!bindings.TryGetValue(requirement.From.RoleId, out DeviceInstanceV5? fromDevice)
            || !bindings.TryGetValue(requirement.To.RoleId, out DeviceInstanceV5? toDevice))
        {
            return false;
        }

        string fromKey = new TerminalRefV5(fromDevice.Id, requirement.From.TerminalId).Key;
        string toKey = new TerminalRefV5(toDevice.Id, requirement.To.TerminalId).Key;
        TerminalElectricalStateV5? from = solution.Simulation.TerminalStates.FirstOrDefault(state => state.TerminalKey == fromKey);
        TerminalElectricalStateV5? to = solution.Simulation.TerminalStates.FirstOrDefault(state => state.TerminalKey == toKey);
        return from is not null
            && to is not null
            && string.Equals(from.ConductionGroup, to.ConductionGroup, StringComparison.Ordinal);
    }

    private static string[] Targets(
        MissionConnectionRequirementV5 requirement,
        Dictionary<string, DeviceInstanceV5> bindings)
        =>
        [
            bindings.TryGetValue(requirement.From.RoleId, out DeviceInstanceV5? from)
                ? new TerminalRefV5(from.Id, requirement.From.TerminalId).Key
                : requirement.From.RoleId,
            bindings.TryGetValue(requirement.To.RoleId, out DeviceInstanceV5? to)
                ? new TerminalRefV5(to.Id, requirement.To.TerminalId).Key
                : requirement.To.RoleId,
        ];
}

/// <summary>레거시 미션 ID를 canonical 학습 시나리오로 유지합니다.</summary>
public static class LegacyMissionCatalog
{
    private static readonly string[] FourHints = ["회로 목적을 확인하세요.", "역할에 맞는 장비를 확인하세요.", "단자 ID와 극성을 확인하세요.", "필수 결선을 회로도와 대조하세요."];

    public static IReadOnlyList<MissionDefinitionV5> Entries { get; } =
    [
        Empty("mdr-ac-dc-distribution"),
        Empty("xbc-source-sink-input"),
        Empty("xbc-forced-relay-output"),
        Empty("xbf-analog-voltage-current"),
        Empty("ig5a-terminal-control-practice"),
        Empty("exp2-power-practice"),
        Empty("exp2-xbc-rs485-practice"),
        Empty("md02-power-practice"),
        Empty("md02-rs485-practice"),
        Empty("door-terminal-block-routing"),
    ];

    private static MissionDefinitionV5 Empty(string id)
        => new(id, id, [], [], [], [], FourHints);
}
