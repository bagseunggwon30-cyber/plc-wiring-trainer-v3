using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Validation;

/// <summary>회로 해석과 고정 순서 validation rule 실행을 제공하는 공개 façade입니다.</summary>
public sealed class CircuitValidationService : IValidationService, ICircuitService
{
    private readonly DeviceProfileCatalog _catalog;

    /// <summary>CircuitValidationService 작업을 수행합니다.</summary>
    public CircuitValidationService(DeviceProfileCatalog catalog)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
    }

    /// <summary>ValidateAsync 작업을 수행합니다.</summary>
    public Task<ValidationResultV5> ValidateAsync(
        WorkshopDocumentV5 document,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        cancellationToken.ThrowIfCancellationRequested();

        var issues = new List<ValidationIssueV5>();
        var devices = document.Devices.ToDictionary(device => device.Id, StringComparer.Ordinal);
        var profiles = new Dictionary<string, DeviceProfileV5>(StringComparer.Ordinal);
        var validTerminals = new HashSet<string>(StringComparer.Ordinal);
        var terminalDefinitions = new Dictionary<string, TerminalDefinitionV5>(StringComparer.Ordinal);

        if (document.PhysicalLayout.Status == CompletenessStatus.Complete
            && (document.PhysicalLayout.CanvasUnitsPerMm is not double unitsPerMm
                || !double.IsFinite(unitsPerMm)
                || unitsPerMm <= 0
                || !string.Equals(document.PhysicalLayout.SourceUnit, "mm", StringComparison.OrdinalIgnoreCase)))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.PHYSICAL_SCALE_REQUIRED,
                ValidationSeverity.Error,
                true,
                "완료된 물리 패널은 mm 원본 단위와 0보다 큰 canvasUnitsPerMm 축척이 필요합니다.",
                [],
                "physical-layout"));
        }

        if (document.SourceSystem.Status == CompletenessStatus.Complete
            && (document.SourceSystem.Kind == SupplyKind.None || document.SourceSystem.NominalVoltage is null))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.SOURCE_SYSTEM_INCOMPLETE,
                ValidationSeverity.Error,
                true,
                "완료된 전원 시스템에는 전원 종류와 정격 전압이 필요합니다.",
                [],
                "source-system"));
        }

        foreach (DeviceInstanceV5 device in document.Devices)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!_catalog.TryGet(device.ProfileId, out DeviceProfileV5 profile))
            {
                issues.Add(Issue(
                    document,
                ValidationIssueCodes.PROFILE_NOT_FOUND,
                    ValidationSeverity.Error,
                    true,
                    $"'{device.Label}' 장비의 전기 프로필을 찾을 수 없습니다.",
                    [DeviceTarget(device)],
                    "profile"));
                continue;
            }

            profiles[device.Id] = profile;
            foreach (TerminalDefinitionV5 terminal in profile.Terminals)
            {
                string terminalKey = new TerminalRefV5(device.Id, terminal.Id).Key;
                validTerminals.Add(terminalKey);
                terminalDefinitions[terminalKey] = terminal;
            }

            if (device.X < 0
                || device.Y < 0
                || device.X + device.Width > document.Panel.Width
                || device.Y + device.Height > document.Panel.Height)
            {
                issues.Add(Issue(
                    document,
                ValidationIssueCodes.DEVICE_OUTSIDE_PANEL,
                    ValidationSeverity.Warning,
                    false,
                    $"'{device.Label}' 장비가 패널 작업 영역을 벗어났습니다.",
                    [DeviceTarget(device)],
                    "physical-layout"));
            }

            if (profile.Version != device.ProfileVersion)
            {
                issues.Add(Issue(
                    document,
                ValidationIssueCodes.PROFILE_VERSION_MISMATCH,
                    ValidationSeverity.Error,
                    true,
                    $"'{device.Label}' 장비 프로필 버전이 현재 매니페스트와 다릅니다.",
                    [DeviceTarget(device)],
                    "profile"));
            }

            if (profile.ManualEvidence != ManualEvidenceStatusV5.ExactProduct
                || device.EvidenceGrade == EvidenceGrade.Educational)
            {
                bool blocking = document.Mode == WorkshopMode.Prewire;
                issues.Add(Issue(
                    document,
                    blocking ? ValidationIssueCodes.MANUAL_EVIDENCE_REQUIRED : ValidationIssueCodes.EDUCATIONAL_PROFILE,
                    blocking ? ValidationSeverity.Error : ValidationSeverity.Information,
                    blocking,
                    blocking
                        ? $"'{device.Label}' 장비는 제조사와 전체 품번 및 공식 매뉴얼 근거가 필요합니다. 사전결선 검증을 차단합니다."
                        : $"'{device.Label}' 장비는 품번 미확정 연습용 자산입니다. 매뉴얼 검증 자산으로 간주하지 않습니다.",
                    [DeviceTarget(device)],
                    "evidence"));
            }
        }

        var connected = new DisjointSet();
        foreach (string terminal in validTerminals)
        {
            connected.Add(terminal);
        }

        foreach ((string deviceId, DeviceProfileV5 profile) in profiles)
        {
            foreach (InternalLinkV5 link in profile.InternalLinks)
            {
                string from = new TerminalRefV5(deviceId, link.FromTerminalId).Key;
                string to = new TerminalRefV5(deviceId, link.ToTerminalId).Key;
                if (!validTerminals.Contains(from) || !validTerminals.Contains(to))
                {
                    issues.Add(Issue(
                        document,
                ValidationIssueCodes.INVALID_INTERNAL_LINK,
                        ValidationSeverity.Error,
                        true,
                        $"'{deviceId}' 프로필의 내부 도통 단자가 존재하지 않습니다: {link.FromTerminalId} ↔ {link.ToTerminalId}",
                        [new ValidationTargetV5(ValidationTargetKind.Device, deviceId, deviceId)],
                        "profile-internal-link"));
                    continue;
                }

                if (link.Kind != InternalLinkKind.DynamicContact || IsDynamicContactClosed(document, deviceId, link))
                {
                    connected.Union(from, to);
                }
            }
        }

        foreach (TerminalBridgeV5 bridge in document.TerminalBridges)
        {
            TerminalRefV5[] validBridgeTerminals = bridge.Terminals
                .Where(terminal => validTerminals.Contains(terminal.Key))
                .ToArray();
            if (validBridgeTerminals.Length != bridge.Terminals.Length || validBridgeTerminals.Length < 2)
            {
                issues.Add(Issue(
                    document,
                ValidationIssueCodes.INVALID_TERMINAL_BRIDGE,
                    ValidationSeverity.Error,
                    true,
                    $"점퍼 '{bridge.Id}'가 존재하지 않는 단자 또는 2개 미만의 단자를 참조합니다.",
                    [.. bridge.Terminals.Select(terminal => new ValidationTargetV5(
                        ValidationTargetKind.Terminal,
                        terminal.Key,
                        terminal.DeviceId,
                        terminal.TerminalId))],
                    "terminal-bridge"));
                continue;
            }

            for (int index = 1; index < validBridgeTerminals.Length; index++)
            {
                connected.Union(validBridgeTerminals[0].Key, validBridgeTerminals[index].Key);
            }
        }

        foreach (IGrouping<string, ConductorV5> group in document.Conductors
            .Where(conductor => !string.IsNullOrWhiteSpace(conductor.WireNumber))
            .GroupBy(conductor => conductor.WireNumber, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.DUPLICATE_WIRE_NUMBER,
                ValidationSeverity.Warning,
                false,
                $"선번 '{group.Key}'이(가) 둘 이상의 전선에 사용되었습니다.",
                [.. group.Select(ConductorTarget)],
                "physical-conductor"));
        }

        foreach (IGrouping<string, ConductorV5> group in document.Conductors
            .Where(conductor => !string.IsNullOrWhiteSpace(conductor.CableAssemblyId)
                && !string.IsNullOrWhiteSpace(conductor.Core))
            .GroupBy(
                conductor => $"{conductor.CableAssemblyId}:{conductor.Core}",
                StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.DUPLICATE_CABLE_CORE,
                ValidationSeverity.Error,
                true,
                $"케이블/core '{group.Key}'이(가) 둘 이상의 전선에 배정되었습니다.",
                [.. group.Select(ConductorTarget)],
                "physical-cable"));
        }

        foreach (CableAssemblyV5 cable in document.CableAssemblies.Where(cable => cable.Shielded && string.IsNullOrWhiteSpace(cable.DrainConductorId)))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.SHIELD_DRAIN_REQUIRED,
                ValidationSeverity.Warning,
                false,
                $"차폐 케이블 '{cable.Designation ?? cable.Id}'에 drain 도체가 지정되지 않았습니다.",
                cable.ConductorIds
                    .Select(id => document.Conductors.FirstOrDefault(conductor => conductor.Id == id))
                    .Where(conductor => conductor is not null)
                    .Select(conductor => ConductorTarget(conductor!))
                    .ToArray(),
                "physical-cable"));
        }

        var conductorsById = document.Conductors.ToDictionary(conductor => conductor.Id, StringComparer.Ordinal);
        var cablesById = document.CableAssemblies.ToDictionary(cable => cable.Id, StringComparer.Ordinal);
        foreach (CableAssemblyV5 cable in document.CableAssemblies)
        {
            foreach (string conductorId in cable.ConductorIds.Where(id => !conductorsById.ContainsKey(id)))
            {
                issues.Add(Issue(
                    document,
                ValidationIssueCodes.UNKNOWN_CABLE_CONDUCTOR,
                    ValidationSeverity.Error,
                    true,
                    $"케이블 '{cable.Designation ?? cable.Id}'이(가) 없는 전선 '{conductorId}'을 참조합니다.",
                    [],
                    "physical-cable"));
            }

            if (!string.IsNullOrWhiteSpace(cable.DrainConductorId)
                && !conductorsById.ContainsKey(cable.DrainConductorId))
            {
                issues.Add(Issue(
                    document,
                ValidationIssueCodes.UNKNOWN_DRAIN_CONDUCTOR,
                    ValidationSeverity.Error,
                    true,
                    $"케이블 '{cable.Designation ?? cable.Id}'의 drain 전선을 찾을 수 없습니다.",
                    [],
                    "physical-cable"));
            }

            foreach (ConductorV5 conductor in cable.ConductorIds
                .Select(id => conductorsById.GetValueOrDefault(id))
                .OfType<ConductorV5>())
            {
                if (!string.Equals(conductor.CableAssemblyId, cable.Id, StringComparison.Ordinal))
                {
                    issues.Add(Issue(
                        document,
                ValidationIssueCodes.CABLE_MEMBERSHIP_MISMATCH,
                        ValidationSeverity.Error,
                        true,
                        $"전선 '{conductor.WireNumber}'의 케이블 소속이 assembly와 일치하지 않습니다.",
                        [ConductorTarget(conductor)],
                        "physical-cable"));
                }
            }
        }

        foreach (ConductorV5 conductor in document.Conductors)
        {
            if (!string.IsNullOrWhiteSpace(conductor.CableAssemblyId))
            {
                if (!cablesById.TryGetValue(conductor.CableAssemblyId, out CableAssemblyV5? cable))
                {
                    issues.Add(Issue(
                        document,
                ValidationIssueCodes.UNKNOWN_CABLE_ASSEMBLY,
                        ValidationSeverity.Error,
                        true,
                        $"전선 '{conductor.WireNumber}'이(가) 없는 케이블 assembly를 참조합니다.",
                        [ConductorTarget(conductor)],
                        "physical-cable"));
                }
                else if (!cable.ConductorIds.Contains(conductor.Id, StringComparer.Ordinal))
                {
                    issues.Add(Issue(
                        document,
                        "CABLE_MEMBERSHIP_MISMATCH",
                        ValidationSeverity.Error,
                        true,
                        $"전선 '{conductor.WireNumber}'이(가) 케이블 assembly의 conductor 목록에 없습니다.",
                        [ConductorTarget(conductor)],
                        "physical-cable"));
                }
            }

            if (!double.IsFinite(conductor.GaugeMm2) || conductor.GaugeMm2 <= 0)
            {
                issues.Add(Issue(
                    document,
                ValidationIssueCodes.INVALID_CONDUCTOR_GAUGE,
                    ValidationSeverity.Error,
                    true,
                    $"'{conductor.WireNumber}' 전선의 굵기는 0보다 커야 합니다.",
                    [ConductorTarget(conductor)],
                    "physical-conductor"));
            }

            if (string.IsNullOrWhiteSpace(conductor.WireNumber))
            {
                issues.Add(Issue(
                    document,
                ValidationIssueCodes.WIRE_NUMBER_REQUIRED,
                    ValidationSeverity.Warning,
                    false,
                    "선번이 없는 전선이 있습니다.",
                    [ConductorTarget(conductor)],
                    "physical-conductor"));
            }

            bool startExists = validTerminals.Contains(conductor.Start.Key);
            bool endExists = validTerminals.Contains(conductor.End.Key);
            if (!startExists || !endExists)
            {
                issues.Add(Issue(
                    document,
                ValidationIssueCodes.UNKNOWN_TERMINAL,
                    ValidationSeverity.Error,
                    true,
                    $"'{conductor.WireNumber}' 전선이 존재하지 않는 단자를 참조합니다.",
                    [ConductorTarget(conductor)],
                    "topology"));
                continue;
            }

            connected.Union(conductor.Start.Key, conductor.End.Key);
        }

        foreach (IGrouping<string, TerminalRefV5> group in document.Conductors
            .SelectMany(conductor => new[] { conductor.Start, conductor.End })
            .Concat(document.TerminalBridges.SelectMany(bridge => bridge.Terminals))
            .GroupBy(terminal => terminal.Key, StringComparer.Ordinal))
        {
            if (terminalDefinitions.TryGetValue(group.Key, out TerminalDefinitionV5? terminal)
                && group.Count() > EffectiveMaximumConductors(document, group.First(), terminal))
            {
                int maximumConductors = EffectiveMaximumConductors(document, group.First(), terminal);
                issues.Add(Issue(
                    document,
                ValidationIssueCodes.TERMINAL_CAPACITY_EXCEEDED,
                    ValidationSeverity.Error,
                    true,
                    $"단자 '{group.Key}'의 허용 전선 수 {maximumConductors}개를 초과했습니다.",
                    TargetsForTerminal(document, group.First()),
                    "physical-terminal"));
            }
        }

        TerminalRefV5? positive = FindFirstTerminal(document, profiles, TerminalRole.DcSourcePositive);
        TerminalRefV5? dcReturn = FindFirstTerminal(document, profiles, TerminalRole.DcSourceReturn);
        if (positive is not null && dcReturn is not null && connected.AreConnected(positive.Key, dcReturn.Key))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.DC_SHORT_CIRCUIT,
                ValidationSeverity.Error,
                true,
                "+24V와 0V가 같은 결선망에 연결되어 있습니다.",
                TargetsForNet(document, connected, positive.Key),
                "dc-power"));
        }

        TerminalRefV5? acLine = FindFirstTerminal(document, profiles, TerminalRole.AcSourceLine);
        TerminalRefV5? acNeutral = FindFirstTerminal(document, profiles, TerminalRole.AcSourceNeutral);
        TerminalRefV5? protectiveEarth = FindFirstTerminal(document, profiles, TerminalRole.ProtectiveEarth);
        if (acLine is not null && acNeutral is not null && connected.AreConnected(acLine.Key, acNeutral.Key))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.AC_LINE_NEUTRAL_SHORT,
                ValidationSeverity.Error,
                true,
                "AC 전원의 L과 N이 같은 결선망에 연결되어 있습니다.",
                TargetsForNet(document, connected, acLine.Key),
                "ac-power"));
        }

        if (acLine is not null && protectiveEarth is not null && connected.AreConnected(acLine.Key, protectiveEarth.Key))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.AC_LINE_TO_PE,
                ValidationSeverity.Error,
                true,
                "AC L이 보호 접지(PE)에 연결되어 있습니다.",
                TargetsForNet(document, connected, acLine.Key),
                "protective-earth"));
        }

        var energized = new List<string>();
        foreach (DeviceInstanceV5 device in document.Devices)
        {
            if (!profiles.TryGetValue(device.Id, out DeviceProfileV5? profile))
            {
                continue;
            }

            switch (profile.Kind)
            {
                case DeviceProfileKind.Lamp:
                    ValidateLamp(document, device, positive, dcReturn, connected, issues, energized);
                    break;
                case DeviceProfileKind.NpnProximitySensor:
                    ValidateSensor(document, device, profiles, positive, dcReturn, connected, issues, isNpn: true);
                    break;
                case DeviceProfileKind.PnpProximitySensor:
                    ValidateSensor(document, device, profiles, positive, dcReturn, connected, issues, isNpn: false);
                    break;
                case DeviceProfileKind.AcLoad:
                    ValidateAcLoad(document, device, acLine, acNeutral, protectiveEarth, connected, issues, energized);
                    break;
                case DeviceProfileKind.TwoWireTransmitter:
                    ValidateCurrentLoop(document, device, profiles, positive, dcReturn, connected, issues);
                    break;
            }
        }

        Dictionary<string, string[]> groups = connected.SnapshotGroups();
        TerminalElectricalStateV5[] terminalStates = terminalDefinitions
            .Select(pair => new TerminalElectricalStateV5(
                pair.Key,
                connected.GroupId(pair.Key),
                pair.Value.Potential,
                ResolveVoltage(pair.Key, connected, positive, dcReturn, acLine, acNeutral)))
            .ToArray();
        var simulation = new SimulationResultV5([.. energized])
        {
            TerminalStates = terminalStates,
            ConductionGroups = groups,
            ConductorCurrents = document.Conductors.ToDictionary(
                conductor => conductor.Id,
                _ => (double?)null,
                StringComparer.Ordinal),
            ContactStates = document.Scenarios.FirstOrDefault()?.ContactStates.ToDictionary(StringComparer.Ordinal)
                ?? new Dictionary<string, bool>(StringComparer.Ordinal),
            Paths = groups.Select((group, index) => new CircuitPathV5(
                $"net-{index + 1}",
                "conduction",
                group.Value,
                document.Conductors
                    .Where(conductor => connected.AreConnected(group.Value[0], conductor.Start.Key))
                    .Select(conductor => conductor.Id)
                    .Distinct(StringComparer.Ordinal)
                    .ToArray()))
                .ToArray(),
        };
        var result = new ValidationResultV5(
            document.Revision,
            document.ContentHash,
            [.. issues.OrderBy(issue => issue.Severity).ThenByDescending(issue => issue.Blocking).ThenBy(issue => issue.Code)],
            simulation);
        return Task.FromResult(result);
    }

    /// <summary>SolveAsync 작업을 수행합니다.</summary>
    public async Task<CircuitSolutionV5> SolveAsync(
        WorkshopDocumentV5 document,
        CancellationToken cancellationToken = default)
    {
        ValidationResultV5 result = await ValidateAsync(document, cancellationToken).ConfigureAwait(false);
        return new CircuitSolutionV5(
            result.Revision,
            result.ContentHash,
            result.Simulation,
            result.Issues.Where(issue => issue.ScenarioId is not "physical-layout" and not "physical-conductor" and not "physical-terminal").ToArray());
    }

    private static double? ResolveVoltage(
        string terminalKey,
        DisjointSet connected,
        TerminalRefV5? positive,
        TerminalRefV5? dcReturn,
        TerminalRefV5? acLine,
        TerminalRefV5? acNeutral)
    {
        if (positive is not null && connected.AreConnected(terminalKey, positive.Key))
        {
            return 24;
        }

        if (dcReturn is not null && connected.AreConnected(terminalKey, dcReturn.Key))
        {
            return 0;
        }

        if (acLine is not null && connected.AreConnected(terminalKey, acLine.Key))
        {
            return 230;
        }

        return acNeutral is not null && connected.AreConnected(terminalKey, acNeutral.Key) ? 0 : null;
    }

    private static void ValidateLamp(
        WorkshopDocumentV5 document,
        DeviceInstanceV5 device,
        TerminalRefV5? positive,
        TerminalRefV5? dcReturn,
        DisjointSet connected,
        List<ValidationIssueV5> issues,
        List<string> energized)
    {
        bool positiveOk = IsConnected(connected, new TerminalRefV5(device.Id, "A1"), positive);
        bool returnOk = IsConnected(connected, new TerminalRefV5(device.Id, "A2"), dcReturn);
        if (positiveOk && returnOk)
        {
            energized.Add(device.Id);
            return;
        }

        TerminalRefV5 problem = positiveOk
            ? new TerminalRefV5(device.Id, "A2")
            : new TerminalRefV5(device.Id, "A1");
        issues.Add(Issue(
            document,
                ValidationIssueCodes.LAMP_OPEN_OR_REVERSED,
            ValidationSeverity.Error,
            true,
            $"'{device.Label}' 표시등의 +24V/0V 결선을 확인하십시오.",
            TargetsForTerminal(document, problem),
            "dc-load"));
    }

    private static void ValidateSensor(
        WorkshopDocumentV5 document,
        DeviceInstanceV5 sensor,
        Dictionary<string, DeviceProfileV5> profiles,
        TerminalRefV5? positive,
        TerminalRefV5? dcReturn,
        DisjointSet connected,
        List<ValidationIssueV5> issues,
        bool isNpn)
    {
        var brown = new TerminalRefV5(sensor.Id, "BN");
        var blue = new TerminalRefV5(sensor.Id, "BU");
        var black = new TerminalRefV5(sensor.Id, "BK");

        if (!IsConnected(connected, brown, positive))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.SENSOR_SUPPLY_POSITIVE,
                ValidationSeverity.Error,
                true,
                $"'{sensor.Label}' 센서의 갈색 BN을 +24V에 연결하십시오.",
                TargetsForTerminal(document, brown),
                "sensor-supply"));
        }

        if (!IsConnected(connected, blue, dcReturn))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.SENSOR_SUPPLY_RETURN,
                ValidationSeverity.Error,
                true,
                $"'{sensor.Label}' 센서의 청색 BU를 0V에 연결하십시오.",
                TargetsForTerminal(document, blue),
                "sensor-supply"));
        }

        TerminalRefV5? plcInput = FindTerminalOnNet(document, profiles, connected, black.Key, TerminalRole.PlcInput);
        if (plcInput is null)
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.SENSOR_OUTPUT_NOT_CONNECTED,
                ValidationSeverity.Error,
                true,
                $"'{sensor.Label}' 센서의 흑색 BK 출력을 PLC 입력에 연결하십시오.",
                TargetsForTerminal(document, black),
                "sensor-output"));
            return;
        }

        string? commonGroup = profiles[plcInput.DeviceId].Terminals
            .FirstOrDefault(terminal => terminal.Id == plcInput.TerminalId)
            ?.CommonGroup;
        TerminalRefV5? common = FindTerminalForDevice(
            profiles,
            plcInput.DeviceId,
            TerminalRole.PlcInputCommon,
            commonGroup);
        TerminalRefV5? expected = isNpn ? positive : dcReturn;
        if (common is null || !IsConnected(connected, common, expected))
        {
            string code = isNpn
                ? ValidationIssueCodes.NPN_INPUT_COMMON_POLARITY
                : ValidationIssueCodes.PNP_INPUT_COMMON_POLARITY;
            string expectedLabel = isNpn ? "+24V" : "0V";
            issues.Add(Issue(
                document,
                code,
                ValidationSeverity.Error,
                true,
                $"{(isNpn ? "NPN sinking" : "PNP sourcing")} 입력의 PLC COM은 {expectedLabel}에 연결해야 합니다.",
                common is null ? TargetsForTerminal(document, plcInput) : TargetsForTerminal(document, common),
                isNpn ? "npn-sinking" : "pnp-sourcing"));
        }
    }

    private static void ValidateAcLoad(
        WorkshopDocumentV5 document,
        DeviceInstanceV5 device,
        TerminalRefV5? acLine,
        TerminalRefV5? acNeutral,
        TerminalRefV5? protectiveEarth,
        DisjointSet connected,
        List<ValidationIssueV5> issues,
        List<string> energized)
    {
        var loadLine = new TerminalRefV5(device.Id, "L");
        var loadNeutral = new TerminalRefV5(device.Id, "N");
        var loadEarth = new TerminalRefV5(device.Id, "PE");
        bool lineOk = IsConnected(connected, loadLine, acLine);
        bool neutralOk = IsConnected(connected, loadNeutral, acNeutral);
        bool earthOk = protectiveEarth is null || IsConnected(connected, loadEarth, protectiveEarth);
        if (lineOk && neutralOk && earthOk)
        {
            energized.Add(device.Id);
            return;
        }

        TerminalRefV5 problem = !lineOk ? loadLine : !neutralOk ? loadNeutral : loadEarth;
        issues.Add(Issue(
            document,
                ValidationIssueCodes.AC_LOAD_WIRING,
            ValidationSeverity.Error,
            true,
            $"'{device.Label}' AC 부하의 L/N/PE 결선을 확인하십시오.",
            TargetsForTerminal(document, problem),
            "ac-load"));
    }

    private static void ValidateCurrentLoop(
        WorkshopDocumentV5 document,
        DeviceInstanceV5 transmitter,
        IReadOnlyDictionary<string, DeviceProfileV5> profiles,
        TerminalRefV5? positive,
        TerminalRefV5? dcReturn,
        DisjointSet connected,
        List<ValidationIssueV5> issues)
    {
        var transmitterPositive = new TerminalRefV5(transmitter.Id, "+");
        var transmitterNegative = new TerminalRefV5(transmitter.Id, "-");
        TerminalRefV5? inputPositive = FindTerminalOnNet(
            document,
            profiles,
            connected,
            transmitterNegative.Key,
            TerminalRole.AnalogInputPositive);
        TerminalRefV5? inputNegative = inputPositive is null
            ? null
            : FindTerminalForDevice(profiles, inputPositive.DeviceId, TerminalRole.AnalogInputNegative);

        // 2선식 루프는 +24V → TX+ → TX- → AI+ → AI- → 0V의 직렬 극성을 보존해야 합니다.
        bool topologyIsValid = IsConnected(connected, transmitterPositive, positive)
            && inputPositive is not null
            && inputNegative is not null
            && IsConnected(connected, inputNegative, dcReturn);
        if (!topologyIsValid)
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.CURRENT_LOOP_POLARITY,
                ValidationSeverity.Error,
                true,
                $"'{transmitter.Label}' 4-20 mA 루프의 전원·전송기·입력 극성 또는 직렬 경로가 잘못되었습니다.",
                TargetsForTerminal(document, transmitterPositive),
                "current-loop"));
        }

        if (!transmitter.UserProperties.ContainsKey("engineeringMin")
            || !transmitter.UserProperties.ContainsKey("engineeringMax"))
        {
            issues.Add(Issue(
                document,
                ValidationIssueCodes.ANALOG_SCALING_INCOMPLETE,
                ValidationSeverity.Warning,
                false,
                $"'{transmitter.Label}' 전송기의 공학 단위 스케일 범위가 지정되지 않았습니다.",
                [DeviceTarget(transmitter)],
                "analog-scaling"));
        }
    }

    private static TerminalRefV5? FindFirstTerminal(
        WorkshopDocumentV5 document,
        IReadOnlyDictionary<string, DeviceProfileV5> profiles,
        TerminalRole role)
    {
        foreach (DeviceInstanceV5 device in document.Devices)
        {
            TerminalRefV5? terminal = FindTerminalForDevice(profiles, device.Id, role);
            if (terminal is not null)
            {
                return terminal;
            }
        }

        return null;
    }

    private static TerminalRefV5? FindTerminalForDevice(
        IReadOnlyDictionary<string, DeviceProfileV5> profiles,
        string deviceId,
        TerminalRole role,
        string? commonGroup = null)
    {
        if (!profiles.TryGetValue(deviceId, out DeviceProfileV5? profile))
        {
            return null;
        }

        TerminalDefinitionV5? terminal = !string.IsNullOrWhiteSpace(commonGroup)
            ? profile.Terminals.FirstOrDefault(item => item.Role == role
                && (string.Equals(item.Id, commonGroup, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(item.CommonGroup, commonGroup, StringComparison.OrdinalIgnoreCase)))
            : null;
        terminal ??= profile.Terminals.FirstOrDefault(item => item.Role == role);
        return terminal is null ? null : new TerminalRefV5(deviceId, terminal.Id);
    }

    private static TerminalRefV5? FindTerminalOnNet(
        WorkshopDocumentV5 document,
        IReadOnlyDictionary<string, DeviceProfileV5> profiles,
        DisjointSet connected,
        string netMember,
        TerminalRole role)
    {
        foreach (DeviceInstanceV5 device in document.Devices)
        {
            if (!profiles.TryGetValue(device.Id, out DeviceProfileV5? profile))
            {
                continue;
            }

            foreach (TerminalDefinitionV5 definition in profile.Terminals.Where(item => item.Role == role))
            {
                var terminal = new TerminalRefV5(device.Id, definition.Id);
                if (connected.AreConnected(netMember, terminal.Key))
                {
                    return terminal;
                }
            }
        }

        return null;
    }

    private static bool IsConnected(DisjointSet connected, TerminalRefV5 terminal, TerminalRefV5? expected)
        => expected is not null && connected.AreConnected(terminal.Key, expected.Key);

    private static bool IsDynamicContactClosed(
        WorkshopDocumentV5 document,
        string deviceId,
        InternalLinkV5 link)
    {
        bool active = false;
        if (link.StateKey is not null)
        {
            SimulationScenarioV5? scenario = document.Scenarios.FirstOrDefault();
            if (scenario is not null)
            {
                active = scenario.ContactStates.TryGetValue($"{deviceId}:{link.StateKey}", out bool qualified)
                    ? qualified
                    : scenario.ContactStates.GetValueOrDefault(link.StateKey);
            }

            DeviceInstanceV5? device = document.Devices.FirstOrDefault(item => item.Id == deviceId);
            if (device?.UserProperties.TryGetValue(link.StateKey, out string? configured) == true
                && bool.TryParse(configured, out bool parsed))
            {
                active = parsed;
            }
        }

        return link.NormallyClosed ? !active : active;
    }

    private static int EffectiveMaximumConductors(
        WorkshopDocumentV5 document,
        TerminalRefV5 reference,
        TerminalDefinitionV5 terminal)
        => document.TerminalAssemblies
            .Where(assembly => assembly.DeviceId == reference.DeviceId
                && assembly.TerminalIds.Contains(terminal.Id, StringComparer.Ordinal)
                && assembly.MaximumConductorsPerTerminal is > 0)
            .Select(assembly => assembly.MaximumConductorsPerTerminal!.Value)
            .DefaultIfEmpty(terminal.MaxConductors)
            .Min();

    private static ValidationIssueV5 Issue(
        WorkshopDocumentV5 document,
        string code,
        ValidationSeverity severity,
        bool blocking,
        string message,
        ValidationTargetV5[] targets,
        string scenarioId)
        => new(code, severity, blocking, message, document.Revision, document.ContentHash, targets, scenarioId);

    private static ValidationTargetV5 DeviceTarget(DeviceInstanceV5 device)
        => new(ValidationTargetKind.Device, device.Id, device.Id);

    private static ValidationTargetV5 ConductorTarget(ConductorV5 conductor)
        => new(ValidationTargetKind.Conductor, conductor.Id);

    private static ValidationTargetV5[] TargetsForTerminal(WorkshopDocumentV5 document, TerminalRefV5 terminal)
    {
        ConductorV5? conductor = document.Conductors.FirstOrDefault(
            item => item.Start == terminal || item.End == terminal);
        var targets = new List<ValidationTargetV5>();
        if (conductor is not null)
        {
            targets.Add(ConductorTarget(conductor));
        }

        targets.Add(new ValidationTargetV5(ValidationTargetKind.Terminal, terminal.Key, terminal.DeviceId, terminal.TerminalId));
        targets.Add(new ValidationTargetV5(ValidationTargetKind.Device, terminal.DeviceId, terminal.DeviceId));
        return [.. targets];
    }

    private static ValidationTargetV5[] TargetsForNet(
        WorkshopDocumentV5 document,
        DisjointSet connected,
        string member)
        => [.. document.Conductors
            .Where(conductor => connected.AreConnected(member, conductor.Start.Key))
            .Select(ConductorTarget)];

}
