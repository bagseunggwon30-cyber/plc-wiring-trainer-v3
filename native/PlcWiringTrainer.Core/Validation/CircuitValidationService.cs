using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Validation;

public sealed class CircuitValidationService : IValidationService
{
    private readonly DeviceProfileCatalog _catalog;

    public CircuitValidationService(DeviceProfileCatalog catalog)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
    }

    public Task<ValidationResultV4> ValidateAsync(
        WorkshopDocumentV4 document,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        cancellationToken.ThrowIfCancellationRequested();

        var issues = new List<ValidationIssueV4>();
        var devices = document.Devices.ToDictionary(device => device.Id, StringComparer.Ordinal);
        var profiles = new Dictionary<string, DeviceProfileV4>(StringComparer.Ordinal);
        var validTerminals = new HashSet<string>(StringComparer.Ordinal);
        var terminalDefinitions = new Dictionary<string, TerminalDefinitionV4>(StringComparer.Ordinal);

        foreach (DeviceInstanceV4 device in document.Devices)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!_catalog.TryGet(device.ProfileId, out DeviceProfileV4 profile))
            {
                issues.Add(Issue(
                    document,
                    "PROFILE_NOT_FOUND",
                    ValidationSeverity.Error,
                    true,
                    $"'{device.Label}' 장비의 전기 프로필을 찾을 수 없습니다.",
                    [DeviceTarget(device)],
                    "profile"));
                continue;
            }

            profiles[device.Id] = profile;
            foreach (TerminalDefinitionV4 terminal in profile.Terminals)
            {
                string terminalKey = new TerminalRefV4(device.Id, terminal.Id).Key;
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
                    "DEVICE_OUTSIDE_PANEL",
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
                    "PROFILE_VERSION_MISMATCH",
                    ValidationSeverity.Error,
                    true,
                    $"'{device.Label}' 장비 프로필 버전이 현재 매니페스트와 다릅니다.",
                    [DeviceTarget(device)],
                    "profile"));
            }

            if (profile.EvidenceGrade == EvidenceGrade.Educational || device.EvidenceGrade == EvidenceGrade.Educational)
            {
                issues.Add(Issue(
                    document,
                    "EDUCATIONAL_PROFILE",
                    ValidationSeverity.Information,
                    false,
                    $"'{device.Label}' 장비는 교육용 자산입니다. 매뉴얼 검증 자산으로 간주하지 않습니다.",
                    [DeviceTarget(device)],
                    "evidence"));
            }
        }

        var connected = new DisjointSet();
        foreach (string terminal in validTerminals)
        {
            connected.Add(terminal);
        }

        foreach (IGrouping<string, ConductorV4> group in document.Conductors
            .Where(conductor => !string.IsNullOrWhiteSpace(conductor.Label))
            .GroupBy(conductor => conductor.Label, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1))
        {
            issues.Add(Issue(
                document,
                "DUPLICATE_WIRE_NUMBER",
                ValidationSeverity.Warning,
                false,
                $"선번 '{group.Key}'이(가) 둘 이상의 전선에 사용되었습니다.",
                [.. group.Select(ConductorTarget)],
                "physical-conductor"));
        }

        foreach (ConductorV4 conductor in document.Conductors)
        {
            if (!double.IsFinite(conductor.GaugeMm2) || conductor.GaugeMm2 <= 0)
            {
                issues.Add(Issue(
                    document,
                    "INVALID_CONDUCTOR_GAUGE",
                    ValidationSeverity.Error,
                    true,
                    $"'{conductor.Label}' 전선의 굵기는 0보다 커야 합니다.",
                    [ConductorTarget(conductor)],
                    "physical-conductor"));
            }

            if (string.IsNullOrWhiteSpace(conductor.Label))
            {
                issues.Add(Issue(
                    document,
                    "WIRE_NUMBER_REQUIRED",
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
                    "UNKNOWN_TERMINAL",
                    ValidationSeverity.Error,
                    true,
                    $"'{conductor.Label}' 전선이 존재하지 않는 단자를 참조합니다.",
                    [ConductorTarget(conductor)],
                    "topology"));
                continue;
            }

            connected.Union(conductor.Start.Key, conductor.End.Key);
        }

        foreach (IGrouping<string, TerminalRefV4> group in document.Conductors
            .SelectMany(conductor => new[] { conductor.Start, conductor.End })
            .GroupBy(terminal => terminal.Key, StringComparer.Ordinal))
        {
            if (terminalDefinitions.TryGetValue(group.Key, out TerminalDefinitionV4? terminal)
                && group.Count() > terminal.MaxConductors)
            {
                issues.Add(Issue(
                    document,
                    "TERMINAL_CAPACITY_EXCEEDED",
                    ValidationSeverity.Error,
                    true,
                    $"단자 '{group.Key}'의 허용 전선 수 {terminal.MaxConductors}개를 초과했습니다.",
                    TargetsForTerminal(document, group.First()),
                    "physical-terminal"));
            }
        }

        TerminalRefV4? positive = FindFirstTerminal(document, profiles, TerminalRole.DcSourcePositive);
        TerminalRefV4? dcReturn = FindFirstTerminal(document, profiles, TerminalRole.DcSourceReturn);
        if (positive is not null && dcReturn is not null && connected.AreConnected(positive.Key, dcReturn.Key))
        {
            issues.Add(Issue(
                document,
                "DC_SHORT_CIRCUIT",
                ValidationSeverity.Error,
                true,
                "+24V와 0V가 같은 결선망에 연결되어 있습니다.",
                TargetsForNet(document, connected, positive.Key),
                "dc-power"));
        }

        TerminalRefV4? acLine = FindFirstTerminal(document, profiles, TerminalRole.AcSourceLine);
        TerminalRefV4? acNeutral = FindFirstTerminal(document, profiles, TerminalRole.AcSourceNeutral);
        TerminalRefV4? protectiveEarth = FindFirstTerminal(document, profiles, TerminalRole.ProtectiveEarth);
        if (acLine is not null && acNeutral is not null && connected.AreConnected(acLine.Key, acNeutral.Key))
        {
            issues.Add(Issue(
                document,
                "AC_LINE_NEUTRAL_SHORT",
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
                "AC_LINE_TO_PE",
                ValidationSeverity.Error,
                true,
                "AC L이 보호 접지(PE)에 연결되어 있습니다.",
                TargetsForNet(document, connected, acLine.Key),
                "protective-earth"));
        }

        var energized = new List<string>();
        foreach (DeviceInstanceV4 device in document.Devices)
        {
            if (!profiles.TryGetValue(device.Id, out DeviceProfileV4? profile))
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

        var result = new ValidationResultV4(
            document.Revision,
            document.ContentHash,
            [.. issues.OrderBy(issue => issue.Severity).ThenByDescending(issue => issue.Blocking).ThenBy(issue => issue.Code)],
            new SimulationResultV4([.. energized]));
        return Task.FromResult(result);
    }

    private static void ValidateLamp(
        WorkshopDocumentV4 document,
        DeviceInstanceV4 device,
        TerminalRefV4? positive,
        TerminalRefV4? dcReturn,
        DisjointSet connected,
        List<ValidationIssueV4> issues,
        List<string> energized)
    {
        bool positiveOk = IsConnected(connected, new TerminalRefV4(device.Id, "A1"), positive);
        bool returnOk = IsConnected(connected, new TerminalRefV4(device.Id, "A2"), dcReturn);
        if (positiveOk && returnOk)
        {
            energized.Add(device.Id);
            return;
        }

        TerminalRefV4 problem = positiveOk
            ? new TerminalRefV4(device.Id, "A2")
            : new TerminalRefV4(device.Id, "A1");
        issues.Add(Issue(
            document,
            "LAMP_OPEN_OR_REVERSED",
            ValidationSeverity.Error,
            true,
            $"'{device.Label}' 표시등의 +24V/0V 결선을 확인하십시오.",
            TargetsForTerminal(document, problem),
            "dc-load"));
    }

    private static void ValidateSensor(
        WorkshopDocumentV4 document,
        DeviceInstanceV4 sensor,
        IReadOnlyDictionary<string, DeviceProfileV4> profiles,
        TerminalRefV4? positive,
        TerminalRefV4? dcReturn,
        DisjointSet connected,
        List<ValidationIssueV4> issues,
        bool isNpn)
    {
        var brown = new TerminalRefV4(sensor.Id, "BN");
        var blue = new TerminalRefV4(sensor.Id, "BU");
        var black = new TerminalRefV4(sensor.Id, "BK");

        if (!IsConnected(connected, brown, positive))
        {
            issues.Add(Issue(
                document,
                "SENSOR_SUPPLY_POSITIVE",
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
                "SENSOR_SUPPLY_RETURN",
                ValidationSeverity.Error,
                true,
                $"'{sensor.Label}' 센서의 청색 BU를 0V에 연결하십시오.",
                TargetsForTerminal(document, blue),
                "sensor-supply"));
        }

        TerminalRefV4? plcInput = FindTerminalOnNet(document, profiles, connected, black.Key, TerminalRole.PlcInput);
        if (plcInput is null)
        {
            issues.Add(Issue(
                document,
                "SENSOR_OUTPUT_NOT_CONNECTED",
                ValidationSeverity.Error,
                true,
                $"'{sensor.Label}' 센서의 흑색 BK 출력을 PLC 입력에 연결하십시오.",
                TargetsForTerminal(document, black),
                "sensor-output"));
            return;
        }

        TerminalRefV4? common = FindTerminalForDevice(profiles, plcInput.DeviceId, TerminalRole.PlcInputCommon);
        TerminalRefV4? expected = isNpn ? positive : dcReturn;
        if (common is null || !IsConnected(connected, common, expected))
        {
            string code = isNpn ? "NPN_INPUT_COMMON_POLARITY" : "PNP_INPUT_COMMON_POLARITY";
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
        WorkshopDocumentV4 document,
        DeviceInstanceV4 device,
        TerminalRefV4? acLine,
        TerminalRefV4? acNeutral,
        TerminalRefV4? protectiveEarth,
        DisjointSet connected,
        List<ValidationIssueV4> issues,
        List<string> energized)
    {
        var loadLine = new TerminalRefV4(device.Id, "L");
        var loadNeutral = new TerminalRefV4(device.Id, "N");
        var loadEarth = new TerminalRefV4(device.Id, "PE");
        bool lineOk = IsConnected(connected, loadLine, acLine);
        bool neutralOk = IsConnected(connected, loadNeutral, acNeutral);
        bool earthOk = protectiveEarth is null || IsConnected(connected, loadEarth, protectiveEarth);
        if (lineOk && neutralOk && earthOk)
        {
            energized.Add(device.Id);
            return;
        }

        TerminalRefV4 problem = !lineOk ? loadLine : !neutralOk ? loadNeutral : loadEarth;
        issues.Add(Issue(
            document,
            "AC_LOAD_WIRING",
            ValidationSeverity.Error,
            true,
            $"'{device.Label}' AC 부하의 L/N/PE 결선을 확인하십시오.",
            TargetsForTerminal(document, problem),
            "ac-load"));
    }

    private static void ValidateCurrentLoop(
        WorkshopDocumentV4 document,
        DeviceInstanceV4 transmitter,
        IReadOnlyDictionary<string, DeviceProfileV4> profiles,
        TerminalRefV4? positive,
        TerminalRefV4? dcReturn,
        DisjointSet connected,
        List<ValidationIssueV4> issues)
    {
        var transmitterPositive = new TerminalRefV4(transmitter.Id, "+");
        var transmitterNegative = new TerminalRefV4(transmitter.Id, "-");
        TerminalRefV4? inputPositive = FindTerminalOnNet(
            document,
            profiles,
            connected,
            transmitterNegative.Key,
            TerminalRole.AnalogInputPositive);
        TerminalRefV4? inputNegative = inputPositive is null
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
                "CURRENT_LOOP_POLARITY",
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
                "ANALOG_SCALING_INCOMPLETE",
                ValidationSeverity.Warning,
                false,
                $"'{transmitter.Label}' 전송기의 공학 단위 스케일 범위가 지정되지 않았습니다.",
                [DeviceTarget(transmitter)],
                "analog-scaling"));
        }
    }

    private static TerminalRefV4? FindFirstTerminal(
        WorkshopDocumentV4 document,
        IReadOnlyDictionary<string, DeviceProfileV4> profiles,
        TerminalRole role)
    {
        foreach (DeviceInstanceV4 device in document.Devices)
        {
            TerminalRefV4? terminal = FindTerminalForDevice(profiles, device.Id, role);
            if (terminal is not null)
            {
                return terminal;
            }
        }

        return null;
    }

    private static TerminalRefV4? FindTerminalForDevice(
        IReadOnlyDictionary<string, DeviceProfileV4> profiles,
        string deviceId,
        TerminalRole role)
    {
        if (!profiles.TryGetValue(deviceId, out DeviceProfileV4? profile))
        {
            return null;
        }

        TerminalDefinitionV4? terminal = profile.Terminals.FirstOrDefault(item => item.Role == role);
        return terminal is null ? null : new TerminalRefV4(deviceId, terminal.Id);
    }

    private static TerminalRefV4? FindTerminalOnNet(
        WorkshopDocumentV4 document,
        IReadOnlyDictionary<string, DeviceProfileV4> profiles,
        DisjointSet connected,
        string netMember,
        TerminalRole role)
    {
        foreach (DeviceInstanceV4 device in document.Devices)
        {
            TerminalRefV4? terminal = FindTerminalForDevice(profiles, device.Id, role);
            if (terminal is not null && connected.AreConnected(netMember, terminal.Key))
            {
                return terminal;
            }
        }

        return null;
    }

    private static bool IsConnected(DisjointSet connected, TerminalRefV4 terminal, TerminalRefV4? expected)
        => expected is not null && connected.AreConnected(terminal.Key, expected.Key);

    private static ValidationIssueV4 Issue(
        WorkshopDocumentV4 document,
        string code,
        ValidationSeverity severity,
        bool blocking,
        string message,
        ValidationTargetV4[] targets,
        string scenarioId)
        => new(code, severity, blocking, message, document.Revision, document.ContentHash, targets, scenarioId);

    private static ValidationTargetV4 DeviceTarget(DeviceInstanceV4 device)
        => new(ValidationTargetKind.Device, device.Id, device.Id);

    private static ValidationTargetV4 ConductorTarget(ConductorV4 conductor)
        => new(ValidationTargetKind.Conductor, conductor.Id);

    private static ValidationTargetV4[] TargetsForTerminal(WorkshopDocumentV4 document, TerminalRefV4 terminal)
    {
        ConductorV4? conductor = document.Conductors.FirstOrDefault(
            item => item.Start == terminal || item.End == terminal);
        var targets = new List<ValidationTargetV4>();
        if (conductor is not null)
        {
            targets.Add(ConductorTarget(conductor));
        }

        targets.Add(new ValidationTargetV4(ValidationTargetKind.Terminal, terminal.Key, terminal.DeviceId, terminal.TerminalId));
        targets.Add(new ValidationTargetV4(ValidationTargetKind.Device, terminal.DeviceId, terminal.DeviceId));
        return [.. targets];
    }

    private static ValidationTargetV4[] TargetsForNet(
        WorkshopDocumentV4 document,
        DisjointSet connected,
        string member)
        => [.. document.Conductors
            .Where(conductor => connected.AreConnected(member, conductor.Start.Key))
            .Select(ConductorTarget)];

    private sealed class DisjointSet
    {
        private readonly Dictionary<string, string> _parent = new(StringComparer.Ordinal);

        public void Add(string item)
        {
            if (!_parent.ContainsKey(item))
            {
                _parent[item] = item;
            }
        }

        public void Union(string left, string right)
        {
            Add(left);
            Add(right);
            string leftRoot = Find(left);
            string rightRoot = Find(right);
            if (!string.Equals(leftRoot, rightRoot, StringComparison.Ordinal))
            {
                _parent[rightRoot] = leftRoot;
            }
        }

        public bool AreConnected(string left, string right)
            => _parent.ContainsKey(left)
                && _parent.ContainsKey(right)
                && string.Equals(Find(left), Find(right), StringComparison.Ordinal);

        private string Find(string item)
        {
            string parent = _parent[item];
            if (!string.Equals(parent, item, StringComparison.Ordinal))
            {
                _parent[item] = Find(parent);
            }

            return _parent[item];
        }
    }
}
