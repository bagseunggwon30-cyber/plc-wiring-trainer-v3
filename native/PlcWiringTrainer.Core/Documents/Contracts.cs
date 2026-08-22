using System.Text.Json;
using System.Text.Json.Serialization;

namespace PlcWiringTrainer.Core.Documents;

/// <summary>EvidenceGrade 값의 종류를 정의합니다.</summary>
public enum EvidenceGrade
{
    /// <summary>Educational 상태를 나타냅니다.</summary>
    Educational,
    /// <summary>ManualVerified 상태를 나타냅니다.</summary>
    ManualVerified,
    /// <summary>BenchVerified 상태를 나타냅니다.</summary>
    BenchVerified,
}

/// <summary>WorkshopMode 값의 종류를 정의합니다.</summary>
public enum WorkshopMode
{
    /// <summary>Practice 상태를 나타냅니다.</summary>
    Practice,
    /// <summary>Prewire 상태를 나타냅니다.</summary>
    Prewire,
}

/// <summary>CompletenessStatus 값의 종류를 정의합니다.</summary>
public enum CompletenessStatus
{
    /// <summary>Incomplete 상태를 나타냅니다.</summary>
    Incomplete,
    /// <summary>Complete 상태를 나타냅니다.</summary>
    Complete,
}

/// <summary>SupplyKind 값의 종류를 정의합니다.</summary>
public enum SupplyKind
{
    /// <summary>None 상태를 나타냅니다.</summary>
    None,
    /// <summary>Dc 상태를 나타냅니다.</summary>
    Dc,
    /// <summary>AcSinglePhase 상태를 나타냅니다.</summary>
    AcSinglePhase,
    /// <summary>AcThreePhase 상태를 나타냅니다.</summary>
    AcThreePhase,
}

/// <summary>EarthingPolicy 값의 종류를 정의합니다.</summary>
public enum EarthingPolicy
{
    /// <summary>Unspecified 상태를 나타냅니다.</summary>
    Unspecified,
    /// <summary>PeSeparateZeroVoltFloating 상태를 나타냅니다.</summary>
    PeSeparateZeroVoltFloating,
    /// <summary>PeZeroVoltSinglePointBond 상태를 나타냅니다.</summary>
    PeZeroVoltSinglePointBond,
    /// <summary>SiteDefinedBonding 상태를 나타냅니다.</summary>
    SiteDefinedBonding,
}

/// <summary>TerminalDomain 값의 종류를 정의합니다.</summary>
public enum TerminalDomain
{
    /// <summary>DcPower 상태를 나타냅니다.</summary>
    DcPower,
    /// <summary>AcPower 상태를 나타냅니다.</summary>
    AcPower,
    /// <summary>ProtectiveEarth 상태를 나타냅니다.</summary>
    ProtectiveEarth,
    /// <summary>DigitalInput 상태를 나타냅니다.</summary>
    DigitalInput,
    /// <summary>DigitalOutput 상태를 나타냅니다.</summary>
    DigitalOutput,
    /// <summary>AnalogInput 상태를 나타냅니다.</summary>
    AnalogInput,
    /// <summary>AnalogOutput 상태를 나타냅니다.</summary>
    AnalogOutput,
    /// <summary>Signal 상태를 나타냅니다.</summary>
    Signal,
    /// <summary>Contact 상태를 나타냅니다.</summary>
    Contact,
    /// <summary>Communication 상태를 나타냅니다.</summary>
    Communication,
    /// <summary>Floating 상태를 나타냅니다.</summary>
    Floating,
}

/// <summary>TerminalPotential 값의 종류를 정의합니다.</summary>
public enum TerminalPotential
{
    /// <summary>None 상태를 나타냅니다.</summary>
    None,
    /// <summary>Line1 상태를 나타냅니다.</summary>
    Line1,
    /// <summary>Line2 상태를 나타냅니다.</summary>
    Line2,
    /// <summary>Line3 상태를 나타냅니다.</summary>
    Line3,
    /// <summary>Neutral 상태를 나타냅니다.</summary>
    Neutral,
    /// <summary>Positive24V 상태를 나타냅니다.</summary>
    Positive24V,
    /// <summary>ZeroVolt 상태를 나타냅니다.</summary>
    ZeroVolt,
    /// <summary>ProtectiveEarth 상태를 나타냅니다.</summary>
    ProtectiveEarth,
    /// <summary>Signal 상태를 나타냅니다.</summary>
    Signal,
    /// <summary>Floating 상태를 나타냅니다.</summary>
    Floating,
}

/// <summary>TerminalCommonType 값의 종류를 정의합니다.</summary>
public enum TerminalCommonType
{
    /// <summary>ConfigurableDc 상태를 나타냅니다.</summary>
    ConfigurableDc,
    /// <summary>DcControlCommon 상태를 나타냅니다.</summary>
    DcControlCommon,
    /// <summary>DcOutputCommon 상태를 나타냅니다.</summary>
    DcOutputCommon,
    /// <summary>DryContact 상태를 나타냅니다.</summary>
    DryContact,
    /// <summary>AnalogReference 상태를 나타냅니다.</summary>
    AnalogReference,
    /// <summary>CommunicationReference 상태를 나타냅니다.</summary>
    CommunicationReference,
    /// <summary>PowerPassThrough 상태를 나타냅니다.</summary>
    PowerPassThrough,
    /// <summary>FusedPower 상태를 나타냅니다.</summary>
    FusedPower,
}

/// <summary>TerminalProtocol 값의 종류를 정의합니다.</summary>
public enum TerminalProtocol
{
    /// <summary>None 상태를 나타냅니다.</summary>
    None,
    /// <summary>Rs232 상태를 나타냅니다.</summary>
    Rs232,
    /// <summary>Rs485 상태를 나타냅니다.</summary>
    Rs485,
    /// <summary>AnalogVoltage 상태를 나타냅니다.</summary>
    AnalogVoltage,
    /// <summary>AnalogCurrent 상태를 나타냅니다.</summary>
    AnalogCurrent,
    /// <summary>PulseDirection 상태를 나타냅니다.</summary>
    PulseDirection,
    /// <summary>Encoder 상태를 나타냅니다.</summary>
    Encoder,
}

/// <summary>TerminalOutputMode 값의 종류를 정의합니다.</summary>
public enum TerminalOutputMode
{
    /// <summary>None 상태를 나타냅니다.</summary>
    None,
    /// <summary>Relay 상태를 나타냅니다.</summary>
    Relay,
    /// <summary>SinkingTransistor 상태를 나타냅니다.</summary>
    SinkingTransistor,
    /// <summary>SourcingTransistor 상태를 나타냅니다.</summary>
    SourcingTransistor,
}

/// <summary>TerminalInputLogicMode 값의 종류를 정의합니다.</summary>
public enum TerminalInputLogicMode
{
    /// <summary>None 상태를 나타냅니다.</summary>
    None,
    /// <summary>Configurable 상태를 나타냅니다.</summary>
    Configurable,
    /// <summary>NpnInternal24V 상태를 나타냅니다.</summary>
    NpnInternal24V,
    /// <summary>PnpExternal24V 상태를 나타냅니다.</summary>
    PnpExternal24V,
}

/// <summary>TerminalPolarity 값의 종류를 정의합니다.</summary>
public enum TerminalPolarity
{
    /// <summary>None 상태를 나타냅니다.</summary>
    None,
    /// <summary>Positive 상태를 나타냅니다.</summary>
    Positive,
    /// <summary>Negative 상태를 나타냅니다.</summary>
    Negative,
    /// <summary>Line 상태를 나타냅니다.</summary>
    Line,
    /// <summary>Neutral 상태를 나타냅니다.</summary>
    Neutral,
    /// <summary>ProtectiveEarth 상태를 나타냅니다.</summary>
    ProtectiveEarth,
    /// <summary>Signal 상태를 나타냅니다.</summary>
    Signal,
    /// <summary>Common 상태를 나타냅니다.</summary>
    Common,
}

/// <summary>TerminalRole 값의 종류를 정의합니다.</summary>
public enum TerminalRole
{
    /// <summary>Passive 상태를 나타냅니다.</summary>
    Passive,
    /// <summary>DcSourcePositive 상태를 나타냅니다.</summary>
    DcSourcePositive,
    /// <summary>DcSourceReturn 상태를 나타냅니다.</summary>
    DcSourceReturn,
    /// <summary>SupplyPositive 상태를 나타냅니다.</summary>
    SupplyPositive,
    /// <summary>SupplyReturn 상태를 나타냅니다.</summary>
    SupplyReturn,
    /// <summary>LampPositive 상태를 나타냅니다.</summary>
    LampPositive,
    /// <summary>LampReturn 상태를 나타냅니다.</summary>
    LampReturn,
    /// <summary>NpnSinkOutput 상태를 나타냅니다.</summary>
    NpnSinkOutput,
    /// <summary>PnpSourceOutput 상태를 나타냅니다.</summary>
    PnpSourceOutput,
    /// <summary>PlcInput 상태를 나타냅니다.</summary>
    PlcInput,
    /// <summary>PlcInputCommon 상태를 나타냅니다.</summary>
    PlcInputCommon,
    /// <summary>AcSourceLine 상태를 나타냅니다.</summary>
    AcSourceLine,
    /// <summary>AcSourceNeutral 상태를 나타냅니다.</summary>
    AcSourceNeutral,
    /// <summary>ProtectiveEarth 상태를 나타냅니다.</summary>
    ProtectiveEarth,
    /// <summary>AcLoadLine 상태를 나타냅니다.</summary>
    AcLoadLine,
    /// <summary>AcLoadNeutral 상태를 나타냅니다.</summary>
    AcLoadNeutral,
    /// <summary>LoopTransmitterPositive 상태를 나타냅니다.</summary>
    LoopTransmitterPositive,
    /// <summary>LoopTransmitterNegative 상태를 나타냅니다.</summary>
    LoopTransmitterNegative,
    /// <summary>AnalogInputPositive 상태를 나타냅니다.</summary>
    AnalogInputPositive,
    /// <summary>AnalogInputNegative 상태를 나타냅니다.</summary>
    AnalogInputNegative,
}

/// <summary>PointV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="X">X 계약 값입니다.</param>
/// <param name="Y">Y 계약 값입니다.</param>
public sealed record PointV5(double X, double Y);

/// <summary>RectV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="X">X 계약 값입니다.</param>
/// <param name="Y">Y 계약 값입니다.</param>
/// <param name="Width">Width 계약 값입니다.</param>
/// <param name="Height">Height 계약 값입니다.</param>
public sealed record RectV5(double X, double Y, double Width, double Height)
{
    /// <summary>Inflate 작업을 수행합니다.</summary>
    public RectV5 Inflate(double amount) => new(X - amount, Y - amount, Width + (amount * 2), Height + (amount * 2));
}

/// <summary>TerminalRefV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="DeviceId">DeviceId 계약 값입니다.</param>
/// <param name="TerminalId">TerminalId 계약 값입니다.</param>
public sealed record TerminalRefV5(string DeviceId, string TerminalId)
{
    /// <summary>Key 값을 제공합니다.</summary>
    public string Key => $"{DeviceId}:{TerminalId}";
}

/// <summary>TerminalDefinitionV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="Label">Label 계약 값입니다.</param>
/// <param name="Domain">Domain 계약 값입니다.</param>
/// <param name="Polarity">Polarity 계약 값입니다.</param>
/// <param name="Role">Role 계약 값입니다.</param>
/// <param name="OffsetX">OffsetX 계약 값입니다.</param>
/// <param name="OffsetY">OffsetY 계약 값입니다.</param>
/// <param name="MaxConductors">MaxConductors 계약 값입니다.</param>
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
    /// <summary>Aliases 값을 제공합니다.</summary>
    public string[] Aliases { get; init; } = [];

    /// <summary>Potential 값을 제공합니다.</summary>
    public TerminalPotential Potential { get; init; } = TerminalPotential.None;

    /// <summary>CommonType 값을 제공합니다.</summary>
    public TerminalCommonType? CommonType { get; init; }

    /// <summary>Phase 값을 제공합니다.</summary>
    public string? Phase { get; init; }

    /// <summary>CommonGroup 값을 제공합니다.</summary>
    public string? CommonGroup { get; init; }

    /// <summary>Channel 값을 제공합니다.</summary>
    public string? Channel { get; init; }

    /// <summary>Protocol 값을 제공합니다.</summary>
    public TerminalProtocol Protocol { get; init; } = TerminalProtocol.None;

    /// <summary>OutputMode 값을 제공합니다.</summary>
    public TerminalOutputMode OutputMode { get; init; } = TerminalOutputMode.None;

    /// <summary>InputLogicMode 값을 제공합니다.</summary>
    public TerminalInputLogicMode InputLogicMode { get; init; } = TerminalInputLogicMode.None;

    /// <summary>ActivationPotential 값을 제공합니다.</summary>
    public TerminalPotential ActivationPotential { get; init; } = TerminalPotential.None;

    /// <summary>MinimumVoltage 값을 제공합니다.</summary>
    public double? MinimumVoltage { get; init; }

    /// <summary>MaximumVoltage 값을 제공합니다.</summary>
    public double? MaximumVoltage { get; init; }

    /// <summary>MinimumConductorMm2 값을 제공합니다.</summary>
    public double? MinimumConductorMm2 { get; init; }

    /// <summary>MaximumConductorMm2 값을 제공합니다.</summary>
    public double? MaximumConductorMm2 { get; init; }

    /// <summary>HitRadius 값을 제공합니다.</summary>
    public double HitRadius { get; init; } = 12;

    /// <summary>LeadOutSide 값을 제공합니다.</summary>
    public string LeadOutSide { get; init; } = "auto";

    /// <summary>LeadOutDistance 값을 제공합니다.</summary>
    public double LeadOutDistance { get; init; } = 18;

    /// <summary>EvidenceReferences 값을 제공합니다.</summary>
    public string[] EvidenceReferences { get; init; } = [];
}

/// <summary>InternalLinkKind 값의 종류를 정의합니다.</summary>
public enum InternalLinkKind
{
    /// <summary>Conductive 상태를 나타냅니다.</summary>
    Conductive,
    /// <summary>DynamicContact 상태를 나타냅니다.</summary>
    DynamicContact,
    /// <summary>Fused 상태를 나타냅니다.</summary>
    Fused,
    /// <summary>PassThrough 상태를 나타냅니다.</summary>
    PassThrough,
}

/// <summary>InternalLinkV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="FromTerminalId">FromTerminalId 계약 값입니다.</param>
/// <param name="ToTerminalId">ToTerminalId 계약 값입니다.</param>
/// <param name="Kind">Kind 계약 값입니다.</param>
/// <param name="StateKey">StateKey 계약 값입니다.</param>
/// <param name="NormallyClosed">NormallyClosed 계약 값입니다.</param>
public sealed record InternalLinkV5(
    string FromTerminalId,
    string ToTerminalId,
    InternalLinkKind Kind,
    string? StateKey = null,
    bool NormallyClosed = false);

/// <summary>DeviceInstanceV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="ProfileId">ProfileId 계약 값입니다.</param>
/// <param name="ProfileVersion">ProfileVersion 계약 값입니다.</param>
/// <param name="EvidenceGrade">EvidenceGrade 계약 값입니다.</param>
/// <param name="Label">Label 계약 값입니다.</param>
/// <param name="X">X 계약 값입니다.</param>
/// <param name="Y">Y 계약 값입니다.</param>
/// <param name="Rotation">Rotation 계약 값입니다.</param>
/// <param name="Width">Width 계약 값입니다.</param>
/// <param name="Height">Height 계약 값입니다.</param>
/// <param name="Locked">Locked 계약 값입니다.</param>
/// <param name="UserProperties">UserProperties 계약 값입니다.</param>
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
    /// <summary>AssetVersion 값을 제공합니다.</summary>
    public string? AssetVersion { get; init; }

    /// <summary>ExactOrderCode 값을 제공합니다.</summary>
    public string? ExactOrderCode { get; init; }

    /// <summary>Designation 값을 제공합니다.</summary>
    public string? Designation { get; init; }

    /// <summary>CatalogEntryId 값을 제공합니다.</summary>
    public string? CatalogEntryId { get; init; }
}

/// <summary>두 실제 단자 사이의 한 가닥 전선과 그 편집 경로를 저장합니다.</summary>
/// <param name="Id">문서 안에서 바뀌지 않는 전선 ID입니다.</param>
/// <param name="Start">시작 단자 참조입니다.</param>
/// <param name="End">끝 단자 참조이며 시작 단자와 달라야 합니다.</param>
/// <param name="Waypoints">단자 끝점을 제외한 사용자 경로점입니다.</param>
/// <param name="Label">사용자가 정하는 표시명이며 실제 선번으로 사용하지 않습니다.</param>
/// <param name="Color">#RRGGBB 형식의 현재 표시 색상입니다.</param>
/// <param name="GaugeMm2">단자 허용 굵기 판정에 사용하는 단면적입니다.</param>
/// <param name="RouteLocked">true이면 저장된 내부 경로를 유지하고 끝단 lead-in/out만 다시 계산합니다.</param>
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
    /// <summary>검증과 보고서가 사용하는 실제 선번의 단일 원천입니다.</summary>
    public string WireNumber { get; init; } = Label;

    /// <summary>true이면 자동 전선색 재계산보다 사용자가 지정한 <see cref="Color"/>를 우선합니다.</summary>
    public bool ManualColor { get; init; }

    /// <summary>CableAssemblyId 값을 제공합니다.</summary>
    public string? CableAssemblyId { get; init; }

    /// <summary>Core 값을 제공합니다.</summary>
    public string? Core { get; init; }

    /// <summary>Gauge 값을 제공합니다.</summary>
    public string? Gauge { get; init; }

    /// <summary>Awg 값을 제공합니다.</summary>
    public string? Awg { get; init; }

    /// <summary>LengthMm 값을 제공합니다.</summary>
    public double? LengthMm { get; init; }

    /// <summary>PairId 값을 제공합니다.</summary>
    public string? PairId { get; init; }

    /// <summary>Shielded 값을 제공합니다.</summary>
    public bool Shielded { get; init; }

    /// <summary>Drain 값을 제공합니다.</summary>
    public bool Drain { get; init; }

    /// <summary>FerruleFrom 값을 제공합니다.</summary>
    public string? FerruleFrom { get; init; }

    /// <summary>FerruleTo 값을 제공합니다.</summary>
    public string? FerruleTo { get; init; }

    /// <summary>LugFrom 값을 제공합니다.</summary>
    public string? LugFrom { get; init; }

    /// <summary>LugTo 값을 제공합니다.</summary>
    public string? LugTo { get; init; }

    /// <summary>DiagnosticOverride 값을 제공합니다.</summary>
    public bool DiagnosticOverride { get; init; }
}

/// <summary>TerminalBridgeV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="Terminals">Terminals 계약 값입니다.</param>
/// <param name="Color">Color 계약 값입니다.</param>
public sealed record TerminalBridgeV5(
    string Id,
    TerminalRefV5[] Terminals,
    string Color);

/// <summary>SourceSystemDefinitionV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="Label">Label 계약 값입니다.</param>
/// <param name="Status">Status 계약 값입니다.</param>
/// <param name="Kind">Kind 계약 값입니다.</param>
/// <param name="NominalVoltage">NominalVoltage 계약 값입니다.</param>
/// <param name="Conductors">Conductors 계약 값입니다.</param>
/// <param name="EarthingPolicy">EarthingPolicy 계약 값입니다.</param>
public sealed record SourceSystemDefinitionV5(
    string? Id,
    string? Label,
    CompletenessStatus Status,
    SupplyKind Kind,
    double? NominalVoltage,
    string[] Conductors,
    EarthingPolicy EarthingPolicy);

/// <summary>PhysicalLayoutDefinitionV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Status">Status 계약 값입니다.</param>
/// <param name="SourceUnit">SourceUnit 계약 값입니다.</param>
/// <param name="CanvasUnitsPerMm">CanvasUnitsPerMm 계약 값입니다.</param>
public sealed record PhysicalLayoutDefinitionV5(
    CompletenessStatus Status,
    string SourceUnit,
    double? CanvasUnitsPerMm);

/// <summary>CableAssemblyV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="Designation">Designation 계약 값입니다.</param>
/// <param name="ConductorIds">ConductorIds 계약 값입니다.</param>
/// <param name="CableType">CableType 계약 값입니다.</param>
/// <param name="LengthMm">LengthMm 계약 값입니다.</param>
/// <param name="Shielded">Shielded 계약 값입니다.</param>
/// <param name="DrainConductorId">DrainConductorId 계약 값입니다.</param>
/// <param name="Route">Route 계약 값입니다.</param>
public sealed record CableAssemblyV5(
    string Id,
    string? Designation,
    string[] ConductorIds,
    string? CableType,
    double? LengthMm,
    bool Shielded,
    string? DrainConductorId,
    PointV5[] Route);

/// <summary>TerminalAssemblyV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="DeviceId">DeviceId 계약 값입니다.</param>
/// <param name="TerminalIds">TerminalIds 계약 값입니다.</param>
/// <param name="Manufacturer">Manufacturer 계약 값입니다.</param>
/// <param name="OrderCode">OrderCode 계약 값입니다.</param>
/// <param name="Designation">Designation 계약 값입니다.</param>
/// <param name="TerminalType">TerminalType 계약 값입니다.</param>
/// <param name="Marker">Marker 계약 값입니다.</param>
/// <param name="MaximumConductorsPerTerminal">MaximumConductorsPerTerminal 계약 값입니다.</param>
/// <param name="Accessories">Accessories 계약 값입니다.</param>
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

/// <summary>PanelElementKind 값의 종류를 정의합니다.</summary>
public enum PanelElementKind
{
    /// <summary>DinRail 상태를 나타냅니다.</summary>
    DinRail,
    /// <summary>WireDuct 상태를 나타냅니다.</summary>
    WireDuct,
    /// <summary>Door 상태를 나타냅니다.</summary>
    Door,
    /// <summary>Cabinet 상태를 나타냅니다.</summary>
    Cabinet,
    /// <summary>GroundBar 상태를 나타냅니다.</summary>
    GroundBar,
}

/// <summary>PanelElementV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="Kind">Kind 계약 값입니다.</param>
/// <param name="Bounds">Bounds 계약 값입니다.</param>
/// <param name="Rotation">Rotation 계약 값입니다.</param>
/// <param name="Locked">Locked 계약 값입니다.</param>
/// <param name="Properties">Properties 계약 값입니다.</param>
public sealed record PanelElementV5(
    string Id,
    PanelElementKind Kind,
    RectV5 Bounds,
    double Rotation,
    bool Locked,
    Dictionary<string, string> Properties);

/// <summary>ViewLayoutV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Positions">Positions 계약 값입니다.</param>
public sealed record ViewLayoutV5(Dictionary<string, PointV5> Positions);

/// <summary>SimulationScenarioV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="ContactStates">ContactStates 계약 값입니다.</param>
/// <param name="Properties">Properties 계약 값입니다.</param>
public sealed record SimulationScenarioV5(
    string Id,
    Dictionary<string, bool> ContactStates,
    Dictionary<string, string> Properties);

/// <summary>MissionStateV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="ScenarioId">ScenarioId 계약 값입니다.</param>
/// <param name="HintLevel">HintLevel 계약 값입니다.</param>
/// <param name="RoleBindings">RoleBindings 계약 값입니다.</param>
public sealed record MissionStateV5(
    string? ScenarioId,
    int HintLevel,
    Dictionary<string, string> RoleBindings);

/// <summary>PlcRuntimeBindingV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Id">Id 계약 값입니다.</param>
/// <param name="DeviceId">DeviceId 계약 값입니다.</param>
/// <param name="TerminalId">TerminalId 계약 값입니다.</param>
/// <param name="PlcAddress">PlcAddress 계약 값입니다.</param>
/// <param name="Direction">Direction 계약 값입니다.</param>
public sealed record PlcRuntimeBindingV5(
    string Id,
    string DeviceId,
    string TerminalId,
    string PlcAddress,
    string Direction);

/// <summary>PanelLayoutV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Width">Width 계약 값입니다.</param>
/// <param name="Height">Height 계약 값입니다.</param>
public sealed record PanelLayoutV5(double Width, double Height);

/// <summary>ViewportV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="Zoom">Zoom 계약 값입니다.</param>
/// <param name="OffsetX">OffsetX 계약 값입니다.</param>
/// <param name="OffsetY">OffsetY 계약 값입니다.</param>
public sealed record ViewportV5(double Zoom, double OffsetX, double OffsetY);

/// <summary>WorkshopSettingsV5 공개 문서 계약을 나타냅니다.</summary>
/// <param name="GridSize">GridSize 계약 값입니다.</param>
/// <param name="SnapToGrid">SnapToGrid 계약 값입니다.</param>
/// <param name="AutoWireColor">AutoWireColor 계약 값입니다.</param>
/// <param name="FaultInjectionEnabled">FaultInjectionEnabled 계약 값입니다.</param>
public sealed record WorkshopSettingsV5(
    double GridSize,
    bool SnapToGrid,
    bool AutoWireColor = true,
    bool FaultInjectionEnabled = false);

/// <summary>PLC Wiring Trainer 4.x의 무손실 네이티브 영속 문서 계약입니다.</summary>
/// <remarks>schemaVersion은 5로 유지하며 알 수 없는 최상위 필드와 legacy 확장 데이터는 왕복 저장에서 보존합니다.</remarks>
public sealed record WorkshopDocumentV5
{
    /// <summary>현재 문서 구조 버전이며 이 형식에서는 항상 5입니다.</summary>
    public int SchemaVersion { get; init; } = 5;

    /// <summary>자동복구 파일과 문서 세션을 연결하는 안정적인 문서 ID입니다.</summary>
    public required string DocumentId { get; init; }

    /// <summary>완료된 영속 편집 한 건마다 증가하며 탐색이나 작업공간 전환으로는 증가하지 않습니다.</summary>
    public required int Revision { get; init; }

    /// <summary>Name 값을 제공합니다.</summary>
    public required string Name { get; init; }

    /// <summary>패널에 배치된 장비 인스턴스입니다.</summary>
    public required DeviceInstanceV5[] Devices { get; init; }

    /// <summary>실제 두 단자를 잇는 전선입니다. 단순 화면 교차는 도통을 만들지 않습니다.</summary>
    public required ConductorV5[] Conductors { get; init; }

    /// <summary>둘 이상의 단자를 명시적으로 공통 도통시키는 점퍼입니다.</summary>
    public required TerminalBridgeV5[] TerminalBridges { get; init; }

    /// <summary>Panel 값을 제공합니다.</summary>
    public required PanelLayoutV5 Panel { get; init; }

    /// <summary>Viewport 값을 제공합니다.</summary>
    public required ViewportV5 Viewport { get; init; }

    /// <summary>Settings 값을 제공합니다.</summary>
    public required WorkshopSettingsV5 Settings { get; init; }

    /// <summary>Mode 값을 제공합니다.</summary>
    public WorkshopMode Mode { get; init; } = WorkshopMode.Practice;

    /// <summary>SourceSystem 값을 제공합니다.</summary>
    public SourceSystemDefinitionV5 SourceSystem { get; init; } = new(
        null,
        null,
        CompletenessStatus.Incomplete,
        SupplyKind.None,
        null,
        [],
        EarthingPolicy.Unspecified);

    /// <summary>PhysicalLayout 값을 제공합니다.</summary>
    public PhysicalLayoutDefinitionV5 PhysicalLayout { get; init; } = new(
        CompletenessStatus.Incomplete,
        "canvas-unit",
        null);

    /// <summary>conductor/core/shield/drain의 양방향 소속을 정의하는 케이블 묶음입니다.</summary>
    public CableAssemblyV5[] CableAssemblies { get; init; } = [];

    /// <summary>TerminalAssemblies 값을 제공합니다.</summary>
    public TerminalAssemblyV5[] TerminalAssemblies { get; init; } = [];

    /// <summary>PanelElements 값을 제공합니다.</summary>
    public PanelElementV5[] PanelElements { get; init; } = [];

    /// <summary>ViewLayouts 값을 제공합니다.</summary>
    public Dictionary<string, ViewLayoutV5> ViewLayouts { get; init; } = new(StringComparer.Ordinal);

    /// <summary>Scenarios 값을 제공합니다.</summary>
    public SimulationScenarioV5[] Scenarios { get; init; } = [];

    /// <summary>MissionState 값을 제공합니다.</summary>
    public MissionStateV5 MissionState { get; init; } = new(null, 0, new Dictionary<string, string>(StringComparer.Ordinal));

    /// <summary>PlcRuntimeBindings 값을 제공합니다.</summary>
    public PlcRuntimeBindingV5[] PlcRuntimeBindings { get; init; } = [];

    /// <summary>레거시 원문과 아직 네이티브 실행에 사용하지 않는 데이터를 손실 없이 보존합니다.</summary>
    public required Dictionary<string, JsonElement> Extensions { get; init; }

    /// <summary>이 필드 자체를 제외한 canonical 문서 내용의 SHA-256입니다.</summary>
    public string ContentHash { get; init; } = string.Empty;

    /// <summary>현재 코드가 모르는 최상위 JSON 필드를 재저장하기 위한 보존 영역입니다.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? UnknownFields { get; init; }
}
