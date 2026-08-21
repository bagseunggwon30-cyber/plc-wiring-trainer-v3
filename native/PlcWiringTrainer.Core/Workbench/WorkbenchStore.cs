using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Workbench;

public enum ValidationFreshness
{
    Stale,
    Running,
    Current,
}

/// <summary>편집 revision, undo/redo, 검증 수명을 한 곳에서 소유합니다.</summary>
public sealed class WorkbenchStore : IAsyncDisposable
{
    private readonly IValidationService _validationService;
    private readonly TimeSpan _validationDebounce;
    private readonly Stack<WorkshopDocumentV4> _undo = new();
    private readonly Stack<WorkshopDocumentV4> _redo = new();
    private CancellationTokenSource? _validationCancellation;
    private Task _validationTask = Task.CompletedTask;
    private bool _disposed;

    public WorkbenchStore(
        WorkshopDocumentV4 document,
        IValidationService validationService,
        TimeSpan? validationDebounce = null)
    {
        ArgumentNullException.ThrowIfNull(document);
        _validationService = validationService ?? throw new ArgumentNullException(nameof(validationService));
        _validationDebounce = validationDebounce ?? TimeSpan.FromMilliseconds(300);
        Document = DocumentHasher.WithContentHash(document);
        ValidationFreshness = ValidationFreshness.Stale;
        ScheduleValidation();
    }

    public WorkshopDocumentV4 Document { get; private set; }

    public ValidationFreshness ValidationFreshness { get; private set; }

    public ValidationResultV4? ValidationResult { get; private set; }

    public bool CanUndo => _undo.Count > 0;

    public bool CanRedo => _redo.Count > 0;

    public event EventHandler? Changed;

    public void UpdateDevice(string deviceId, Func<DeviceInstanceV4, DeviceInstanceV4> update)
    {
        ThrowIfDisposed();
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
        ArgumentNullException.ThrowIfNull(update);
        int index = Array.FindIndex(Document.Devices, device => device.Id == deviceId);
        if (index < 0)
        {
            throw new KeyNotFoundException($"장비를 찾을 수 없습니다: {deviceId}");
        }

        DeviceInstanceV4[] devices = [.. Document.Devices];
        devices[index] = update(devices[index]);
        Commit(Document with { Devices = devices });
    }

    public void UpdateConductor(string conductorId, Func<ConductorV4, ConductorV4> update)
    {
        ThrowIfDisposed();
        ArgumentException.ThrowIfNullOrWhiteSpace(conductorId);
        ArgumentNullException.ThrowIfNull(update);
        int index = Array.FindIndex(Document.Conductors, conductor => conductor.Id == conductorId);
        if (index < 0)
        {
            throw new KeyNotFoundException($"전선을 찾을 수 없습니다: {conductorId}");
        }

        ConductorV4[] conductors = [.. Document.Conductors];
        conductors[index] = update(conductors[index]);
        Commit(Document with { Conductors = conductors });
    }

    public void AddDevice(DeviceInstanceV4 device)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(device);
        if (Document.Devices.Any(item => item.Id == device.Id))
        {
            throw new InvalidOperationException($"중복 장비 ID입니다: {device.Id}");
        }

        Commit(Document with { Devices = [.. Document.Devices, device] });
    }

    public void AddConductor(ConductorV4 conductor)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(conductor);
        if (Document.Conductors.Any(item => item.Id == conductor.Id))
        {
            throw new InvalidOperationException($"중복 전선 ID입니다: {conductor.Id}");
        }

        Commit(Document with { Conductors = [.. Document.Conductors, conductor] });
    }

    public bool Undo()
    {
        ThrowIfDisposed();
        if (_undo.Count == 0)
        {
            return false;
        }

        _redo.Push(Document);
        RestoreAsNewRevision(_undo.Pop());
        return true;
    }

    public bool Redo()
    {
        ThrowIfDisposed();
        if (_redo.Count == 0)
        {
            return false;
        }

        _undo.Push(Document);
        RestoreAsNewRevision(_redo.Pop());
        return true;
    }

    public Task WaitForValidationAsync()
    {
        ThrowIfDisposed();
        return _validationTask;
    }

    public void Revalidate()
    {
        ThrowIfDisposed();
        ValidationResult = null;
        ValidationFreshness = ValidationFreshness.Stale;
        ScheduleValidation();
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_validationCancellation is not null)
        {
            await _validationCancellation.CancelAsync().ConfigureAwait(false);
            _validationCancellation.Dispose();
        }

        try
        {
            await _validationTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void Commit(WorkshopDocumentV4 candidate)
    {
        _undo.Push(Document);
        _redo.Clear();
        RestoreAsNewRevision(candidate);
    }

    private void RestoreAsNewRevision(WorkshopDocumentV4 candidate)
    {
        Document = DocumentHasher.WithContentHash(candidate with { Revision = Document.Revision + 1 });
        ValidationResult = null;
        ValidationFreshness = ValidationFreshness.Stale;
        ScheduleValidation();
        Changed?.Invoke(this, EventArgs.Empty);
    }

    private void ScheduleValidation()
    {
        CancellationTokenSource? previous = _validationCancellation;
        _validationCancellation = new CancellationTokenSource();
        CancellationToken cancellationToken = _validationCancellation.Token;
        WorkshopDocumentV4 snapshot = Document;

        if (previous is not null)
        {
            previous.Cancel();
            previous.Dispose();
        }

        _validationTask = ValidateAfterDebounceAsync(snapshot, cancellationToken);
    }

    private async Task ValidateAfterDebounceAsync(
        WorkshopDocumentV4 snapshot,
        CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(_validationDebounce, cancellationToken).ConfigureAwait(false);
            ValidationFreshness = ValidationFreshness.Running;
            Changed?.Invoke(this, EventArgs.Empty);
            ValidationResultV4 result = await _validationService
                .ValidateAsync(snapshot, cancellationToken)
                .ConfigureAwait(false);

            if (result.Revision == Document.Revision
                && string.Equals(result.ContentHash, Document.ContentHash, StringComparison.Ordinal))
            {
                ValidationResult = result;
                ValidationFreshness = ValidationFreshness.Current;
                Changed?.Invoke(this, EventArgs.Empty);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }
}
