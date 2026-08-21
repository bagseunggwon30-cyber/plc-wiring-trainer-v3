using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PlcWiringTrainer.Core.Documents;

public enum MigrationStatus
{
    AlreadyV4,
    Converted,
    Quarantined,
}

public sealed record MigrationResult(
    MigrationStatus Status,
    WorkshopDocumentV4? Document,
    string BackupPath,
    string QuarantinePath,
    string Error);

public interface IWorkshopDocumentMigrator
{
    Task<MigrationResult> MigrateAsync(string sourcePath, CancellationToken cancellationToken = default);
}

public sealed class WorkshopDocumentMigrator : IWorkshopDocumentMigrator
{
    private readonly string _backupDirectory;
    private readonly string _quarantineDirectory;

    public WorkshopDocumentMigrator(string backupDirectory, string quarantineDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(backupDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(quarantineDirectory);
        _backupDirectory = Path.GetFullPath(backupDirectory);
        _quarantineDirectory = Path.GetFullPath(quarantineDirectory);
    }

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
            int schemaVersion = DetectSchemaVersion(root);
            if (schemaVersion == 4)
            {
                WorkshopDocumentV4 existing = WorkshopDocumentSerializer.Deserialize(raw, verifyHash: false);
                existing = DocumentHasher.WithContentHash(existing);
                return new MigrationResult(MigrationStatus.AlreadyV4, existing, backupPath, string.Empty, string.Empty);
            }

            WorkshopDocumentV4 converted = ConvertLegacy(root, schemaVersion, Path.GetFileNameWithoutExtension(fullSourcePath));
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

    private static int DetectSchemaVersion(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("문서 루트는 JSON 객체여야 합니다.");
        }

        if (root.TryGetProperty("schemaVersion", out JsonElement version) && version.TryGetInt32(out int parsed))
        {
            return parsed;
        }

        return 1;
    }

    private static WorkshopDocumentV4 ConvertLegacy(JsonElement root, int schemaVersion, string fallbackName)
    {
        if (schemaVersion is < 1 or > 3)
        {
            throw new InvalidDataException($"지원하지 않는 레거시 스키마입니다: {schemaVersion}");
        }

        DeviceInstanceV4[] devices = ReadDevices(root);
        ConductorV4[] conductors = ReadConductors(root);
        JsonElement legacy = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["sourceSchemaVersion"] = schemaVersion,
            ["originalDocument"] = root.Clone(),
        });

        var document = new WorkshopDocumentV4
        {
            DocumentId = ReadString(root, "documentId") ?? Guid.NewGuid().ToString("D", CultureInfo.InvariantCulture),
            Revision = Math.Max(1, ReadInt(root, "revision") ?? 1),
            Name = ReadString(root, "name") ?? fallbackName,
            Devices = devices,
            Conductors = conductors,
            Jumpers = [],
            Panel = new PanelLayoutV4(1600, 1000),
            Viewport = new ViewportV4(1, 0, 0),
            Settings = new WorkshopSettingsV4(10, true),
            Extensions = new Dictionary<string, JsonElement> { ["legacy"] = legacy },
        };
        return DocumentHasher.WithContentHash(document);
    }

    private static DeviceInstanceV4[] ReadDevices(JsonElement root)
    {
        if (!root.TryGetProperty("devices", out JsonElement devices) || devices.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<DeviceInstanceV4>();
        foreach (JsonElement device in devices.EnumerateArray())
        {
            string id = ReadString(device, "id") ?? $"device-{result.Count + 1}";
            string profileId = ReadString(device, "profileId") ?? ReadString(device, "type") ?? "unknown-profile";
            result.Add(new DeviceInstanceV4(
                id,
                profileId,
                ReadInt(device, "profileVersion") ?? 1,
                EvidenceGrade.Educational,
                ReadString(device, "label") ?? ReadString(device, "name") ?? id,
                ReadDouble(device, "x") ?? 0,
                ReadDouble(device, "y") ?? 0,
                ReadDouble(device, "rotation") ?? 0,
                Math.Max(40, ReadDouble(device, "width") ?? 120),
                Math.Max(40, ReadDouble(device, "height") ?? 80),
                false,
                new Dictionary<string, string>()));
        }

        return [.. result];
    }

    private static ConductorV4[] ReadConductors(JsonElement root)
    {
        JsonElement conductors;
        if (!(root.TryGetProperty("conductors", out conductors) || root.TryGetProperty("wires", out conductors))
            || conductors.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<ConductorV4>();
        foreach (JsonElement conductor in conductors.EnumerateArray())
        {
            TerminalRefV4? start = ReadTerminalRef(conductor, "start") ?? ReadTerminalRef(conductor, "from");
            TerminalRefV4? end = ReadTerminalRef(conductor, "end") ?? ReadTerminalRef(conductor, "to");
            if (start is null || end is null)
            {
                continue;
            }

            string id = ReadString(conductor, "id") ?? $"conductor-{result.Count + 1}";
            result.Add(new ConductorV4(
                id,
                start,
                end,
                [],
                ReadString(conductor, "label") ?? ReadString(conductor, "wireNumber") ?? id,
                ReadString(conductor, "color") ?? "#EF4444",
                ReadDouble(conductor, "gaugeMm2") ?? 0.75,
                false));
        }

        return [.. result];
    }

    private static TerminalRefV4? ReadTerminalRef(JsonElement parent, string propertyName)
    {
        if (!parent.TryGetProperty(propertyName, out JsonElement terminal) || terminal.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string? deviceId = ReadString(terminal, "deviceId") ?? ReadString(terminal, "equipmentId");
        string? terminalId = ReadString(terminal, "terminalId") ?? ReadString(terminal, "portId");
        return string.IsNullOrWhiteSpace(deviceId) || string.IsNullOrWhiteSpace(terminalId)
            ? null
            : new TerminalRefV4(deviceId, terminalId);
    }

    private static string? ReadString(JsonElement parent, string name)
        => parent.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? ReadInt(JsonElement parent, string name)
        => parent.TryGetProperty(name, out JsonElement value) && value.TryGetInt32(out int parsed) ? parsed : null;

    private static double? ReadDouble(JsonElement parent, string name)
        => parent.TryGetProperty(name, out JsonElement value) && value.TryGetDouble(out double parsed) ? parsed : null;
}
