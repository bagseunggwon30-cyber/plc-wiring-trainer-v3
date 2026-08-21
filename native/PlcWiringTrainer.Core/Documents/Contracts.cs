using System.Text.Json;
using System.Text.Json.Serialization;

namespace PlcWiringTrainer.Core.Documents;

public enum EvidenceGrade
{
    Educational,
    ManualVerified,
    BenchVerified,
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

public sealed record PointV4(double X, double Y);

public sealed record RectV4(double X, double Y, double Width, double Height)
{
    public RectV4 Inflate(double amount) => new(X - amount, Y - amount, Width + (amount * 2), Height + (amount * 2));
}

public sealed record TerminalRefV4(string DeviceId, string TerminalId)
{
    public string Key => $"{DeviceId}:{TerminalId}";
}

public sealed record TerminalDefinitionV4(
    string Id,
    string Label,
    TerminalDomain Domain,
    TerminalPolarity Polarity,
    TerminalRole Role,
    double OffsetX,
    double OffsetY,
    int MaxConductors = 1);

public sealed record DeviceInstanceV4(
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
    Dictionary<string, string> UserProperties);

public sealed record ConductorV4(
    string Id,
    TerminalRefV4 Start,
    TerminalRefV4 End,
    PointV4[] Waypoints,
    string Label,
    string Color,
    double GaugeMm2,
    bool RouteLocked);

public sealed record JumperV4(
    string Id,
    TerminalRefV4 Start,
    TerminalRefV4 End,
    string Color);

public sealed record PanelLayoutV4(double Width, double Height);

public sealed record ViewportV4(double Zoom, double OffsetX, double OffsetY);

public sealed record WorkshopSettingsV4(double GridSize, bool SnapToGrid);

/// <summary>PLC Wiring Trainer 4.0의 영속 문서 계약입니다.</summary>
public sealed record WorkshopDocumentV4
{
    public int SchemaVersion { get; init; } = 4;

    public required string DocumentId { get; init; }

    public required int Revision { get; init; }

    public required string Name { get; init; }

    public required DeviceInstanceV4[] Devices { get; init; }

    public required ConductorV4[] Conductors { get; init; }

    public required JumperV4[] Jumpers { get; init; }

    public required PanelLayoutV4 Panel { get; init; }

    public required ViewportV4 Viewport { get; init; }

    public required WorkshopSettingsV4 Settings { get; init; }

    public required Dictionary<string, JsonElement> Extensions { get; init; }

    public string ContentHash { get; init; } = string.Empty;

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? UnknownFields { get; init; }
}
