using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Validation;

public enum DeviceProfileKind
{
    DcPowerSupply,
    Lamp,
    NpnProximitySensor,
    PnpProximitySensor,
    PlcDigitalInput,
    AcPowerSupply,
    AcLoad,
    TwoWireTransmitter,
    AnalogInput,
}

public sealed record DeviceProfileV4(
    string Id,
    int Version,
    string DisplayName,
    DeviceProfileKind Kind,
    EvidenceGrade EvidenceGrade,
    string AssetPath,
    TerminalDefinitionV4[] Terminals,
    bool IsPaletteVisible = true);

public sealed class DeviceProfileCatalog
{
    private readonly Dictionary<string, DeviceProfileV4> _profiles;

    public DeviceProfileCatalog(IEnumerable<DeviceProfileV4> profiles)
    {
        ArgumentNullException.ThrowIfNull(profiles);
        _profiles = profiles.ToDictionary(profile => profile.Id, StringComparer.Ordinal);
    }

    public IReadOnlyCollection<DeviceProfileV4> Profiles => _profiles.Values;

    public bool TryGet(string profileId, out DeviceProfileV4 profile)
        => _profiles.TryGetValue(profileId, out profile!);

    public static DeviceProfileCatalog CreateDefault()
        => new(
        [
            new DeviceProfileV4(
                "dc-supply-24v",
                1,
                "DC 24 V 전원",
                DeviceProfileKind.DcPowerSupply,
                EvidenceGrade.Educational,
                "Assets/Devices/dc-supply-24v.svg",
                [
                    Terminal("+24V", "+24V", TerminalPolarity.Positive, TerminalRole.DcSourcePositive, 120, 24, 8),
                    Terminal("0V", "0V", TerminalPolarity.Negative, TerminalRole.DcSourceReturn, 120, 58, 8),
                ]),
            new DeviceProfileV4(
                "lamp-green-v1",
                1,
                "녹색 표시등",
                DeviceProfileKind.Lamp,
                EvidenceGrade.Educational,
                "Assets/Devices/lamp-green-flat-screw-v1.png",
                [
                    Terminal("A1", "A1 (+)", TerminalPolarity.Positive, TerminalRole.LampPositive, 0, 22),
                    Terminal("A2", "A2 (-)", TerminalPolarity.Negative, TerminalRole.LampReturn, 0, 58),
                ]),
            new DeviceProfileV4(
                "lamp-yellow-v1",
                1,
                "황색 표시등",
                DeviceProfileKind.Lamp,
                EvidenceGrade.Educational,
                "Assets/Devices/lamp-yellow-flat-screw-v1.png",
                [
                    Terminal("A1", "A1 (+)", TerminalPolarity.Positive, TerminalRole.LampPositive, 0, 22),
                    Terminal("A2", "A2 (-)", TerminalPolarity.Negative, TerminalRole.LampReturn, 0, 58),
                ]),
            new DeviceProfileV4(
                "lamp-white-v1",
                1,
                "백색 표시등",
                DeviceProfileKind.Lamp,
                EvidenceGrade.Educational,
                "Assets/Devices/lamp-white-flat-screw-v1.png",
                [
                    Terminal("A1", "A1 (+)", TerminalPolarity.Positive, TerminalRole.LampPositive, 0, 22),
                    Terminal("A2", "A2 (-)", TerminalPolarity.Negative, TerminalRole.LampReturn, 0, 58),
                ]),
            new DeviceProfileV4(
                "prox-npn-v2",
                2,
                "NPN 근접 센서",
                DeviceProfileKind.NpnProximitySensor,
                EvidenceGrade.Educational,
                "Assets/Devices/prox-npn-v2.svg",
                [
                    Terminal("BN", "갈색 BN (+24V)", TerminalPolarity.Positive, TerminalRole.SupplyPositive, 0, 18),
                    Terminal("BK", "흑색 BK (출력)", TerminalPolarity.Signal, TerminalRole.NpnSinkOutput, 0, 42),
                    Terminal("BU", "청색 BU (0V)", TerminalPolarity.Negative, TerminalRole.SupplyReturn, 0, 66),
                ]),
            new DeviceProfileV4(
                "prox-pnp-v2",
                2,
                "PNP 근접 센서",
                DeviceProfileKind.PnpProximitySensor,
                EvidenceGrade.Educational,
                "Assets/Devices/prox-pnp-v2.svg",
                [
                    Terminal("BN", "갈색 BN (+24V)", TerminalPolarity.Positive, TerminalRole.SupplyPositive, 0, 18),
                    Terminal("BK", "흑색 BK (출력)", TerminalPolarity.Signal, TerminalRole.PnpSourceOutput, 0, 42),
                    Terminal("BU", "청색 BU (0V)", TerminalPolarity.Negative, TerminalRole.SupplyReturn, 0, 66),
                ]),
            new DeviceProfileV4(
                "plc-input-24v",
                1,
                "PLC DC 입력",
                DeviceProfileKind.PlcDigitalInput,
                EvidenceGrade.Educational,
                "Assets/Devices/plc-input-24v.svg",
                [
                    new TerminalDefinitionV4(
                        "I0",
                        "입력 I0",
                        TerminalDomain.DigitalInput,
                        TerminalPolarity.Signal,
                        TerminalRole.PlcInput,
                        0,
                        24),
                    new TerminalDefinitionV4(
                        "COM",
                        "입력 공통 COM",
                        TerminalDomain.DigitalInput,
                        TerminalPolarity.Common,
                        TerminalRole.PlcInputCommon,
                        0,
                        58),
                ]),
            new DeviceProfileV4(
                "ac-source-220v",
                1,
                "AC 220 V 전원",
                DeviceProfileKind.AcPowerSupply,
                EvidenceGrade.Educational,
                string.Empty,
                [
                    AcTerminal("L", "전원 L", TerminalPolarity.Line, TerminalRole.AcSourceLine, 120, 18),
                    AcTerminal("N", "전원 N", TerminalPolarity.Neutral, TerminalRole.AcSourceNeutral, 120, 42),
                    AcTerminal("PE", "보호 접지", TerminalPolarity.ProtectiveEarth, TerminalRole.ProtectiveEarth, 120, 66),
                ],
                false),
            new DeviceProfileV4(
                "ac-load-220v",
                1,
                "AC 부하",
                DeviceProfileKind.AcLoad,
                EvidenceGrade.Educational,
                string.Empty,
                [
                    AcTerminal("L", "부하 L", TerminalPolarity.Line, TerminalRole.AcLoadLine, 0, 18),
                    AcTerminal("N", "부하 N", TerminalPolarity.Neutral, TerminalRole.AcLoadNeutral, 0, 42),
                    AcTerminal("PE", "보호 접지", TerminalPolarity.ProtectiveEarth, TerminalRole.ProtectiveEarth, 0, 66),
                ],
                false),
            new DeviceProfileV4(
                "transmitter-2wire-4-20ma",
                1,
                "2선식 4-20 mA 전송기",
                DeviceProfileKind.TwoWireTransmitter,
                EvidenceGrade.Educational,
                string.Empty,
                [
                    new TerminalDefinitionV4(
                        "+",
                        "Loop +",
                        TerminalDomain.AnalogOutput,
                        TerminalPolarity.Positive,
                        TerminalRole.LoopTransmitterPositive,
                        0,
                        24),
                    new TerminalDefinitionV4(
                        "-",
                        "Loop -",
                        TerminalDomain.AnalogOutput,
                        TerminalPolarity.Negative,
                        TerminalRole.LoopTransmitterNegative,
                        0,
                        58),
                ],
                false),
            new DeviceProfileV4(
                "analog-input-4-20ma",
                1,
                "4-20 mA 아날로그 입력",
                DeviceProfileKind.AnalogInput,
                EvidenceGrade.Educational,
                string.Empty,
                [
                    new TerminalDefinitionV4(
                        "I+",
                        "전류 입력 +",
                        TerminalDomain.AnalogInput,
                        TerminalPolarity.Positive,
                        TerminalRole.AnalogInputPositive,
                        0,
                        24),
                    new TerminalDefinitionV4(
                        "I-",
                        "전류 입력 -",
                        TerminalDomain.AnalogInput,
                        TerminalPolarity.Negative,
                        TerminalRole.AnalogInputNegative,
                        0,
                        58),
                ],
                false),
        ]);

    private static TerminalDefinitionV4 Terminal(
        string id,
        string label,
        TerminalPolarity polarity,
        TerminalRole role,
        double x,
        double y,
        int maxConductors = 1)
        => new(id, label, TerminalDomain.DcPower, polarity, role, x, y, maxConductors);

    private static TerminalDefinitionV4 AcTerminal(
        string id,
        string label,
        TerminalPolarity polarity,
        TerminalRole role,
        double x,
        double y)
        => new(
            id,
            label,
            role == TerminalRole.ProtectiveEarth ? TerminalDomain.ProtectiveEarth : TerminalDomain.AcPower,
            polarity,
            role,
            x,
            y);
}
