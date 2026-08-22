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

    /// <summary>최근 자동 복구본 경로를 수정 시각의 내림차순으로 반환합니다.</summary>
    Task<string[]> FindAutosavePathsAsync(CancellationToken cancellationToken = default);

    /// <summary>문서 ID에 해당하는 자동 복구본을 삭제합니다.</summary>
    Task DeleteAutosaveAsync(string documentId, CancellationToken cancellationToken = default);
}

/// <summary>문서 파일 I/O와 migrator를 결합하는 기본 저장소입니다.</summary>
public sealed class WorkshopDocumentRepository : IWorkshopDocumentRepository
{
    private readonly IWorkshopDocumentMigrator _migrator;
    private readonly string _autosaveDirectory;

    /// <summary>WorkshopDocumentRepository 작업을 수행합니다.</summary>
    public WorkshopDocumentRepository(IWorkshopDocumentMigrator migrator, string? autosaveDirectory = null)
    {
        _migrator = migrator ?? throw new ArgumentNullException(nameof(migrator));
        _autosaveDirectory = autosaveDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PLC Wiring Trainer",
            "Autosave");
    }

    /// <summary>SaveAsync 작업을 수행합니다.</summary>
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

    /// <summary>LoadAsync 작업을 수행합니다.</summary>
    public Task<MigrationResult> LoadAsync(string path, CancellationToken cancellationToken = default)
        => _migrator.MigrateAsync(path, cancellationToken);

    /// <summary>SaveAutosaveAsync 작업을 수행합니다.</summary>
    public Task SaveAutosaveAsync(
        WorkshopDocumentV5 document,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        return SaveAsync(AutosavePath(document.DocumentId), document, cancellationToken);
    }

    /// <summary>FindAutosavePathsAsync 작업을 수행합니다.</summary>
    public Task<string[]> FindAutosavePathsAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!Directory.Exists(_autosaveDirectory))
        {
            return Task.FromResult(Array.Empty<string>());
        }

        string[] paths = new DirectoryInfo(_autosaveDirectory)
            .EnumerateFiles("*.plcw", SearchOption.TopDirectoryOnly)
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .ThenBy(file => file.Name, StringComparer.Ordinal)
            .Select(file => file.FullName)
            .ToArray();
        return Task.FromResult(paths);
    }

    /// <summary>DeleteAutosaveAsync 작업을 수행합니다.</summary>
    public Task DeleteAutosaveAsync(string documentId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(documentId);
        cancellationToken.ThrowIfCancellationRequested();
        string path = AutosavePath(documentId);
        if (File.Exists(path))
        {
            File.Delete(path);
        }

        return Task.CompletedTask;
    }

    private string AutosavePath(string documentId)
    {
        string safeId = string.Concat(documentId.Select(
            character => Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        return Path.Combine(_autosaveDirectory, $"{safeId}.plcw");
    }
}
