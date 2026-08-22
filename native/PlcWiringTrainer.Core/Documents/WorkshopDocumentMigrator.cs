using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Wiring;

namespace PlcWiringTrainer.Core.Documents;

/// <summary>MigrationStatus 값의 종류를 정의합니다.</summary>
public enum MigrationStatus
{
    /// <summary>AlreadyV5 상태를 나타냅니다.</summary>
    AlreadyV5,
    /// <summary>Converted 상태를 나타냅니다.</summary>
    Converted,
    /// <summary>Quarantined 상태를 나타냅니다.</summary>
    Quarantined,
}

/// <summary>MigrationResult 공개 계약을 나타냅니다.</summary>
/// <param name="Status">Status 계약 값입니다.</param>
/// <param name="Document">Document 계약 값입니다.</param>
/// <param name="BackupPath">BackupPath 계약 값입니다.</param>
/// <param name="QuarantinePath">QuarantinePath 계약 값입니다.</param>
/// <param name="Error">Error 계약 값입니다.</param>
public sealed record MigrationResult(
    MigrationStatus Status,
    WorkshopDocumentV5? Document,
    string BackupPath,
    string QuarantinePath,
    string Error);

/// <summary>레거시 구조를 감지하고 원문 백업과 손실 방지 검사를 거쳐 schema v5로 변환합니다.</summary>
public interface IWorkshopDocumentMigrator
{
    /// <summary>입력 파일을 변환하거나 원문을 격리하고 그 증거 경로를 반환합니다.</summary>
    Task<MigrationResult> MigrateAsync(string sourcePath, CancellationToken cancellationToken = default);
}

/// <summary>compact, V3, flat 및 기존 v4/v5 문서를 무손실 v5 문서로 이식합니다.</summary>
public sealed class WorkshopDocumentMigrator : IWorkshopDocumentMigrator
{
    private static readonly Lazy<IReadOnlyDictionary<string, string>> CatalogProfileAliases = new(
        () => DeviceProfileCatalog.CreateDefault().Profiles.ToDictionary(
            profile => profile.LegacyType,
            profile => profile.Id,
            StringComparer.OrdinalIgnoreCase));

    private static readonly Dictionary<string, string> LegacyProfileAliases =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["MCCB"] = "educational:mccb-3p",
            ["MCCB1P"] = "educational:mccb-2p",
            ["XBC-DN32UP"] = "ls-electric:xbc-dn32up",
            ["XBC-DN60SU"] = "ls-electric:xbc-dn60su",
            ["XBC-DP32UP"] = "ls-electric:xbc-dp32up",
            ["XBC-DN32H"] = "ls-electric:xbc-dn32h",
            ["XBC-DR32H"] = "ls-electric:xbc-dr32h",
            ["EXP2-700"] = "ls-electric:exp2-0700d",
            ["XBL-C41A"] = "ls-electric:xbl-c41a",
            ["XBF-AH04A"] = "ls-electric:xbf-ah04a",
            ["XBF-PD02A"] = "ls-electric:xbf-pd02a",
            ["MDR-100"] = "mean-well:mdr-100-24",
            ["MC-22B-DC24"] = "ls-electric:mc-22b-dc24-1a1b",
            ["EOCR3DE-05DUH"] = "schneider:eocr3de-05duh",
            ["IG5A"] = "ls-electric:sv-ig5a",
            ["MY-MD02"] = "generic:xy-md02",
            ["PROX-NPN"] = "prox-npn-v2",
            ["PROX-PNP"] = "prox-pnp-v2",
            ["PSU24"] = "dc-supply-24v",
            ["MOTOR-3P"] = "educational:three-phase-motor",
            ["LAMP-G"] = "lamp-green-v1",
            ["LAMP-Y"] = "lamp-yellow-v1",
            ["LAMP-W"] = "lamp-white-v1",
            ["LAMP"] = "lamp-white-v1",
            ["BUZZER"] = "educational:dc24-load",
            ["PB-1C"] = "educational:pushbutton-1c",
            ["EMSTOP"] = "educational:emergency-stop-nc2",
            ["SOL-Y"] = "educational:dc24-solenoid",
            ["TB4"] = "educational:terminal-block-4",
            ["TB10"] = "educational:terminal-block-10",
            ["TB-24V-10"] = "educational:distribution-24v-10",
            ["TB-0V-10"] = "educational:distribution-0v-10",
            ["TB-PE-10"] = "educational:distribution-pe-10",
            ["BOUNDARY-AC"] = "boundary:ac-supply",
            ["BOUNDARY-DC"] = "boundary:dc-supply",
            ["BOUNDARY-CONTACT"] = "boundary:dry-contact",
            ["BOUNDARY-LOAD"] = "boundary:load",
            ["BOUNDARY-ANALOG-V"] = "boundary:analog-voltage-source",
            ["BOUNDARY-ANALOG-I"] = "boundary:analog-current-source",
            ["BOUNDARY-ANALOG-V-IN"] = "boundary:analog-voltage-input",
            ["BOUNDARY-ANALOG-I-IN"] = "boundary:analog-current-input",
            ["BOUNDARY-2W-I"] = "boundary:two-wire-current-transmitter",
            ["BOUNDARY-RS485"] = "boundary:communication-peer",
        };

    private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> LegacyTerminalAliases =
        TerminalAliasRegistry.ByLegacyType;

    private readonly string _backupDirectory;
    private readonly string _quarantineDirectory;

    /// <summary>WorkshopDocumentMigrator 작업을 수행합니다.</summary>
    public WorkshopDocumentMigrator(string backupDirectory, string quarantineDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(backupDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(quarantineDirectory);
        _backupDirectory = Path.GetFullPath(backupDirectory);
        _quarantineDirectory = Path.GetFullPath(quarantineDirectory);
    }

    /// <summary>MigrateAsync 작업을 수행합니다.</summary>
    public async Task<MigrationResult> MigrateAsync(
        string sourcePath,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sourcePath);
        string fullSourcePath = Path.GetFullPath(sourcePath);
        string raw = await File.ReadAllTextAsync(fullSourcePath, Encoding.UTF8, cancellationToken).ConfigureAwait(false);
        string backupPath = await BackupAsync(fullSourcePath, raw, cancellationToken).ConfigureAwait(false);

        try
        {
            using JsonDocument parsed = JsonDocument.Parse(raw);
            JsonElement root = parsed.RootElement;
            WorkshopFormat format = DetectFormat(root);
            if (format == WorkshopFormat.NativeV5)
            {
                WorkshopDocumentV5 current = WorkshopDocumentSerializer.Deserialize(raw, verifyHash: true);
                return new MigrationResult(MigrationStatus.AlreadyV5, current, backupPath, string.Empty, string.Empty);
            }

            if (format == WorkshopFormat.NativeV3 && IsCompleteV3(root))
            {
                ValidateLegacyV3Hash(root);
            }

            WorkshopDocumentV5 converted = ConvertLegacy(
                root,
                raw,
                format,
                Path.GetFileNameWithoutExtension(fullSourcePath));
            ValidateNoSilentLoss(root, format, converted);
            return new MigrationResult(MigrationStatus.Converted, converted, backupPath, string.Empty, string.Empty);
        }
        catch (Exception exception) when (exception is JsonException or InvalidDataException or FormatException)
        {
            string quarantinePath = await QuarantineAsync(fullSourcePath, raw, cancellationToken).ConfigureAwait(false);
            return new MigrationResult(
                MigrationStatus.Quarantined,
                null,
                backupPath,
                quarantinePath,
                exception.Message);
        }
    }

    private async Task<string> BackupAsync(string sourcePath, string raw, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_backupDirectory);
        string destination = CreateEvidencePath(_backupDirectory, sourcePath, raw, ".backup.json");
        await File.WriteAllTextAsync(destination, raw, new UTF8Encoding(false), cancellationToken).ConfigureAwait(false);
        return destination;
    }

    private async Task<string> QuarantineAsync(string sourcePath, string raw, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_quarantineDirectory);
        string destination = CreateEvidencePath(_quarantineDirectory, sourcePath, raw, ".quarantine.json");
        await File.WriteAllTextAsync(destination, raw, new UTF8Encoding(false), cancellationToken).ConfigureAwait(false);
        return destination;
    }

    private static string CreateEvidencePath(string directory, string sourcePath, string raw, string suffix)
    {
        string safeName = string.Concat(Path.GetFileNameWithoutExtension(sourcePath).Select(
            character => Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        string hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(raw)))[..12];
        return Path.Combine(directory, $"{safeName}-{hash}{suffix}");
    }

    private static WorkshopFormat DetectFormat(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("문서 루트는 JSON 객체여야 합니다.");
        }

        int? schemaVersion = ReadInt(root, "schemaVersion");
        if (schemaVersion == 5)
        {
            return WorkshopFormat.NativeV5;
        }

        if (root.TryGetProperty("d", out JsonElement compactDevices)
            && compactDevices.ValueKind == JsonValueKind.Object)
        {
            return WorkshopFormat.CompactLegacy;
        }

        if (HasArray(root, "deviceInstances") || HasArray(root, "conductorBranches"))
        {
            return WorkshopFormat.NativeV3;
        }

        if (schemaVersion == 4)
        {
            return WorkshopFormat.NativeV4;
        }

        if (HasArray(root, "devices") || HasArray(root, "wires") || HasArray(root, "conductors"))
        {
            if (schemaVersion is null or >= 1 and <= 3)
            {
                return WorkshopFormat.FlatLegacy;
            }
        }

        throw new InvalidDataException($"지원하지 않는 레거시 문서 구조입니다: schemaVersion={schemaVersion?.ToString(CultureInfo.InvariantCulture) ?? "none"}");
    }

    private static WorkshopDocumentV5 ConvertLegacy(
        JsonElement root,
        string raw,
        WorkshopFormat format,
        string fallbackName)
    {
        DeviceInstanceV5[] devices = format switch
        {
            WorkshopFormat.CompactLegacy => ReadCompactDevices(root),
            WorkshopFormat.NativeV3 => ReadV3Devices(root),
            _ => ReadFlatDevices(root),
        };
        IReadOnlyDictionary<string, string> legacyTypesByDevice = BuildLegacyTypesByDevice(root, format);
        ConductorV5[] conductors = format switch
        {
            WorkshopFormat.NativeV3 => ReadV3Conductors(root, legacyTypesByDevice),
            WorkshopFormat.CompactLegacy => ReadEndpointConductors(root, "w", legacyTypesByDevice),
            _ when HasArray(root, "conductors") => ReadEndpointConductors(root, "conductors", legacyTypesByDevice),
            _ => ReadEndpointConductors(root, "wires", legacyTypesByDevice),
        };
        TerminalBridgeV5[] terminalBridges = ReadTerminalBridges(root, legacyTypesByDevice);
        CableAssemblyV5[] cableAssemblies = ReadCableAssemblies(root, conductors);
        TerminalAssemblyV5[] terminalAssemblies = ReadTerminalAssemblies(root);

        Dictionary<string, JsonElement> extensions = ReadExtensionObject(root);
        extensions["legacy"] = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["sourceFormat"] = format.ToString(),
            ["sourceSchemaVersion"] = ReadInt(root, "schemaVersion"),
            ["sourceSha256"] = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(raw))),
            ["originalDocument"] = root.Clone(),
        });

        var document = new WorkshopDocumentV5
        {
            SchemaVersion = 5,
            DocumentId = ReadString(root, "documentId") ?? Guid.NewGuid().ToString("D", CultureInfo.InvariantCulture),
            Revision = Math.Max(1, ReadInt(root, "revision") ?? 1),
            Name = ReadString(root, "name") ?? fallbackName,
            Devices = devices,
            Conductors = conductors,
            TerminalBridges = terminalBridges,
            CableAssemblies = cableAssemblies,
            TerminalAssemblies = terminalAssemblies,
            Panel = ReadPanel(root),
            Viewport = ReadViewport(root),
            Settings = ReadSettings(root),
            Extensions = extensions,
        };
        return DocumentHasher.WithContentHash(document);
    }

    private static DeviceInstanceV5[] ReadCompactDevices(JsonElement root)
    {
        JsonElement devices = root.GetProperty("d");
        var result = new List<DeviceInstanceV5>();
        foreach (JsonProperty property in devices.EnumerateObject())
        {
            JsonElement device = property.Value;
            if (device.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidDataException($"레거시 장비 '{property.Name}' 형식이 올바르지 않습니다.");
            }

            string legacyType = RequireString(device, "type", $"레거시 장비 '{property.Name}'에 type이 없습니다.");
            string profileId = ResolveProfileId(legacyType);
            double scale = ReadDouble(device, "scale") ?? 1;
            result.Add(new DeviceInstanceV5(
                property.Name,
                profileId,
                ProfileVersion(profileId),
                EvidenceGrade.Educational,
                ReadString(device, "label") ?? legacyType,
                ReadDouble(device, "x") ?? 0,
                ReadDouble(device, "y") ?? 0,
                ReadDouble(device, "rot") ?? 0,
                Math.Max(40, 120 * scale),
                Math.Max(40, 80 * scale),
                ReadBoolean(device, "locked") ?? false,
                ReadStringProperties(device, ["type", "label", "x", "y", "rot", "scale", "locked"]))
            {
                CatalogEntryId = legacyType,
            });
        }

        return [.. result];
    }

    private static DeviceInstanceV5[] ReadV3Devices(JsonElement root)
    {
        if (!root.TryGetProperty("deviceInstances", out JsonElement devices)
            || devices.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException("V3 문서에 deviceInstances 배열이 없습니다.");
        }

        var result = new List<DeviceInstanceV5>();
        foreach (JsonElement device in devices.EnumerateArray())
        {
            string id = RequireString(device, "id", "V3 장비에 id가 없습니다.");
            string profileId = RequireString(device, "profileId", $"V3 장비 '{id}'에 profileId가 없습니다.");
            if (!device.TryGetProperty("layoutMm", out JsonElement layout)
                || layout.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidDataException($"V3 장비 '{id}'에 layoutMm이 없습니다.");
            }

            result.Add(new DeviceInstanceV5(
                id,
                profileId,
                ReadSemanticVersion(device, "profileVersion"),
                EvidenceGrade.Educational,
                ReadString(device, "designation") ?? id,
                ReadDouble(layout, "x") ?? 0,
                ReadDouble(layout, "y") ?? 0,
                ReadDouble(layout, "rotation") ?? 0,
                Math.Max(40, ReadDouble(layout, "width") ?? 120),
                Math.Max(40, ReadDouble(layout, "height") ?? 80),
                false,
                device.TryGetProperty("configuration", out JsonElement configuration)
                    ? ReadStringProperties(configuration, [])
                    : new Dictionary<string, string>())
            {
                CatalogEntryId = profileId,
                AssetVersion = ReadString(device, "assetVersion"),
                ExactOrderCode = ReadString(device, "exactOrderCode") ?? ReadString(device, "orderCode"),
                Designation = ReadString(device, "designation"),
            });
        }

        return [.. result];
    }

    private static DeviceInstanceV5[] ReadFlatDevices(JsonElement root)
    {
        if (!root.TryGetProperty("devices", out JsonElement devices)
            || devices.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<DeviceInstanceV5>();
        foreach (JsonElement device in devices.EnumerateArray())
        {
            string id = ReadString(device, "id") ?? $"device-{result.Count + 1}";
            string? legacyType = ReadString(device, "legacyType") ?? ReadString(device, "type");
            string profileId = ReadString(device, "profileId")
                ?? (legacyType is null ? "unknown-profile" : ResolveProfileId(legacyType));
            result.Add(new DeviceInstanceV5(
                id,
                profileId,
                ReadSemanticVersion(device, "profileVersion"),
                ReadEvidenceGrade(device),
                ReadString(device, "label") ?? ReadString(device, "name") ?? id,
                ReadDouble(device, "x") ?? 0,
                ReadDouble(device, "y") ?? 0,
                ReadDouble(device, "rotation") ?? ReadDouble(device, "rot") ?? 0,
                Math.Max(40, ReadDouble(device, "width") ?? 120),
                Math.Max(40, ReadDouble(device, "height") ?? 80),
                ReadBoolean(device, "locked") ?? false,
                new Dictionary<string, string>())
            {
                CatalogEntryId = legacyType ?? profileId,
                AssetVersion = ReadString(device, "assetVersion"),
                ExactOrderCode = ReadString(device, "exactOrderCode") ?? ReadString(device, "orderCode"),
                Designation = ReadString(device, "designation"),
            });
        }

        return [.. result];
    }

    private static ConductorV5[] ReadEndpointConductors(
        JsonElement root,
        string propertyName,
        IReadOnlyDictionary<string, string> legacyTypesByDevice)
    {
        if (!root.TryGetProperty(propertyName, out JsonElement conductors)
            || conductors.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<ConductorV5>();
        foreach (JsonElement conductor in conductors.EnumerateArray())
        {
            TerminalRefV5? start = ReadTerminalRef(conductor, "start", legacyTypesByDevice)
                ?? ReadTerminalRef(conductor, "from", legacyTypesByDevice);
            TerminalRefV5? end = ReadTerminalRef(conductor, "end", legacyTypesByDevice)
                ?? ReadTerminalRef(conductor, "to", legacyTypesByDevice);
            if (start is null || end is null)
            {
                throw new InvalidDataException("레거시 전선의 시작 또는 끝 단자를 읽을 수 없습니다.");
            }

            string id = ReadString(conductor, "id") ?? $"conductor-{result.Count + 1}";
            result.Add(new ConductorV5(
                id,
                start,
                end,
                ReadWaypoints(conductor),
                ReadString(conductor, "label")
                    ?? ReadString(conductor, "wireNumber")
                    ?? ReadString(conductor, "tag")
                    ?? id,
                NormalizeColor(ReadString(conductor, "color")),
                ReadDouble(conductor, "gaugeMm2") ?? ParseGauge(ReadString(conductor, "gauge")) ?? 0.75,
                ReadBoolean(conductor, "routeLocked") ?? false));
        }

        return [.. result];
    }

    private static ConductorV5[] ReadV3Conductors(
        JsonElement root,
        IReadOnlyDictionary<string, string> legacyTypesByDevice)
    {
        if (!root.TryGetProperty("conductorBranches", out JsonElement branches)
            || branches.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var metadata = new Dictionary<string, LegacyConductorMetadata>(StringComparer.Ordinal);
        if (root.TryGetProperty("conductors", out JsonElement conductors)
            && conductors.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement conductor in conductors.EnumerateArray())
            {
                string id = RequireString(conductor, "id", "V3 conductor에 id가 없습니다.");
                metadata[id] = new LegacyConductorMetadata(
                    ReadString(conductor, "wireNumber") ?? id,
                    NormalizeColor(ReadString(conductor, "color")),
                    ReadDouble(conductor, "crossSectionMm2") ?? ParseGauge(ReadString(conductor, "gauge")) ?? 0.75,
                    ReadString(conductor, "cableAssemblyId"),
                    ReadString(conductor, "core"),
                    ReadString(conductor, "gauge"),
                    ReadString(conductor, "awg"),
                    ReadDouble(conductor, "lengthMm"),
                    ReadString(conductor, "pairId"),
                    ReadBoolean(conductor, "shielded") ?? false,
                    ReadBoolean(conductor, "drain") ?? false,
                    ReadString(conductor, "ferruleFrom"),
                    ReadString(conductor, "ferruleTo"),
                    ReadString(conductor, "lugFrom"),
                    ReadString(conductor, "lugTo"));
            }
        }

        var result = new List<ConductorV5>();
        var branchCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (JsonElement branch in branches.EnumerateArray())
        {
            string conductorId = RequireString(branch, "conductorId", "V3 conductorBranch에 conductorId가 없습니다.");
            if (!metadata.TryGetValue(conductorId, out LegacyConductorMetadata? details))
            {
                throw new InvalidDataException($"V3 branch가 존재하지 않는 conductor를 참조합니다: {conductorId}");
            }

            TerminalRefV5 start = ReadTerminalRef(branch, "from", legacyTypesByDevice)
                ?? throw new InvalidDataException("V3 branch 시작 단자를 읽을 수 없습니다.");
            TerminalRefV5 end = ReadTerminalRef(branch, "to", legacyTypesByDevice)
                ?? throw new InvalidDataException("V3 branch 끝 단자를 읽을 수 없습니다.");
            int count = branchCounts.TryGetValue(conductorId, out int current) ? current : 0;
            branchCounts[conductorId] = count + 1;
            string id = count == 0
                ? conductorId
                : $"{conductorId}:{RequireString(branch, "id", "V3 branch에 id가 없습니다.")}";
            result.Add(new ConductorV5(
                id,
                start,
                end,
                ReadWaypoints(branch),
                details.WireNumber,
                details.Color,
                details.GaugeMm2,
                false)
            {
                WireNumber = details.WireNumber,
                CableAssemblyId = details.CableAssemblyId,
                Core = details.Core,
                Gauge = details.Gauge,
                Awg = details.Awg,
                LengthMm = details.LengthMm,
                PairId = details.PairId,
                Shielded = details.Shielded,
                Drain = details.Drain,
                FerruleFrom = details.FerruleFrom,
                FerruleTo = details.FerruleTo,
                LugFrom = details.LugFrom,
                LugTo = details.LugTo,
            });
        }

        return [.. result];
    }

    private static TerminalBridgeV5[] ReadTerminalBridges(
        JsonElement root,
        IReadOnlyDictionary<string, string> legacyTypesByDevice)
    {
        if (!root.TryGetProperty("jumpers", out JsonElement jumpers)
            || jumpers.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<TerminalBridgeV5>();
        foreach (JsonElement jumper in jumpers.EnumerateArray())
        {
            string id = ReadString(jumper, "id") ?? $"jumper-{result.Count + 1}";
            TerminalRefV5? start = ReadTerminalRef(jumper, "start", legacyTypesByDevice);
            TerminalRefV5? end = ReadTerminalRef(jumper, "end", legacyTypesByDevice);
            if (start is not null && end is not null)
            {
                result.Add(new TerminalBridgeV5(id, [start, end], NormalizeColor(ReadString(jumper, "color"))));
                continue;
            }

            string? deviceId = ReadString(jumper, "deviceId");
            if (deviceId is null
                || !jumper.TryGetProperty("terms", out JsonElement terms)
                || terms.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidDataException($"레거시 점퍼 '{id}'의 단자를 읽을 수 없습니다.");
            }

            string[] terminalIds = terms.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => item.GetString())
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item!)
                .ToArray();
            if (terminalIds.Length < 2)
            {
                throw new InvalidDataException($"레거시 점퍼 '{id}'에는 단자가 두 개 이상 필요합니다.");
            }

            result.Add(new TerminalBridgeV5(
                id,
                [.. terminalIds.Select(terminalId => new TerminalRefV5(
                    deviceId,
                    ResolveTerminalId(deviceId, terminalId, legacyTypesByDevice)))],
                NormalizeColor(ReadString(jumper, "color"))));
        }

        return [.. result];
    }

    private static CableAssemblyV5[] ReadCableAssemblies(JsonElement root, ConductorV5[] conductors)
    {
        var result = new Dictionary<string, CableAssemblyV5>(StringComparer.Ordinal);
        if (root.TryGetProperty("cableAssemblies", out JsonElement cables)
            && cables.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement cable in cables.EnumerateArray())
            {
                string id = RequireString(cable, "id", "V3 cableAssembly에 id가 없습니다.");
                string[] referencedIds = ReadStringArray(cable, "conductorIds");
                string[] expandedIds = referencedIds
                    .SelectMany(reference => conductors
                        .Where(conductor => conductor.Id == reference
                            || conductor.Id.StartsWith($"{reference}:", StringComparison.Ordinal))
                        .Select(conductor => conductor.Id))
                    .Distinct(StringComparer.Ordinal)
                    .ToArray();
                if (referencedIds.Length > 0 && expandedIds.Length == 0)
                {
                    throw new InvalidDataException($"V3 cableAssembly '{id}'가 존재하지 않는 전선을 참조합니다.");
                }

                result[id] = new CableAssemblyV5(
                    id,
                    ReadString(cable, "designation"),
                    expandedIds,
                    ReadString(cable, "cableType"),
                    ReadDouble(cable, "lengthMm"),
                    ReadBoolean(cable, "shielded") ?? false,
                    ReadString(cable, "drainConductorId"),
                    ReadPointArray(cable, "route"));
            }
        }

        foreach (IGrouping<string, ConductorV5> group in conductors
            .Where(conductor => !string.IsNullOrWhiteSpace(conductor.CableAssemblyId))
            .GroupBy(conductor => conductor.CableAssemblyId!, StringComparer.Ordinal))
        {
            string[] memberIds = group.Select(conductor => conductor.Id).ToArray();
            if (result.TryGetValue(group.Key, out CableAssemblyV5? existing))
            {
                result[group.Key] = existing with
                {
                    ConductorIds = existing.ConductorIds
                        .Concat(memberIds)
                        .Distinct(StringComparer.Ordinal)
                        .ToArray(),
                    Shielded = existing.Shielded || group.Any(conductor => conductor.Shielded),
                    DrainConductorId = existing.DrainConductorId
                        ?? group.FirstOrDefault(conductor => conductor.Drain)?.Id,
                };
            }
            else
            {
                result[group.Key] = new CableAssemblyV5(
                    group.Key,
                    group.Key,
                    memberIds,
                    null,
                    group.Select(conductor => conductor.LengthMm).FirstOrDefault(length => length is not null),
                    group.Any(conductor => conductor.Shielded),
                    group.FirstOrDefault(conductor => conductor.Drain)?.Id,
                    []);
            }
        }

        return [.. result.Values.OrderBy(cable => cable.Id, StringComparer.Ordinal)];
    }

    private static TerminalAssemblyV5[] ReadTerminalAssemblies(JsonElement root)
    {
        if (!root.TryGetProperty("terminalAssemblies", out JsonElement assemblies)
            || assemblies.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return
        [
            .. assemblies.EnumerateArray().Select(assembly => new TerminalAssemblyV5(
                RequireString(assembly, "id", "V3 terminalAssembly에 id가 없습니다."),
                RequireString(assembly, "deviceId", "V3 terminalAssembly에 deviceId가 없습니다."),
                ReadStringArray(assembly, "terminalIds"),
                ReadString(assembly, "manufacturer"),
                ReadString(assembly, "orderCode"),
                ReadString(assembly, "designation"),
                ReadString(assembly, "terminalType"),
                ReadString(assembly, "marker"),
                ReadInt(assembly, "maximumConductorsPerTerminal"),
                ReadStringArray(assembly, "accessories"))),
        ];
    }

    private static string[] ReadStringArray(JsonElement parent, string propertyName)
        => parent.TryGetProperty(propertyName, out JsonElement values) && values.ValueKind == JsonValueKind.Array
            ? values.EnumerateArray()
                .Where(value => value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()))
                .Select(value => value.GetString()!)
                .ToArray()
            : [];

    private static PointV5[] ReadPointArray(JsonElement parent, string propertyName)
        => parent.TryGetProperty(propertyName, out JsonElement points) && points.ValueKind == JsonValueKind.Array
            ? points.EnumerateArray().Select(point => new PointV5(
                ReadDouble(point, "x") ?? throw new InvalidDataException($"{propertyName} 경로점 x가 없습니다."),
                ReadDouble(point, "y") ?? throw new InvalidDataException($"{propertyName} 경로점 y가 없습니다."))).ToArray()
            : [];

    private static TerminalRefV5? ReadTerminalRef(
        JsonElement parent,
        string propertyName,
        IReadOnlyDictionary<string, string> legacyTypesByDevice)
    {
        if (!parent.TryGetProperty(propertyName, out JsonElement terminal)
            || terminal.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string? deviceId = ReadString(terminal, "deviceId")
            ?? ReadString(terminal, "equipmentId")
            ?? ReadString(terminal, "elementId")
            ?? ReadString(terminal, "dev");
        string? terminalId = ReadString(terminal, "terminalId")
            ?? ReadString(terminal, "portId")
            ?? ReadString(terminal, "term");
        if (string.IsNullOrWhiteSpace(deviceId) || string.IsNullOrWhiteSpace(terminalId))
        {
            return null;
        }

        return new TerminalRefV5(deviceId, ResolveTerminalId(deviceId, terminalId, legacyTypesByDevice));
    }

    private static string ResolveTerminalId(
        string deviceId,
        string terminalId,
        IReadOnlyDictionary<string, string> legacyTypesByDevice)
    {
        if (legacyTypesByDevice.TryGetValue(deviceId, out string? legacyType)
            && LegacyTerminalAliases.TryGetValue(legacyType, out IReadOnlyDictionary<string, string>? aliases)
            && aliases.TryGetValue(terminalId, out string? resolved))
        {
            return resolved;
        }

        return terminalId;
    }

    private static Dictionary<string, string> BuildLegacyTypesByDevice(
        JsonElement root,
        WorkshopFormat format)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (format == WorkshopFormat.CompactLegacy)
        {
            foreach (JsonProperty device in root.GetProperty("d").EnumerateObject())
            {
                string? type = ReadString(device.Value, "type");
                if (type is not null)
                {
                    result[device.Name] = type;
                }
            }
        }
        else if (root.TryGetProperty("devices", out JsonElement devices)
            && devices.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement device in devices.EnumerateArray())
            {
                string? id = ReadString(device, "id");
                string? type = ReadString(device, "legacyType") ?? ReadString(device, "type");
                if (id is not null && type is not null)
                {
                    result[id] = type;
                }
            }
        }

        return result;
    }

    private static PointV5[] ReadWaypoints(JsonElement conductor)
    {
        foreach (string name in new[] { "waypoints", "waypointsMm", "route" })
        {
            if (!conductor.TryGetProperty(name, out JsonElement points)
                || points.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                continue;
            }

            if (points.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidDataException($"전선 {name}은 배열이어야 합니다.");
            }

            return
            [
                .. points.EnumerateArray().Select(point => new PointV5(
                    ReadDouble(point, "x") ?? throw new InvalidDataException("경로점 x가 없습니다."),
                    ReadDouble(point, "y") ?? throw new InvalidDataException("경로점 y가 없습니다."))),
            ];
        }

        return [];
    }

    private static PanelLayoutV5 ReadPanel(JsonElement root)
    {
        if (root.TryGetProperty("panel", out JsonElement panel)
            && panel.ValueKind == JsonValueKind.Object)
        {
            return new PanelLayoutV5(
                Math.Max(100, ReadDouble(panel, "width") ?? 1600),
                Math.Max(100, ReadDouble(panel, "height") ?? 1000));
        }

        return new PanelLayoutV5(1600, 1000);
    }

    private static ViewportV5 ReadViewport(JsonElement root)
    {
        if (root.TryGetProperty("viewport", out JsonElement viewport)
            && viewport.ValueKind == JsonValueKind.Object)
        {
            return new ViewportV5(
                Math.Clamp(ReadDouble(viewport, "zoom") ?? 1, 0.1, 8),
                ReadDouble(viewport, "offsetX") ?? 0,
                ReadDouble(viewport, "offsetY") ?? 0);
        }

        if (root.TryGetProperty("pan", out JsonElement pan)
            && pan.ValueKind == JsonValueKind.Object)
        {
            return new ViewportV5(
                Math.Clamp(ReadDouble(pan, "k") ?? 1, 0.1, 8),
                ReadDouble(pan, "x") ?? 0,
                ReadDouble(pan, "y") ?? 0);
        }

        return new ViewportV5(1, 0, 0);
    }

    private static WorkshopSettingsV5 ReadSettings(JsonElement root)
    {
        if (root.TryGetProperty("settings", out JsonElement settings)
            && settings.ValueKind == JsonValueKind.Object)
        {
            return new WorkshopSettingsV5(
                Math.Max(1, ReadDouble(settings, "gridSize") ?? 10),
                ReadBoolean(settings, "snapToGrid") ?? true);
        }

        return new WorkshopSettingsV5(10, true);
    }

    private static Dictionary<string, JsonElement> ReadExtensionObject(JsonElement root)
    {
        var extensions = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        if (root.TryGetProperty("extensions", out JsonElement source)
            && source.ValueKind == JsonValueKind.Object)
        {
            foreach (JsonProperty property in source.EnumerateObject())
            {
                extensions[property.Name] = property.Value.Clone();
            }
        }

        return extensions;
    }

    private static Dictionary<string, string> ReadStringProperties(
        JsonElement source,
        IReadOnlyCollection<string> excluded)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (source.ValueKind != JsonValueKind.Object)
        {
            return result;
        }

        foreach (JsonProperty property in source.EnumerateObject())
        {
            if (!excluded.Contains(property.Name, StringComparer.Ordinal))
            {
                result[property.Name] = property.Value.ValueKind == JsonValueKind.String
                    ? property.Value.GetString() ?? string.Empty
                    : property.Value.GetRawText();
            }
        }

        return result;
    }

    private static void ValidateNoSilentLoss(
        JsonElement root,
        WorkshopFormat format,
        WorkshopDocumentV5 document)
    {
        int inputDevices = format switch
        {
            WorkshopFormat.CompactLegacy => root.GetProperty("d").EnumerateObject().Count(),
            WorkshopFormat.NativeV3 => ArrayCount(root, "deviceInstances"),
            _ => ArrayCount(root, "devices"),
        };
        int inputConductors = format switch
        {
            WorkshopFormat.CompactLegacy => ArrayCount(root, "w"),
            WorkshopFormat.NativeV3 => ArrayCount(root, "conductorBranches"),
            _ => HasArray(root, "conductors") ? ArrayCount(root, "conductors") : ArrayCount(root, "wires"),
        };

        if (inputDevices > 0 && document.Devices.Length == 0)
        {
            throw new InvalidDataException("입력 문서에 장비가 있지만 변환 결과가 비어 있습니다.");
        }

        if (inputConductors > 0 && document.Conductors.Length == 0)
        {
            throw new InvalidDataException("입력 문서에 전선이 있지만 변환 결과가 비어 있습니다.");
        }

        if (document.Devices.Length != inputDevices)
        {
            throw new InvalidDataException($"장비 개수 불변조건이 깨졌습니다: {inputDevices} -> {document.Devices.Length}");
        }

        if (document.Conductors.Length < inputConductors)
        {
            throw new InvalidDataException($"전선 개수 불변조건이 깨졌습니다: {inputConductors} -> {document.Conductors.Length}");
        }

        if (format == WorkshopFormat.NativeV3
            && ArrayCount(root, "cableAssemblies") > document.CableAssemblies.Length)
        {
            throw new InvalidDataException("케이블 묶음 변환 중 활성 데이터가 손실되었습니다.");
        }

        if (format == WorkshopFormat.NativeV3
            && ArrayCount(root, "terminalAssemblies") != document.TerminalAssemblies.Length)
        {
            throw new InvalidDataException("단자대 조립 정보 변환 중 활성 데이터가 손실되었습니다.");
        }
    }

    private static bool IsCompleteV3(JsonElement root)
        => HasArray(root, "sources")
            && HasArray(root, "elements")
            && HasArray(root, "branches")
            && root.TryGetProperty("sourceSystem", out _)
            && root.TryGetProperty("reviewScope", out _);

    private static void ValidateLegacyV3Hash(JsonElement root)
    {
        string declared = RequireString(root, "hash", "V3 문서에 hash가 없습니다.");
        JsonNode node = JsonNode.Parse(root.GetRawText())
            ?? throw new InvalidDataException("V3 문서 해시를 계산할 수 없습니다.");
        if (node is not JsonObject jsonObject)
        {
            throw new InvalidDataException("V3 문서 루트가 객체가 아닙니다.");
        }

        jsonObject.Remove("hash");
        string canonical = JsonCanonicalizer.Canonicalize(node);
        string expected = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
        if (!string.Equals(declared, expected, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("V3 문서 내용 해시가 일치하지 않습니다.");
        }
    }

    private static string ResolveProfileId(string legacyType)
    {
        if (legacyType is "dc-supply-24v" or "lamp-green-v1" or "lamp-yellow-v1" or "lamp-white-v1"
                or "prox-npn-v2" or "prox-pnp-v2" or "plc-input-24v")
        {
            return legacyType;
        }

        // 명시적 레거시 별칭은 일반 카탈로그 legacy:* 프로필보다 우선해야 과거 검증 프로필을 잃지 않습니다.
        if (LegacyProfileAliases.TryGetValue(legacyType, out string? profileId))
        {
            return profileId;
        }

        if (CatalogProfileAliases.Value.TryGetValue(legacyType, out string? catalogProfileId))
        {
            return catalogProfileId;
        }

        if (legacyType.Contains(':', StringComparison.Ordinal))
        {
            return legacyType;
        }

        return $"legacy:{legacyType}";
    }

    private static int ProfileVersion(string profileId)
        => profileId is "prox-npn-v2" or "prox-pnp-v2" ? 2 : 1;

    private static EvidenceGrade ReadEvidenceGrade(JsonElement device)
    {
        string? grade = ReadString(device, "evidenceGrade") ?? ReadString(device, "evidenceLevel");
        return grade?.ToLowerInvariant() switch
        {
            "manualverified" or "manual-verified" => EvidenceGrade.ManualVerified,
            "benchverified" or "bench-verified" => EvidenceGrade.BenchVerified,
            _ => EvidenceGrade.Educational,
        };
    }

    private static int ReadSemanticVersion(JsonElement parent, string name)
    {
        if (ReadInt(parent, name) is int number)
        {
            return Math.Max(1, number);
        }

        string? value = ReadString(parent, name);
        if (value is not null)
        {
            string major = value.Split('.', '-', StringSplitOptions.RemoveEmptyEntries)[0];
            if (int.TryParse(major, NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsed))
            {
                return Math.Max(1, parsed);
            }
        }

        return 1;
    }

    private static double? ParseGauge(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        string number = new(value
            .TakeWhile(character => char.IsDigit(character) || character is '.' or ',')
            .Select(character => character == ',' ? '.' : character)
            .ToArray());
        return double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed)
            ? parsed
            : null;
    }

    private static string NormalizeColor(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "#EF4444";
        }

        string normalized = value.ToUpperInvariant();
        if (normalized.Length == 4 && normalized[0] == '#')
        {
            return $"#{normalized[1]}{normalized[1]}{normalized[2]}{normalized[2]}{normalized[3]}{normalized[3]}";
        }

        return normalized;
    }

    private static bool HasArray(JsonElement root, string propertyName)
        => root.TryGetProperty(propertyName, out JsonElement value) && value.ValueKind == JsonValueKind.Array;

    private static int ArrayCount(JsonElement root, string propertyName)
        => root.TryGetProperty(propertyName, out JsonElement value) && value.ValueKind == JsonValueKind.Array
            ? value.GetArrayLength()
            : 0;

    private static string RequireString(JsonElement parent, string name, string message)
        => ReadString(parent, name) is { } value && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new InvalidDataException(message);

    private static string? ReadString(JsonElement parent, string name)
        => parent.ValueKind == JsonValueKind.Object
            && parent.TryGetProperty(name, out JsonElement value)
            && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? ReadInt(JsonElement parent, string name)
        => parent.ValueKind == JsonValueKind.Object
            && parent.TryGetProperty(name, out JsonElement value)
            && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt32(out int parsed)
            ? parsed
            : null;

    private static double? ReadDouble(JsonElement parent, string name)
        => parent.ValueKind == JsonValueKind.Object
            && parent.TryGetProperty(name, out JsonElement value)
            && value.TryGetDouble(out double parsed)
            ? parsed
            : null;

    private static bool? ReadBoolean(JsonElement parent, string name)
        => parent.ValueKind == JsonValueKind.Object
            && parent.TryGetProperty(name, out JsonElement value)
            && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : null;

    private enum WorkshopFormat
    {
        NativeV5,
        NativeV4,
        NativeV3,
        FlatLegacy,
        CompactLegacy,
    }

    private sealed record LegacyConductorMetadata(
        string WireNumber,
        string Color,
        double GaugeMm2,
        string? CableAssemblyId,
        string? Core,
        string? Gauge,
        string? Awg,
        double? LengthMm,
        string? PairId,
        bool Shielded,
        bool Drain,
        string? FerruleFrom,
        string? FerruleTo,
        string? LugFrom,
        string? LugTo);
}
