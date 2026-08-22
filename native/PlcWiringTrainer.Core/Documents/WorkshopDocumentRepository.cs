using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;

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
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _autosaveGates = new(StringComparer.Ordinal);

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
            byte[] bytes = new UTF8Encoding(false).GetBytes(WorkshopDocumentSerializer.Serialize(normalized));
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                64 * 1024,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                stream.Flush(flushToDisk: true);
            }

            string persistedJson = await File.ReadAllTextAsync(
                temporaryPath,
                Encoding.UTF8,
                cancellationToken).ConfigureAwait(false);
            WorkshopDocumentV5 persisted = WorkshopDocumentSerializer.Deserialize(persistedJson, verifyHash: true);
            if (!string.Equals(persisted.ContentHash, normalized.ContentHash, StringComparison.Ordinal))
            {
                throw new InvalidDataException("디스크에 기록한 문서의 canonical hash가 저장 후보와 일치하지 않습니다.");
            }

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
    public async Task<MigrationResult> LoadAsync(string path, CancellationToken cancellationToken = default)
    {
        MigrationResult result = await _migrator.MigrateAsync(path, cancellationToken).ConfigureAwait(false);
        if (result.Status == MigrationStatus.Quarantined && IsAutosavePath(path) && File.Exists(path))
        {
            File.Delete(path);
        }

        return result;
    }

    /// <summary>SaveAutosaveAsync 작업을 수행합니다.</summary>
    public async Task SaveAutosaveAsync(
        WorkshopDocumentV5 document,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        string path = AutosavePath(document.DocumentId);
        SemaphoreSlim gate = _autosaveGates.GetOrAdd(document.DocumentId, static _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (await ReadAutosaveRevisionAsync(path, cancellationToken).ConfigureAwait(false) > document.Revision)
            {
                return;
            }

            await SaveAsync(path, document, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
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

    private static async Task<int> ReadAutosaveRevisionAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            return -1;
        }

        try
        {
            string json = await File.ReadAllTextAsync(path, Encoding.UTF8, cancellationToken).ConfigureAwait(false);
            return WorkshopDocumentSerializer.Deserialize(json, verifyHash: true).Revision;
        }
        catch (Exception exception) when (exception is JsonException or InvalidDataException)
        {
            return -1;
        }
    }

    private bool IsAutosavePath(string path)
    {
        string fullPath = Path.GetFullPath(path);
        string root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(_autosaveDirectory));
        return string.Equals(Path.GetDirectoryName(fullPath), root, StringComparison.OrdinalIgnoreCase);
    }
}
