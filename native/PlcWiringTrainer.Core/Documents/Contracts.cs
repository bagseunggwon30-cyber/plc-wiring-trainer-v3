using System.Text.Json;
using System.Text.Json.Serialization;

namespace PlcWiringTrainer.Core.Documents;

public enum EvidenceGrade
{
    Educational,
    ManualVerified,
    BenchVerified,
}

public enum WorkshopMode
{
    Practice,
    Prewire,
}

public enum CompletenessStatus
{
    Incomplete,
    Complete,
}

public enum SupplyKind
{
    None,
    Dc,
    AcSinglePhase,
    AcThreePhase,
}

public enum EarthingPolicy
{
    Unspecified,
    PeSeparateZeroVoltFloating,
    PeZeroVoltSinglePointBond,
    SiteDefinedBonding,
}

public enum TerminalDomain
{
    DcPower,
    AcPower,
    ProtectiveEarth,
    DigitalInput,
    DigitalOutput,
    AnalogInput,
    AnalogOutput,
    Signal,
    Contact,
    Communication,
    Floating,
}

public enum TerminalPotential
{
    None,
    Line1,
    Line2,
    Line3,
    Neutral,
    Positive24V,
    ZeroVolt,
    ProtectiveEarth,
    Signal,
    Floating,
}

public enum TerminalCommonType
{
    ConfigurableDc,
    DcControlCommon,
    DcOutputCommon,
    DryContact,
    AnalogReference,
    CommunicationReference,
    PowerPassThrough,
    FusedPower,
}

public enum TerminalProtocol
{
    None,
    Rs232,
    Rs485,
    AnalogVoltage,
    AnalogCurrent,
    PulseDirection,
    Encoder,
}

public enum TerminalOutputMode
{
    None,
    Relay,
    SinkingTransistor,
    SourcingTransistor,
}

public enum TerminalInputLogicMode
{
    None,
    Configurable,
    NpnInternal24V,
    PnpExternal24V,
}

public enum TerminalPolarity
{
    None,
    Positive,
    Negative,
    Line,
    Neutral,
    ProtectiveEarth,
    Signal,
    Common,
}

public enum TerminalRole
{
    Passive,
    DcSourcePositive,
    DcSourceReturn,
    SupplyPositive,
    SupplyReturn,
    LampPositive,
    LampReturn,
    NpnSinkOutput,
    PnpSourceOutput,
    PlcInput,
    PlcInputCommon,
    AcSourceLine,
    AcSourceNeutral,
    ProtectiveEarth,
    AcLoadLine,
    AcLoadNeutral,
    LoopTransmitterPositive,
    LoopTransmitterNegative,
    AnalogInputPositive,
    AnalogInputNegative,
}

public sealed record PointV5(double X, double Y);

public sealed record RectV5(double X, double Y, double Width, double Height)
{
    public RectV5 Inflate(double amount) => new(X - amount, Y - amount, Width + (amount * 2), Height + (amount * 2));
}

public sealed record TerminalRefV5(string DeviceId, string TerminalId)
{
    public string Key => $"{DeviceId}:{TerminalId}";
}

public sealed record TerminalDefinitionV5(
    string Id,
    string Label,
    TerminalDomain Domain,
    TerminalPolarity Polarity,
    TerminalRole Role,
    double OffsetX,
    double OffsetY,
    int MaxConductors = 1)
{
    public string[] Aliases { get; init; } = [];

    public TerminalPotential Potential { get; init; } = TerminalPotential.None;

    public TerminalCommonType? CommonType { get; init; }

    public string? Phase { get; init; }

    public string? CommonGroup { get; init; }

    public string? Channel { get; init; }

    public TerminalProtocol Protocol { get; init; } = TerminalProtocol.None;

    public TerminalOutputMode OutputMode { get; init; } = TerminalOutputMode.None;

    public TerminalInputLogicMode InputLogicMode { get; init; } = TerminalInputLogicMode.None;

    public TerminalPotential ActivationPotential { get; init; } = TerminalPotential.None;

    public double? MinimumVoltage { get; init; }

    public double? MaximumVoltage { get; init; }

    public double? MinimumConductorMm2 { get; init; }

    public double? MaximumConductorMm2 { get; init; }

    public double HitRadius { get; init; } = 12;

    public string LeadOutSide { get; init; } = "auto";

    public double LeadOutDistance { get; init; } = 18;

    public string[] EvidenceReferences { get; init; } = [];
}

public enum InternalLinkKind
{
    Conductive,
    DynamicContact,
    Fused,
    PassThrough,
}

public sealed record InternalLinkV5(
    string FromTerminalId,
    string ToTerminalId,
    InternalLinkKind Kind,
    string? StateKey = null,
    bool NormallyClosed = false);

public sealed record DeviceInstanceV5(
    string Id,
    string ProfileId,
    int ProfileVersion,
    EvidenceGrade EvidenceGrade,
    string Label,
    double X,
    double Y,
    double Rotation,
    double Width,
    double Height,
    bool Locked,
    Dictionary<string, string> UserProperties)
{
    public string? AssetVersion { get; init; }

    public string? ExactOrderCode { get; init; }

    public string? Designation { get; init; }

    public string? CatalogEntryId { get; init; }
}

public sealed record ConductorV5(
    string Id,
    TerminalRefV5 Start,
    TerminalRefV5 End,
    PointV5[] Waypoints,
    string Label,
    string Color,
    double GaugeMm2,
    bool RouteLocked)
{
    public string WireNumber { get; init; } = Label;

    public bool ManualColor { get; init; }

    public string? CableAssemblyId { get; init; }

    public string? Core { get; init; }

    public string? Gauge { get; init; }

    public string? Awg { get; init; }

    public double? LengthMm { get; init; }

    public string? PairId { get; init; }

    public bool Shielded { get; init; }

    public bool Drain { get; init; }

    public string? FerruleFrom { get; init; }

    public string? FerruleTo { get; init; }

    public string? LugFrom { get; init; }

    public string? LugTo { get; init; }

    public bool DiagnosticOverride { get; init; }
}

public sealed record TerminalBridgeV5(
    string Id,
    TerminalRefV5[] Terminals,
    string Color);

public sealed record SourceSystemDefinitionV5(
    string? Id,
    string? Label,
    CompletenessStatus Status,
    SupplyKind Kind,
    double? NominalVoltage,
    string[] Conductors,
    EarthingPolicy EarthingPolicy);

public sealed record PhysicalLayoutDefinitionV5(
    CompletenessStatus Status,
    string SourceUnit,
    double? CanvasUnitsPerMm);

public sealed record CableAssemblyV5(
    string Id,
    string? Designation,
    string[] ConductorIds,
    string? CableType,
    double? LengthMm,
    bool Shielded,
    string? DrainConductorId,
    PointV5[] Route);

public sealed record TerminalAssemblyV5(
    string Id,
    string DeviceId,
    string[] TerminalIds,
    string? Manufacturer,
    string? OrderCode,
    string? Designation,
    string? TerminalType,
    string? Marker,
    int? MaximumConductorsPerTerminal,
    string[] Accessories);

public enum PanelElementKind
{
    DinRail,
    WireDuct,
    Door,
    Cabinet,
    GroundBar,
}

public sealed record PanelElementV5(
    string Id,
    PanelElementKind Kind,
    RectV5 Bounds,
    double Rotation,
    bool Locked,
    Dictionary<string, string> Properties);

public sealed record ViewLayoutV5(Dictionary<string, PointV5> Positions);

public sealed record SimulationScenarioV5(
    string Id,
    Dictionary<string, bool> ContactStates,
    Dictionary<string, string> Properties);

public sealed record MissionStateV5(
    string? ScenarioId,
    int HintLevel,
    Dictionary<string, string> RoleBindings);

public sealed record PlcRuntimeBindingV5(
    string Id,
    string DeviceId,
    string TerminalId,
    string PlcAddress,
    string Direction);

public sealed record PanelLayoutV5(double Width, double Height);

public sealed record ViewportV5(double Zoom, double OffsetX, double OffsetY);

public sealed record WorkshopSettingsV5(
    double GridSize,
    bool SnapToGrid,
    bool AutoWireColor = true,
    bool FaultInjectionEnabled = false);

/// <summary>PLC Wiring Trainer 4.x의 무손실 네이티브 영속 문서 계약입니다.</summary>
public sealed record WorkshopDocumentV5
{
    public int SchemaVersion { get; init; } = 5;

    public required string DocumentId { get; init; }

    public required int Revision { get; init; }

    public required string Name { get; init; }

    public required DeviceInstanceV5[] Devices { get; init; }

    public required ConductorV5[] Conductors { get; init; }

    public required TerminalBridgeV5[] TerminalBridges { get; init; }

    public required PanelLayoutV5 Panel { get; init; }

    public required ViewportV5 Viewport { get; init; }

    public required WorkshopSettingsV5 Settings { get; init; }

    public WorkshopMode Mode { get; init; } = WorkshopMode.Practice;

    public SourceSystemDefinitionV5 SourceSystem { get; init; } = new(
        null,
        null,
        CompletenessStatus.Incomplete,
        SupplyKind.None,
        null,
        [],
        EarthingPolicy.Unspecified);

    public PhysicalLayoutDefinitionV5 PhysicalLayout { get; init; } = new(
        CompletenessStatus.Incomplete,
        "canvas-unit",
        null);

    public CableAssemblyV5[] CableAssemblies { get; init; } = [];

    public TerminalAssemblyV5[] TerminalAssemblies { get; init; } = [];

    public PanelElementV5[] PanelElements { get; init; } = [];

    public Dictionary<string, ViewLayoutV5> ViewLayouts { get; init; } = new(StringComparer.Ordinal);

    public SimulationScenarioV5[] Scenarios { get; init; } = [];

    public MissionStateV5 MissionState { get; init; } = new(null, 0, new Dictionary<string, string>(StringComparer.Ordinal));

    public PlcRuntimeBindingV5[] PlcRuntimeBindings { get; init; } = [];

    public required Dictionary<string, JsonElement> Extensions { get; init; }

    public string ContentHash { get; init; } = string.Empty;

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? UnknownFields { get; init; }
}
