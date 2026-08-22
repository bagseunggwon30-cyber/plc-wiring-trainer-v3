using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Wiring;
using PlcWiringTrainer.Core.Workbench;

namespace PlcWiringTrainer.App.Workbench;

internal sealed record AutosaveRecoveryCandidate(
    string Path,
    WorkshopDocumentV5 Document,
    DateTime LastWriteTimeUtc);

/// <summary>열린 문서와 자동 복구 작업의 수명을 UI 요소에서 분리해 관리합니다.</summary>
internal sealed class DocumentSessionController : IAsyncDisposable
{
    private readonly DeviceProfileCatalog _catalog;
    private readonly WorkshopDocumentRepository _repository;
    private readonly IConnectionAssessmentService _connectionAssessmentService;
    private CancellationTokenSource? _autosaveCancellation;
    private Task _autosaveTask = Task.CompletedTask;
    private WorkbenchStore? _store;
    private int _lastAutosaveRevision;

    public DocumentSessionController(
        DeviceProfileCatalog catalog,
        WorkshopDocumentRepository repository,
        IConnectionAssessmentService connectionAssessmentService)
    {
        _catalog = catalog;
        _repository = repository;
        _connectionAssessmentService = connectionAssessmentService;
    }

    public WorkbenchStore Store
        => _store ?? throw new InvalidOperationException("작업 문서가 초기화되지 않았습니다.");

    public string? CurrentPath { get; private set; }

    public event EventHandler? Changed;

    public event EventHandler<string>? AutosaveFailed;

    public void Initialize(WorkshopDocumentV5 document)
    {
        if (_store is not null)
        {
            throw new InvalidOperationException("문서 세션이 이미 초기화되었습니다.");
        }

        Attach(document);
    }

    public async Task ReplaceAsync(WorkshopDocumentV5 document, string? currentPath = null)
    {
        await StopAutosaveAsync();
        WorkbenchStore? previous = _store;
        if (previous is not null)
        {
            previous.Changed -= Store_Changed;
        }

        Attach(document);
        CurrentPath = currentPath;
        if (previous is not null)
        {
            await previous.DisposeAsync();
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    public Task<MigrationResult> LoadAsync(string path, CancellationToken cancellationToken = default)
        => _repository.LoadAsync(path, cancellationToken);

    public async Task SaveAsync(string path, CancellationToken cancellationToken = default)
    {
        await _repository.SaveAsync(path, Store.Document, cancellationToken);
        CurrentPath = path;
    }

    public async Task<AutosaveRecoveryCandidate[]> FindRecoveryCandidatesAsync(
        CancellationToken cancellationToken = default)
    {
        string[] paths = await _repository.FindAutosavePathsAsync(cancellationToken);
        var candidates = new List<AutosaveRecoveryCandidate>();
        foreach (string path in paths)
        {
            MigrationResult result = await _repository.LoadAsync(path, cancellationToken);
            if (result.Document is not null)
            {
                candidates.Add(new AutosaveRecoveryCandidate(
                    path,
                    result.Document,
                    File.GetLastWriteTimeUtc(path)));
            }
        }

        return [.. candidates.OrderByDescending(candidate => candidate.LastWriteTimeUtc)];
    }

    public Task DiscardRecoveryAsync(string documentId, CancellationToken cancellationToken = default)
        => _repository.DeleteAutosaveAsync(documentId, cancellationToken);

    public async ValueTask DisposeAsync()
    {
        await StopAutosaveAsync();
        if (_store is not null)
        {
            _store.Changed -= Store_Changed;
            await _store.DisposeAsync();
            _store = null;
        }
    }

    private void Attach(WorkshopDocumentV5 document)
    {
        _store = new WorkbenchStore(
            document,
            new CircuitValidationService(_catalog),
            _connectionAssessmentService);
        _store.Changed += Store_Changed;
        _lastAutosaveRevision = 0;
    }

    private void Store_Changed(object? sender, EventArgs e)
    {
        WorkshopDocumentV5 document = Store.Document;
        if (document.Revision != _lastAutosaveRevision)
        {
            _lastAutosaveRevision = document.Revision;
            ScheduleAutosave(document);
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    private void ScheduleAutosave(WorkshopDocumentV5 snapshot)
    {
        CancelAutosave();
        _autosaveCancellation = new CancellationTokenSource();
        _autosaveTask = AutosaveAfterDelayAsync(snapshot, _autosaveCancellation.Token);
    }

    private async Task AutosaveAfterDelayAsync(WorkshopDocumentV5 snapshot, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(700, cancellationToken);
            await _repository.SaveAutosaveAsync(snapshot, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            AutosaveFailed?.Invoke(this, exception.Message);
        }
    }

    private void CancelAutosave()
    {
        _autosaveCancellation?.Cancel();
        _autosaveCancellation?.Dispose();
        _autosaveCancellation = null;
    }

    private async Task StopAutosaveAsync()
    {
        CancelAutosave();
        try
        {
            await _autosaveTask;
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            _autosaveTask = Task.CompletedTask;
        }
    }
}
