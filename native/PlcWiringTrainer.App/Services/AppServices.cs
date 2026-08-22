using PlcWiringTrainer.App.Presentation;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Palette;
using PlcWiringTrainer.Core.Reports;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Wiring;

namespace PlcWiringTrainer.App.Services;

/// <summary>포터블 앱이 공유해야 하는 Core 서비스를 한 번만 구성합니다.</summary>
internal sealed record AppServices(
    DeviceProfileCatalog Catalog,
    IConnectionAssessmentService ConnectionAssessment,
    IReportExporter ReportExporter,
    WorkshopDocumentRepository Repository,
    PaletteController Palette)
{
    public static AppServices CreateDefault()
    {
        DeviceProfileCatalog catalog = DeviceProfileCatalog.CreateDefault();
        string? configuredDataRoot = Environment.GetEnvironmentVariable("PLCW_DATA_ROOT");
        string appData = string.IsNullOrWhiteSpace(configuredDataRoot)
            ? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PLC Wiring Trainer")
            : Path.GetFullPath(configuredDataRoot);
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(appData, "Import Backups"),
            Path.Combine(appData, "Quarantine"));
        var repository = new WorkshopDocumentRepository(
            migrator,
            Path.Combine(appData, "Autosave"));
        string paletteSettingsPath = Environment.GetEnvironmentVariable("PLCW_PALETTE_SETTINGS_PATH")
            ?? Path.Combine(appData, "palette-preferences.v1.json");
        var palette = new PaletteController(
            catalog,
            new PalettePreferencesStore(paletteSettingsPath));
        return new AppServices(
            catalog,
            new ConnectionAssessmentService(catalog),
            new ReportExporter(catalog),
            repository,
            palette);
    }
}
