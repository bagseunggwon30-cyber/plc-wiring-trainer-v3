using System.Reflection;
using System.Text.Json;
using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Validation;

public enum DeviceProfileKind
{
    Generic,
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

public enum PaletteAvailabilityV5
{
    Ready,
    Preparation,
    Boundary,
    Hidden,
}

public enum ManualEvidenceStatusV5
{
    Unresolved,
    FamilyManual,
    ExactProduct,
}

public sealed record DeviceArtworkV5(
    string AssetPath,
    string SourcePath,
    string Sha256,
    RectV5? ImageBox,
    bool ImageHasLabels);

public sealed record ManualReferenceV5(
    string DocumentPath,
    string Sha256,
    string Pages,
    string SourceUrl);

public sealed record DeviceCatalogEntryV5(
    string LegacyType,
    string ProfileId,
    string? ElectricalProfileId,
    string Category,
    string DisplayName,
    string Description,
    double DefaultWidth,
    double DefaultHeight,
    PaletteAvailabilityV5 Availability,
    ManualEvidenceStatusV5 ManualEvidence,
    DeviceArtworkV5 Artwork);

public sealed record ElectricalProfileV5(
    string Id,
    int Version,
    EvidenceGrade EvidenceGrade,
    TerminalDefinitionV5[] Terminals,
    InternalLinkV5[] InternalLinks);

public sealed record DeviceProfileV5(
    string Id,
    int Version,
    string DisplayName,
    DeviceProfileKind Kind,
    EvidenceGrade EvidenceGrade,
    string AssetPath,
    TerminalDefinitionV5[] Terminals,
    bool IsPaletteVisible = true)
{
    public required string LegacyType { get; init; }

    public required string Category { get; init; }

    public string Description { get; init; } = string.Empty;

    public double DefaultWidth { get; init; } = 150;

    public double DefaultHeight { get; init; } = 100;

    public PaletteAvailabilityV5 Availability { get; init; } = PaletteAvailabilityV5.Ready;

    public ManualEvidenceStatusV5 ManualEvidence { get; init; }

    public string Manufacturer { get; init; } = string.Empty;

    public string PartNumber { get; init; } = string.Empty;

    public ManualReferenceV5[] ManualReferences { get; init; } = [];

    public required DeviceArtworkV5 Artwork { get; init; }

    public InternalLinkV5[] InternalLinks { get; init; } = [];
}

public sealed class DeviceProfileCatalog
{
    private readonly Dictionary<string, DeviceProfileV5> _profiles;
    private readonly Dictionary<string, DeviceProfileV5> _compatibilityAliases;

    public DeviceProfileCatalog(IEnumerable<DeviceProfileV5> profiles)
        : this(profiles, [])
    {
    }

    private DeviceProfileCatalog(
        IEnumerable<DeviceProfileV5> profiles,
        IEnumerable<KeyValuePair<string, DeviceProfileV5>> compatibilityAliases)
    {
        ArgumentNullException.ThrowIfNull(profiles);
        _profiles = profiles.ToDictionary(profile => profile.Id, StringComparer.Ordinal);
        _compatibilityAliases = compatibilityAliases.ToDictionary(StringComparer.Ordinal);
    }

    public IReadOnlyCollection<DeviceProfileV5> Profiles => _profiles.Values;

    public IReadOnlyCollection<DeviceProfileV5> ResolvableProfiles => _profiles.Values
        .Concat(_compatibilityAliases.Values)
        .DistinctBy(profile => profile.Id)
        .ToArray();

    public bool TryGet(string profileId, out DeviceProfileV5 profile)
        => _profiles.TryGetValue(profileId, out profile!)
            || _compatibilityAliases.TryGetValue(profileId, out profile!);

    public static DeviceProfileCatalog CreateDefault()
    {
        LegacyCatalogFile manifest = LegacyCatalogReader.Load();
        DeviceProfileV5[] profiles = manifest.Entries.Select(LegacyCatalogReader.ToProfile).ToArray();
        ValidateMeasuredCounts(manifest, profiles);
        return new DeviceProfileCatalog(
            profiles,
            new Dictionary<string, DeviceProfileV5>(StringComparer.Ordinal)
            {
                ["dc-supply-24v"] = CreateCompatibilityDcSupply(),
                ["plc-input-24v"] = CreateCompatibilityPlcInput(),
                ["ac-source-220v"] = CreateCompatibilityAcSource(),
                ["ac-load-220v"] = CreateCompatibilityAcLoad(),
                ["transmitter-2wire-4-20ma"] = CreateCompatibilityTwoWireTransmitter(),
                ["analog-input-4-20ma"] = CreateCompatibilityAnalogInput(),
            });
    }

    private static void ValidateMeasuredCounts(LegacyCatalogFile manifest, DeviceProfileV5[] profiles)
    {
        DeviceProfileV5[] ready = profiles.Where(profile => profile.IsPaletteVisible).ToArray();
        if (profiles.Length != manifest.MeasuredCounts.ClassifiedDevices
            || ready.Length != manifest.MeasuredCounts.ReadyPaletteDevices
            || ready.Sum(profile => profile.Terminals.Length) != manifest.MeasuredCounts.ReadyPaletteTerminals
            || ready.Select(profile => profile.AssetPath).Distinct(StringComparer.Ordinal).Count()
                != manifest.MeasuredCounts.ReadyPaletteUniqueImages
            || profiles.Count(profile => profile.ManualEvidence == ManualEvidenceStatusV5.ExactProduct)
                != manifest.MeasuredCounts.ManualVerifiedProfiles)
        {
            throw new InvalidDataException("레거시 카탈로그의 측정 불변조건이 손상되었습니다.");
        }
    }

    private static DeviceProfileV5 CreateCompatibilityDcSupply()
        => CompatibilityProfile(
            "dc-supply-24v",
            "DC 24 V 전원",
            DeviceProfileKind.DcPowerSupply,
            "Assets/Devices/dc-supply-24v.svg",
            [
                Terminal("+24V", "+24V", TerminalDomain.DcPower, TerminalPolarity.Positive, TerminalRole.DcSourcePositive, 120, 24, 8),
                Terminal("0V", "0V", TerminalDomain.DcPower, TerminalPolarity.Negative, TerminalRole.DcSourceReturn, 120, 58, 8),
            ]);

    private static DeviceProfileV5 CreateCompatibilityAcSource()
        => CompatibilityProfile(
            "ac-source-220v",
            "AC 220 V 전원",
            DeviceProfileKind.AcPowerSupply,
            string.Empty,
            [
                Terminal("L", "전원 L", TerminalDomain.AcPower, TerminalPolarity.Line, TerminalRole.AcSourceLine, 120, 18),
                Terminal("N", "전원 N", TerminalDomain.AcPower, TerminalPolarity.Neutral, TerminalRole.AcSourceNeutral, 120, 42),
                Terminal("PE", "보호 접지", TerminalDomain.ProtectiveEarth, TerminalPolarity.ProtectiveEarth, TerminalRole.ProtectiveEarth, 120, 66),
            ]);

    private static DeviceProfileV5 CreateCompatibilityAcLoad()
        => CompatibilityProfile(
            "ac-load-220v",
            "AC 부하",
            DeviceProfileKind.AcLoad,
            string.Empty,
            [
                Terminal("L", "부하 L", TerminalDomain.AcPower, TerminalPolarity.Line, TerminalRole.AcLoadLine, 0, 18),
                Terminal("N", "부하 N", TerminalDomain.AcPower, TerminalPolarity.Neutral, TerminalRole.AcLoadNeutral, 0, 42),
                Terminal("PE", "보호 접지", TerminalDomain.ProtectiveEarth, TerminalPolarity.ProtectiveEarth, TerminalRole.ProtectiveEarth, 0, 66),
            ]);

    private static DeviceProfileV5 CreateCompatibilityTwoWireTransmitter()
        => CompatibilityProfile(
            "transmitter-2wire-4-20ma",
            "2선식 4-20 mA 전송기",
            DeviceProfileKind.TwoWireTransmitter,
            string.Empty,
            [
                Terminal("+", "Loop +", TerminalDomain.AnalogOutput, TerminalPolarity.Positive, TerminalRole.LoopTransmitterPositive, 0, 24),
                Terminal("-", "Loop -", TerminalDomain.AnalogOutput, TerminalPolarity.Negative, TerminalRole.LoopTransmitterNegative, 0, 58),
            ]);

    private static DeviceProfileV5 CreateCompatibilityAnalogInput()
        => CompatibilityProfile(
            "analog-input-4-20ma",
            "4-20 mA 아날로그 입력",
            DeviceProfileKind.AnalogInput,
            string.Empty,
            [
                Terminal("I+", "전류 입력 +", TerminalDomain.AnalogInput, TerminalPolarity.Positive, TerminalRole.AnalogInputPositive, 0, 24),
                Terminal("I-", "전류 입력 -", TerminalDomain.AnalogInput, TerminalPolarity.Negative, TerminalRole.AnalogInputNegative, 0, 58),
            ]);

    private static DeviceProfileV5 CreateCompatibilityPlcInput()
        => CompatibilityProfile(
            "plc-input-24v",
            "PLC DC 입력",
            DeviceProfileKind.PlcDigitalInput,
            "Assets/Devices/plc-input-24v.svg",
            [
                Terminal("I0", "입력 I0", TerminalDomain.DigitalInput, TerminalPolarity.Signal, TerminalRole.PlcInput, 0, 24),
                Terminal("COM", "입력 공통 COM", TerminalDomain.DigitalInput, TerminalPolarity.Common, TerminalRole.PlcInputCommon, 0, 58),
            ]);

    private static DeviceProfileV5 CompatibilityProfile(
        string id,
        string displayName,
        DeviceProfileKind kind,
        string assetPath,
        TerminalDefinitionV5[] terminals)
        => new(id, 1, displayName, kind, EvidenceGrade.Educational, assetPath, terminals, false)
        {
            LegacyType = id,
            Category = "compatibility",
            DefaultWidth = 120,
            DefaultHeight = 80,
            Availability = PaletteAvailabilityV5.Hidden,
            Artwork = new DeviceArtworkV5(assetPath, string.Empty, string.Empty, null, false),
        };

    private static TerminalDefinitionV5 Terminal(
        string id,
        string label,
        TerminalDomain domain,
        TerminalPolarity polarity,
        TerminalRole role,
        double x,
        double y,
        int maxConductors = 1)
        => new(id, label, domain, polarity, role, x, y, maxConductors)
        {
            Potential = role switch
            {
                TerminalRole.DcSourcePositive or TerminalRole.SupplyPositive => TerminalPotential.Positive24V,
                TerminalRole.DcSourceReturn or TerminalRole.SupplyReturn => TerminalPotential.ZeroVolt,
                TerminalRole.AcSourceLine or TerminalRole.AcLoadLine => TerminalPotential.Line1,
                TerminalRole.AcSourceNeutral or TerminalRole.AcLoadNeutral => TerminalPotential.Neutral,
                TerminalRole.ProtectiveEarth => TerminalPotential.ProtectiveEarth,
                _ => TerminalPotential.None,
            },
        };
}

internal static class LegacyCatalogReader
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNameCaseInsensitive = true };

    public static LegacyCatalogFile Load()
    {
        Assembly assembly = typeof(LegacyCatalogReader).Assembly;
        string resourceName = assembly.GetManifestResourceNames().Single(name =>
            name.EndsWith("legacy-device-catalog.v5.json", StringComparison.Ordinal));
        using Stream stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidDataException("내장 레거시 카탈로그를 열 수 없습니다.");
        LegacyCatalogFile? manifest = JsonSerializer.Deserialize<LegacyCatalogFile>(stream, Options);
        return manifest is { SchemaVersion: 5 }
            ? manifest
            : throw new InvalidDataException("레거시 카탈로그 스키마가 올바르지 않습니다.");
    }

    public static DeviceProfileV5 ToProfile(LegacyCatalogEntry entry)
    {
        PaletteAvailabilityV5 availability = ParseAvailability(entry.Availability);
        ManualEvidenceStatusV5 manualEvidence = ParseManualEvidence(entry.ManualEvidence);
        EvidenceGrade evidenceGrade = manualEvidence == ManualEvidenceStatusV5.ExactProduct
            ? EvidenceGrade.ManualVerified
            : EvidenceGrade.Educational;
        TerminalDefinitionV5[] terminals = entry.Terminals.Select(terminal => ToTerminal(entry.LegacyType, terminal)).ToArray();
        if (entry.LegacyType is "LAMP-G" or "LAMP-Y" or "LAMP-W")
        {
            terminals =
            [
                new("A1", "A1 (+)", TerminalDomain.DcPower, TerminalPolarity.Positive, TerminalRole.LampPositive, 0, 22),
                new("A2", "A2 (-)", TerminalDomain.DcPower, TerminalPolarity.Negative, TerminalRole.LampReturn, 0, 58),
            ];
        }

        DeviceArtworkV5 artwork = new(
            entry.Artwork.AssetPath,
            entry.Artwork.SourcePath,
            entry.Artwork.Sha256,
            entry.Artwork.ImageBox is null
                ? null
                : new RectV5(entry.Artwork.ImageBox.X, entry.Artwork.ImageBox.Y, entry.Artwork.ImageBox.W, entry.Artwork.ImageBox.H),
            entry.Artwork.ImageHasLabels);
        int version = entry.LegacyType is "PROX-NPN" or "PROX-PNP" ? 2 : 1;
        return new DeviceProfileV5(
            entry.ProfileId,
            version,
            entry.DisplayName,
            ParseKind(entry),
            evidenceGrade,
            entry.Artwork.AssetPath,
            terminals,
            availability == PaletteAvailabilityV5.Ready)
        {
            LegacyType = entry.LegacyType,
            Category = entry.Category,
            Description = entry.Description,
            DefaultWidth = entry.DefaultWidth,
            DefaultHeight = entry.DefaultHeight,
            Availability = availability,
            ManualEvidence = manualEvidence,
            Manufacturer = entry.Manufacturer,
            PartNumber = entry.PartNumber,
            ManualReferences = entry.ManualReferences
                .Select(reference => new ManualReferenceV5(
                    reference.DocumentPath,
                    reference.Sha256,
                    reference.Pages,
                    reference.SourceUrl))
                .ToArray(),
            Artwork = artwork,
            InternalLinks = entry.InternalLinks.Select(ToInternalLink).ToArray(),
        };
    }

    private static DeviceProfileKind ParseKind(LegacyCatalogEntry entry)
        => entry.LegacyType switch
        {
            "LAMP-G" or "LAMP-Y" or "LAMP-W" or "LAMP" => DeviceProfileKind.Lamp,
            "PROX-NPN" => DeviceProfileKind.NpnProximitySensor,
            "PROX-PNP" => DeviceProfileKind.PnpProximitySensor,
            "MDR-100" or "PSU24" => DeviceProfileKind.DcPowerSupply,
            "PRESSURE-TX-420" => DeviceProfileKind.TwoWireTransmitter,
            _ when entry.Category == "plc" => DeviceProfileKind.PlcDigitalInput,
            _ => DeviceProfileKind.Generic,
        };

    private static TerminalDefinitionV5 ToTerminal(string legacyType, LegacyTerminal terminal)
    {
        TerminalOutputMode outputMode = ParseOutputMode(terminal.OutputMode);
        var definition = new TerminalDefinitionV5(
            terminal.Id,
            terminal.Label,
            ParseDomain(terminal.Domain),
            ParsePolarity(terminal.Polarity, terminal.PolarityCode),
            ParseRole(legacyType, terminal, outputMode),
            terminal.X,
            terminal.Y,
            terminal.MaxConductors.GetValueOrDefault(1))
        {
            Aliases = terminal.Aliases,
            Potential = ParsePotential(terminal.Potential),
            CommonType = ParseCommonType(terminal.CommonType),
            Phase = terminal.Phase,
            CommonGroup = terminal.CommonGroup,
            Channel = terminal.Channel,
            Protocol = ParseProtocol(terminal.Protocol),
            OutputMode = outputMode,
            InputLogicMode = ParseInputLogic(terminal.InputLogicMode),
            ActivationPotential = ParsePotential(terminal.ActivationPotential),
            MinimumVoltage = terminal.RatedVoltage?.Min,
            MaximumVoltage = terminal.RatedVoltage?.Max,
            MinimumConductorMm2 = terminal.MinConductorMm2,
            MaximumConductorMm2 = terminal.MaxConductorMm2,
            HitRadius = terminal.HitRadius.GetValueOrDefault(12),
            LeadOutSide = terminal.LeadOutSide ?? terminal.Side ?? "auto",
            LeadOutDistance = terminal.LeadOutDistance.GetValueOrDefault(18),
        };
        return ApplyExactLsModuleSemantics(legacyType, definition);
    }

    private static TerminalDefinitionV5 ApplyExactLsModuleSemantics(
        string legacyType,
        TerminalDefinitionV5 terminal)
    {
        bool analogInput = legacyType is "XBF-AD04A" or "XBF-AD08A" or "XBF-RD04A" or "XBF-TC04S";
        bool analogOutput = legacyType is "XBF-DV04A" or "XBF-DC04A";
        if (!analogInput && !analogOutput)
        {
            return terminal;
        }

        if (terminal.Id == "+24V")
        {
            return terminal with
            {
                Domain = TerminalDomain.DcPower,
                Polarity = TerminalPolarity.Positive,
                Role = TerminalRole.SupplyPositive,
                Potential = TerminalPotential.Positive24V,
            };
        }

        if (terminal.Id == "0V")
        {
            return terminal with
            {
                Domain = TerminalDomain.DcPower,
                Polarity = TerminalPolarity.Negative,
                Role = TerminalRole.SupplyReturn,
                Potential = TerminalPotential.ZeroVolt,
            };
        }

        if (terminal.Id == "PE")
        {
            return terminal with
            {
                Domain = TerminalDomain.ProtectiveEarth,
                Polarity = TerminalPolarity.ProtectiveEarth,
                Role = TerminalRole.ProtectiveEarth,
                Potential = TerminalPotential.ProtectiveEarth,
            };
        }

        if (!terminal.Id.StartsWith("CH", StringComparison.Ordinal) || terminal.Id.Length < 4)
        {
            return terminal with { Domain = TerminalDomain.Floating };
        }

        bool positive = terminal.Id.EndsWith('+')
            || (legacyType == "XBF-RD04A" && terminal.Id.EndsWith('A'));
        return terminal with
        {
            Domain = analogInput ? TerminalDomain.AnalogInput : TerminalDomain.AnalogOutput,
            Polarity = positive ? TerminalPolarity.Positive : TerminalPolarity.Negative,
            Role = analogInput
                ? positive ? TerminalRole.AnalogInputPositive : TerminalRole.AnalogInputNegative
                : TerminalRole.Passive,
            Potential = TerminalPotential.Signal,
            Channel = terminal.Id[..3],
        };
    }

    private static TerminalRole ParseRole(string legacyType, LegacyTerminal terminal, TerminalOutputMode outputMode)
    {
        if (legacyType == "PROX-NPN" && outputMode == TerminalOutputMode.SinkingTransistor)
        {
            return TerminalRole.NpnSinkOutput;
        }

        if (legacyType == "PROX-PNP" && outputMode == TerminalOutputMode.SourcingTransistor)
        {
            return TerminalRole.PnpSourceOutput;
        }

        return (terminal.Role?.ToLowerInvariant(), terminal.Potential?.ToUpperInvariant()) switch
        {
            ("source", "+24V") => TerminalRole.DcSourcePositive,
            ("source", "0V") => TerminalRole.DcSourceReturn,
            ("supply-input", "+24V") => TerminalRole.SupplyPositive,
            ("supply-input", "0V") => TerminalRole.SupplyReturn,
            ("protective-earth", _) => TerminalRole.ProtectiveEarth,
            ("input", _) when IsPlc(legacyType) => TerminalRole.PlcInput,
            ("common", _) when IsPlc(legacyType) => TerminalRole.PlcInputCommon,
            _ => TerminalRole.Passive,
        };
    }

    private static bool IsPlc(string legacyType)
        => legacyType.StartsWith("XBC-", StringComparison.Ordinal)
            || legacyType.StartsWith("XBE-", StringComparison.Ordinal);

    private static InternalLinkV5 ToInternalLink(LegacyInternalLink link)
        => new(
            link.From,
            link.To,
            link.Kind switch
            {
                "dynamic-contact" => InternalLinkKind.DynamicContact,
                "fused" => InternalLinkKind.Fused,
                "pass-through" => InternalLinkKind.PassThrough,
                _ => InternalLinkKind.Conductive,
            },
            link.StateKey,
            link.NormallyClosed);

    private static PaletteAvailabilityV5 ParseAvailability(string value)
        => value switch
        {
            "ready" => PaletteAvailabilityV5.Ready,
            "preparation" => PaletteAvailabilityV5.Preparation,
            "boundary" => PaletteAvailabilityV5.Boundary,
            _ => PaletteAvailabilityV5.Hidden,
        };

    private static ManualEvidenceStatusV5 ParseManualEvidence(string value)
        => value switch
        {
            "exact" => ManualEvidenceStatusV5.ExactProduct,
            "family" => ManualEvidenceStatusV5.FamilyManual,
            _ => ManualEvidenceStatusV5.Unresolved,
        };

    private static TerminalDomain ParseDomain(string? value)
        => value?.ToLowerInvariant() switch
        {
            "dc" => TerminalDomain.DcPower,
            "ac" => TerminalDomain.AcPower,
            "pe" => TerminalDomain.ProtectiveEarth,
            "digital-input" => TerminalDomain.DigitalInput,
            "digital-output" => TerminalDomain.DigitalOutput,
            "analog-input" => TerminalDomain.AnalogInput,
            "analog-output" => TerminalDomain.AnalogOutput,
            "contact" => TerminalDomain.Contact,
            "communication" => TerminalDomain.Communication,
            "floating" => TerminalDomain.Floating,
            _ => TerminalDomain.Signal,
        };

    private static TerminalPotential ParsePotential(string? value)
        => value?.ToUpperInvariant() switch
        {
            "L1" => TerminalPotential.Line1,
            "L2" => TerminalPotential.Line2,
            "L3" => TerminalPotential.Line3,
            "N" => TerminalPotential.Neutral,
            "+24V" => TerminalPotential.Positive24V,
            "0V" => TerminalPotential.ZeroVolt,
            "PE" => TerminalPotential.ProtectiveEarth,
            "SIGNAL" => TerminalPotential.Signal,
            "FLOATING" => TerminalPotential.Floating,
            _ => TerminalPotential.None,
        };

    private static TerminalPolarity ParsePolarity(string? value, string? code)
        => (value ?? code)?.ToLowerInvariant() switch
        {
            "positive" or "dc+" or "signal-positive" => TerminalPolarity.Positive,
            "negative" or "return" or "dc-" or "signal-return" => TerminalPolarity.Negative,
            "line" or "ac-l" => TerminalPolarity.Line,
            "neutral" or "ac-n" => TerminalPolarity.Neutral,
            "protective-earth" or "pe" => TerminalPolarity.ProtectiveEarth,
            "signal" or "data-positive" or "data-negative" => TerminalPolarity.Signal,
            "common" or "reference" or "configurable" => TerminalPolarity.Common,
            _ => TerminalPolarity.None,
        };

    private static TerminalCommonType? ParseCommonType(string? value)
        => value?.ToLowerInvariant() switch
        {
            "configurable-dc" => TerminalCommonType.ConfigurableDc,
            "dc-control-common" => TerminalCommonType.DcControlCommon,
            "dc-output-common" => TerminalCommonType.DcOutputCommon,
            "dry-contact" => TerminalCommonType.DryContact,
            "analog-reference" => TerminalCommonType.AnalogReference,
            "communication-reference" => TerminalCommonType.CommunicationReference,
            "power-pass-through" => TerminalCommonType.PowerPassThrough,
            "fused-power" => TerminalCommonType.FusedPower,
            _ => null,
        };

    private static TerminalProtocol ParseProtocol(string? value)
        => value?.ToUpperInvariant() switch
        {
            "RS232" => TerminalProtocol.Rs232,
            "RS485" => TerminalProtocol.Rs485,
            "ANALOG-VOLTAGE" => TerminalProtocol.AnalogVoltage,
            "ANALOG-CURRENT" => TerminalProtocol.AnalogCurrent,
            "PULSE-DIRECTION" => TerminalProtocol.PulseDirection,
            "ENCODER" => TerminalProtocol.Encoder,
            _ => TerminalProtocol.None,
        };

    private static TerminalOutputMode ParseOutputMode(string? value)
        => value?.ToLowerInvariant() switch
        {
            "relay" => TerminalOutputMode.Relay,
            "sinking-transistor" => TerminalOutputMode.SinkingTransistor,
            "sourcing-transistor" => TerminalOutputMode.SourcingTransistor,
            _ => TerminalOutputMode.None,
        };

    private static TerminalInputLogicMode ParseInputLogic(string? value)
        => value?.ToLowerInvariant() switch
        {
            "configurable" => TerminalInputLogicMode.Configurable,
            "npn-internal-24v" => TerminalInputLogicMode.NpnInternal24V,
            "pnp-external-24v" => TerminalInputLogicMode.PnpExternal24V,
            _ => TerminalInputLogicMode.None,
        };
}

internal sealed class LegacyCatalogFile
{
    public int SchemaVersion { get; set; }
    public required LegacyMeasuredCounts MeasuredCounts { get; set; }
    public required LegacyCatalogEntry[] Entries { get; set; }
}

internal sealed class LegacyMeasuredCounts
{
    public int ClassifiedDevices { get; set; }
    public int ReadyPaletteDevices { get; set; }
    public int ReadyPaletteTerminals { get; set; }
    public int ReadyPaletteUniqueImages { get; set; }
    public int ManualVerifiedProfiles { get; set; }
}

internal sealed class LegacyCatalogEntry
{
    public required string LegacyType { get; set; }
    public required string ProfileId { get; set; }
    public string? ElectricalProfileId { get; set; }
    public required string Category { get; set; }
    public required string DisplayName { get; set; }
    public required string Description { get; set; }
    public double DefaultWidth { get; set; }
    public double DefaultHeight { get; set; }
    public required string Availability { get; set; }
    public required string ManualEvidence { get; set; }
    public string Manufacturer { get; set; } = string.Empty;
    public string PartNumber { get; set; } = string.Empty;
    public LegacyManualReference[] ManualReferences { get; set; } = [];
    public required LegacyArtwork Artwork { get; set; }
    public required LegacyTerminal[] Terminals { get; set; }
    public required LegacyInternalLink[] InternalLinks { get; set; }
}

internal sealed class LegacyManualReference
{
    public required string DocumentPath { get; set; }
    public required string Sha256 { get; set; }
    public string Pages { get; set; } = string.Empty;
    public string SourceUrl { get; set; } = string.Empty;
}

internal sealed class LegacyArtwork
{
    public string AssetPath { get; set; } = string.Empty;
    public string SourcePath { get; set; } = string.Empty;
    public string Sha256 { get; set; } = string.Empty;
    public LegacyImageBox? ImageBox { get; set; }
    public bool ImageHasLabels { get; set; }
}

internal sealed class LegacyImageBox
{
    public double X { get; set; }
    public double Y { get; set; }
    public double W { get; set; }
    public double H { get; set; }
}

internal sealed class LegacyTerminal
{
    public required string Id { get; set; }
    public required string Label { get; set; }
    public string[] Aliases { get; set; } = [];
    public double X { get; set; }
    public double Y { get; set; }
    public string? Side { get; set; }
    public string? PolarityCode { get; set; }
    public string? Domain { get; set; }
    public string? Potential { get; set; }
    public string? Role { get; set; }
    public string? Polarity { get; set; }
    public string? CommonType { get; set; }
    public string? Phase { get; set; }
    public string? CommonGroup { get; set; }
    public string? Channel { get; set; }
    public string? Protocol { get; set; }
    public string? OutputMode { get; set; }
    public string? InputLogicMode { get; set; }
    public string? ActivationPotential { get; set; }
    public LegacyVoltageRange? RatedVoltage { get; set; }
    public int? MaxConductors { get; set; }
    public double? MinConductorMm2 { get; set; }
    public double? MaxConductorMm2 { get; set; }
    public double? HitRadius { get; set; }
    public string? LeadOutSide { get; set; }
    public double? LeadOutDistance { get; set; }
}

internal sealed class LegacyVoltageRange
{
    public double? Min { get; set; }
    public double? Max { get; set; }
}

internal sealed class LegacyInternalLink
{
    public required string From { get; set; }
    public required string To { get; set; }
    public required string Kind { get; set; }
    public string? StateKey { get; set; }
    public bool NormallyClosed { get; set; }
}
