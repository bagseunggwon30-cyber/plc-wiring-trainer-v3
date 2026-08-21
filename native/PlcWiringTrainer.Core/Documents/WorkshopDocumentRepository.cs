using System.Text;

namespace PlcWiringTrainer.Core.Documents;

public interface IWorkshopDocumentRepository
{
    Task SaveAsync(string path, WorkshopDocumentV4 document, CancellationToken cancellationToken = default);

    Task<MigrationResult> LoadAsync(string path, CancellationToken cancellationToken = default);

    Task SaveAutosaveAsync(WorkshopDocumentV4 document, CancellationToken cancellationToken = default);
}

public sealed class WorkshopDocumentRepository : IWorkshopDocumentRepository
{
    private readonly IWorkshopDocumentMigrator _migrator;
    private readonly string _autosaveDirectory;

    public WorkshopDocumentRepository(IWorkshopDocumentMigrator migrator, string? autosaveDirectory = null)
    {
        _migrator = migrator ?? throw new ArgumentNullException(nameof(migrator));
        _autosaveDirectory = autosaveDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PLC Wiring Trainer",
            "Autosave");
    }

    public async Task SaveAsync(
        string path,
        WorkshopDocumentV4 document,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        ArgumentNullException.ThrowIfNull(document);
        string fullPath = Path.GetFullPath(path);
        string? directory = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new InvalidOperationException("저장 경로의 디렉터리를 확인할 수 없습니다.");
        }

        Directory.CreateDirectory(directory);
        WorkshopDocumentV4 normalized = DocumentHasher.WithContentHash(document);
        string temporaryPath = $"{fullPath}.tmp.{Guid.NewGuid():N}";
        try
        {
            await File.WriteAllTextAsync(
                temporaryPath,
                WorkshopDocumentSerializer.Serialize(normalized),
                new UTF8Encoding(false),
                cancellationToken).ConfigureAwait(false);

            if (File.Exists(fullPath))
            {
                File.Replace(temporaryPath, fullPath, null, ignoreMetadataErrors: true);
            }
            else
            {
                File.Move(temporaryPath, fullPath);
            }
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    public Task<MigrationResult> LoadAsync(string path, CancellationToken cancellationToken = default)
        => _migrator.MigrateAsync(path, cancellationToken);

    public Task SaveAutosaveAsync(
        WorkshopDocumentV4 document,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        string safeId = string.Concat(document.DocumentId.Select(
            character => Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        return SaveAsync(Path.Combine(_autosaveDirectory, $"{safeId}.plcw"), document, cancellationToken);
    }
}
