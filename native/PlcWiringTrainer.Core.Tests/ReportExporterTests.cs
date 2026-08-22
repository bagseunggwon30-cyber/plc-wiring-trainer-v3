using System.Text;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Reports;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class ReportExporterTests
{
    [Fact]
    public async Task PinToPinCsvEscapesSpreadsheetFormulaCells()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp();
        document = DocumentHasher.WithContentHash(document with
        {
            Conductors =
            [
                document.Conductors[0] with
                {
                    Label = "=HYPERLINK(\"https://invalid\")",
                    WireNumber = "=HYPERLINK(\"https://invalid\")",
                },
                document.Conductors[1],
            ],
        });
        var exporter = new ReportExporter(DeviceProfileCatalog.CreateDefault());

        ReportArtifactV5 artifact = await exporter.ExportAsync(
            document,
            null,
            ReportKindV5.PinToPinCsv);
        string csv = Encoding.UTF8.GetString(artifact.Content);

        Assert.Contains("'=HYPERLINK", csv, StringComparison.Ordinal);
        Assert.DoesNotContain("<html", csv, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("text/csv", artifact.MediaType);
    }

    [Fact]
    public async Task CanonicalReportNeverClaimsVerifiedPrewireForStaleOrEducationalData()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp() with { Mode = WorkshopMode.Prewire };
        var exporter = new ReportExporter(DeviceProfileCatalog.CreateDefault());

        ReportArtifactV5 artifact = await exporter.ExportAsync(
            document,
            new ValidationResultV5(
                document.Revision - 1,
                "stale",
                [],
                new SimulationResultV5([])),
            ReportKindV5.CanonicalJson);

        Assert.False(artifact.VerifiedPrewire);
        Assert.Equal("application/json", artifact.MediaType);
    }

    [Fact]
    public async Task PinToPinUsesWireNumberAndTheEffectiveManualColor()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp();
        document = DocumentHasher.WithContentHash(document with
        {
            Conductors =
            [
                document.Conductors[0] with
                {
                    Label = "사용자 표시명",
                    WireNumber = "W777",
                    Color = "#F97316",
                    ManualColor = true,
                },
            ],
        });
        var exporter = new ReportExporter(DeviceProfileCatalog.CreateDefault());

        ReportArtifactV5 artifact = await exporter.ExportAsync(document, null, ReportKindV5.PinToPinCsv);
        string csv = Encoding.UTF8.GetString(artifact.Content);

        Assert.Contains("W777", csv, StringComparison.Ordinal);
        Assert.Contains("#F97316", csv, StringComparison.Ordinal);
        Assert.DoesNotContain("사용자 표시명", csv, StringComparison.Ordinal);
    }
}
