using System.Text;

namespace PlcWiringTrainer.Core.Documents;

/// <summary>원자적 수동 저장, 레거시 가져오기와 자동 복구본 저장을 제공합니다.</summary>
public interface IWorkshopDocumentRepository
{
    /// <summary>현재 문서를 임시 파일과 원자적 교체를 사용해 저장합니다.</summary>
    Task SaveAsync(string path, WorkshopDocumentV5 document, CancellationToken cancellationToken = default);

    /// <summary>문서를 읽고 필요하면 원문을 보존한 뒤 schema v5로 변환합니다.</summary>
    Task<MigrationResult> LoadAsync(string path, CancellationToken cancellationToken = default);

    /// <summary>사용자 문서와 분리된 자동 복구 위치에 snapshot을 저장합니다.</summary>
    Task SaveAutosaveAsync(WorkshopDocumentV5 document, CancellationToken cancellationToken = default);
}

/// <summary>문서 파일 I/O와 migrator를 결합하는 기본 저장소입니다.</summary>
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
        WorkshopDocumentV5 document,
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
        WorkshopDocumentV5 normalized = DocumentHasher.WithContentHash(document);
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
        WorkshopDocumentV5 document,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        string safeId = string.Concat(document.DocumentId.Select(
            character => Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        return SaveAsync(Path.Combine(_autosaveDirectory, $"{safeId}.plcw"), document, cancellationToken);
    }
}
