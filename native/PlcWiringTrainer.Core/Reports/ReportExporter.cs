using System.Globalization;
using System.Text;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Reports;

public enum ReportKindV5
{
    CanonicalJson,
    PinToPinCsv,
    CableCoreCsv,
    TerminalPlanCsv,
    BillOfMaterialsCsv,
}

public sealed record ReportArtifactV5(
    string SuggestedFileName,
    string MediaType,
    byte[] Content,
    bool VerifiedPrewire,
    int Revision,
    string ContentHash);

public interface IReportExporter
{
    Task<ReportArtifactV5> ExportAsync(
        WorkshopDocumentV5 document,
        ValidationResultV5? validation,
        ReportKindV5 kind,
        CancellationToken cancellationToken = default);
}

/// <summary>브라우저나 HTML 중간 문서 없이 JSON과 CSV 검토 자료를 생성합니다.</summary>
public sealed class ReportExporter : IReportExporter
{
    private static readonly UTF8Encoding Utf8 = new(false);
    private static readonly string[] PinToPinHeader = ["wireNumber", "startDevice", "startTerminal", "endDevice", "endTerminal", "color", "gaugeMm2", "routeLocked"];
    private static readonly string[] CableCoreHeader = ["cableId", "designation", "conductorId", "core", "wireNumber", "shielded", "drain", "lengthMm"];
    private static readonly string[] TerminalPlanHeader = ["deviceId", "designation", "profileId", "terminalId", "label", "domain", "potential", "role", "maxConductors"];
    private static readonly string[] BillOfMaterialsHeader = ["profileId", "catalogEntryId", "displayName", "exactOrderCode", "quantity", "evidence"];
    private readonly DeviceProfileCatalog _catalog;

    public ReportExporter(DeviceProfileCatalog catalog)
    {
        _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
    }

    public Task<ReportArtifactV5> ExportAsync(
        WorkshopDocumentV5 document,
        ValidationResultV5? validation,
        ReportKindV5 kind,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        cancellationToken.ThrowIfCancellationRequested();
        bool verified = IsVerifiedPrewire(document, validation);
        string baseName = FileName(document.Name);
        (string suffix, string mediaType, string content) = kind switch
        {
            ReportKindV5.CanonicalJson => (".plcw.json", "application/json", WorkshopDocumentSerializer.Serialize(document)),
            ReportKindV5.PinToPinCsv => ("-pin-to-pin.csv", "text/csv", PinToPin(document)),
            ReportKindV5.CableCoreCsv => ("-cable-core.csv", "text/csv", CableCore(document)),
            ReportKindV5.TerminalPlanCsv => ("-terminal-plan.csv", "text/csv", TerminalPlan(document)),
            ReportKindV5.BillOfMaterialsCsv => ("-bom.csv", "text/csv", BillOfMaterials(document)),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        return Task.FromResult(new ReportArtifactV5(
            baseName + suffix,
            mediaType,
            Utf8.GetBytes(content),
            verified,
            document.Revision,
            document.ContentHash));
    }

    private bool IsVerifiedPrewire(WorkshopDocumentV5 document, ValidationResultV5? validation)
        => document.Mode == WorkshopMode.Prewire
            && validation is not null
            && validation.Revision == document.Revision
            && string.Equals(validation.ContentHash, document.ContentHash, StringComparison.Ordinal)
            && validation.Issues.All(issue => !issue.Blocking && issue.Severity != ValidationSeverity.Error)
            && document.PhysicalLayout.Status == CompletenessStatus.Complete
            && document.SourceSystem.Status == CompletenessStatus.Complete
            && document.Devices.All(device =>
                _catalog.TryGet(device.ProfileId, out DeviceProfileV5? profile)
                && profile.ManualEvidence == ManualEvidenceStatusV5.ExactProduct
                && profile.EvidenceGrade != EvidenceGrade.Educational
                && device.EvidenceGrade != EvidenceGrade.Educational
                && !string.IsNullOrWhiteSpace(profile.Artwork.Sha256));

    private static string PinToPin(WorkshopDocumentV5 document)
    {
        var rows = new List<string[]>
        {
            PinToPinHeader,
        };
        rows.AddRange(document.Conductors.Select(conductor => new[]
        {
            conductor.WireNumber,
            conductor.Start.DeviceId,
            conductor.Start.TerminalId,
            conductor.End.DeviceId,
            conductor.End.TerminalId,
            conductor.Color,
            conductor.GaugeMm2.ToString(CultureInfo.InvariantCulture),
            conductor.RouteLocked.ToString(CultureInfo.InvariantCulture),
        }));
        return Csv(rows);
    }

    private static string CableCore(WorkshopDocumentV5 document)
    {
        var rows = new List<string[]>
        {
            CableCoreHeader,
        };
        foreach (CableAssemblyV5 cable in document.CableAssemblies)
        {
            foreach (string conductorId in cable.ConductorIds)
            {
                ConductorV5? conductor = document.Conductors.FirstOrDefault(item => item.Id == conductorId);
                rows.Add(
                [
                    cable.Id,
                    cable.Designation ?? string.Empty,
                    conductorId,
                    conductor?.Core ?? string.Empty,
                    conductor?.WireNumber ?? string.Empty,
                    cable.Shielded.ToString(CultureInfo.InvariantCulture),
                    (cable.DrainConductorId == conductorId).ToString(CultureInfo.InvariantCulture),
                    cable.LengthMm?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
                ]);
            }
        }

        return Csv(rows);
    }

    private string TerminalPlan(WorkshopDocumentV5 document)
    {
        var rows = new List<string[]>
        {
            TerminalPlanHeader,
        };
        foreach (DeviceInstanceV5 device in document.Devices)
        {
            if (!_catalog.TryGet(device.ProfileId, out DeviceProfileV5? profile))
            {
                continue;
            }

            rows.AddRange(profile.Terminals.Select(terminal => new[]
            {
                device.Id,
                device.Designation ?? device.Label,
                device.ProfileId,
                terminal.Id,
                terminal.Label,
                terminal.Domain.ToString(),
                terminal.Potential.ToString(),
                terminal.Role.ToString(),
                terminal.MaxConductors.ToString(CultureInfo.InvariantCulture),
            }));
        }

        return Csv(rows);
    }

    private string BillOfMaterials(WorkshopDocumentV5 document)
    {
        var rows = new List<string[]>
        {
            BillOfMaterialsHeader,
        };
        foreach (IGrouping<string, DeviceInstanceV5> group in document.Devices.GroupBy(device => device.ProfileId, StringComparer.Ordinal))
        {
            _catalog.TryGet(group.Key, out DeviceProfileV5? profile);
            rows.Add(
            [
                group.Key,
                group.Select(device => device.CatalogEntryId).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? string.Empty,
                profile?.DisplayName ?? group.Key,
                group.Select(device => device.ExactOrderCode).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? string.Empty,
                group.Count().ToString(CultureInfo.InvariantCulture),
                profile?.ManualEvidence.ToString() ?? "Unknown",
            ]);
        }

        return Csv(rows);
    }

    private static string Csv(IEnumerable<string[]> rows)
        => string.Join("\r\n", rows.Select(row => string.Join(',', row.Select(CsvCell)))) + "\r\n";

    private static string CsvCell(string value)
    {
        string safe = value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r' or '\n'
            ? "'" + value
            : value;
        return $"\"{safe.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
    }

    private static string FileName(string value)
    {
        string result = string.Concat(value.Select(character =>
            Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        return string.IsNullOrWhiteSpace(result) ? "wiring-report" : result;
    }
}
