using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Workbench;

public enum ValidationFreshness
{
    Stale,
    Running,
    Pass,
    Fail,
    Blocked,
}

/// <summary>편집 revision, undo/redo, 검증 수명을 한 곳에서 소유합니다.</summary>
public sealed class WorkbenchStore : IAsyncDisposable
{
    private readonly IValidationService _validationService;
    private readonly TimeSpan _validationDebounce;
    private readonly Stack<WorkshopDocumentV5> _undo = new();
    private readonly Stack<WorkshopDocumentV5> _redo = new();
    private CancellationTokenSource? _validationCancellation;
    private Task _validationTask = Task.CompletedTask;
    private bool _disposed;

    public WorkbenchStore(
        WorkshopDocumentV5 document,
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

    public WorkshopDocumentV5 Document { get; private set; }

    public ValidationFreshness ValidationFreshness { get; private set; }

    public ValidationResultV5? ValidationResult { get; private set; }

    public bool CanUndo => _undo.Count > 0;

    public bool CanRedo => _redo.Count > 0;

    public event EventHandler? Changed;

    public void UpdateDevice(string deviceId, Func<DeviceInstanceV5, DeviceInstanceV5> update)
    {
        ThrowIfDisposed();
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
        ArgumentNullException.ThrowIfNull(update);
        int index = Array.FindIndex(Document.Devices, device => device.Id == deviceId);
        if (index < 0)
        {
            throw new KeyNotFoundException($"장비를 찾을 수 없습니다: {deviceId}");
        }

        DeviceInstanceV5 original = Document.Devices[index];
        DeviceInstanceV5 updated = update(original);
        if (updated == original)
        {
            return;
        }

        DeviceInstanceV5[] devices = [.. Document.Devices];
        devices[index] = updated;
        Commit(Document with { Devices = devices });
    }

    public void UpdateConductor(string conductorId, Func<ConductorV5, ConductorV5> update)
    {
        ThrowIfDisposed();
        ArgumentException.ThrowIfNullOrWhiteSpace(conductorId);
        ArgumentNullException.ThrowIfNull(update);
        int index = Array.FindIndex(Document.Conductors, conductor => conductor.Id == conductorId);
        if (index < 0)
        {
            throw new KeyNotFoundException($"전선을 찾을 수 없습니다: {conductorId}");
        }

        ConductorV5 original = Document.Conductors[index];
        ConductorV5 updated = update(original);
        if (updated == original)
        {
            return;
        }

        ConductorV5[] conductors = [.. Document.Conductors];
        conductors[index] = updated;
        Commit(Document with { Conductors = conductors });
    }

    public void AddDevice(DeviceInstanceV5 device)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(device);
        if (Document.Devices.Any(item => item.Id == device.Id))
        {
            throw new InvalidOperationException($"중복 장비 ID입니다: {device.Id}");
        }

        Commit(Document with { Devices = [.. Document.Devices, device] });
    }

    public void AddConductor(ConductorV5 conductor)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(conductor);
        if (Document.Conductors.Any(item => item.Id == conductor.Id))
        {
            throw new InvalidOperationException($"중복 전선 ID입니다: {conductor.Id}");
        }

        Commit(Document with { Conductors = [.. Document.Conductors, conductor] });
    }

    public void RemoveDevice(string deviceId)
    {
        ThrowIfDisposed();
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
        if (!Document.Devices.Any(device => device.Id == deviceId))
        {
            throw new KeyNotFoundException($"장비를 찾을 수 없습니다: {deviceId}");
        }

        string[] removedConductorIds = Document.Conductors
            .Where(conductor => conductor.Start.DeviceId == deviceId || conductor.End.DeviceId == deviceId)
            .Select(conductor => conductor.Id)
            .ToArray();
        TerminalBridgeV5[] bridges = Document.TerminalBridges
            .Select(bridge => bridge with
            {
                Terminals = bridge.Terminals.Where(terminal => terminal.DeviceId != deviceId).ToArray(),
            })
            .Where(bridge => bridge.Terminals.Length >= 2)
            .ToArray();
        CableAssemblyV5[] cables = Document.CableAssemblies
            .Select(cable => cable with
            {
                ConductorIds = cable.ConductorIds.Except(removedConductorIds, StringComparer.Ordinal).ToArray(),
            })
            .ToArray();
        Commit(Document with
        {
            Devices = Document.Devices.Where(device => device.Id != deviceId).ToArray(),
            Conductors = Document.Conductors
                .Where(conductor => conductor.Start.DeviceId != deviceId && conductor.End.DeviceId != deviceId)
                .ToArray(),
            TerminalBridges = bridges,
            CableAssemblies = cables,
            TerminalAssemblies = Document.TerminalAssemblies
                .Where(assembly => assembly.DeviceId != deviceId)
                .ToArray(),
            PlcRuntimeBindings = Document.PlcRuntimeBindings
                .Where(binding => binding.DeviceId != deviceId)
                .ToArray(),
        });
    }

    public void RemoveConductor(string conductorId)
    {
        ThrowIfDisposed();
        ArgumentException.ThrowIfNullOrWhiteSpace(conductorId);
        if (!Document.Conductors.Any(conductor => conductor.Id == conductorId))
        {
            throw new KeyNotFoundException($"전선을 찾을 수 없습니다: {conductorId}");
        }

        Commit(Document with
        {
            Conductors = Document.Conductors.Where(conductor => conductor.Id != conductorId).ToArray(),
            CableAssemblies = Document.CableAssemblies
                .Select(cable => cable with
                {
                    ConductorIds = cable.ConductorIds
                        .Where(id => id != conductorId)
                        .ToArray(),
                })
                .ToArray(),
        });
    }

    public void AddTerminalBridge(TerminalBridgeV5 bridge)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(bridge);
        if (bridge.Terminals.Length < 2)
        {
            throw new ArgumentException("점퍼에는 두 개 이상의 단자가 필요합니다.", nameof(bridge));
        }

        if (Document.TerminalBridges.Any(item => item.Id == bridge.Id))
        {
            throw new InvalidOperationException($"중복 점퍼 ID입니다: {bridge.Id}");
        }

        Commit(Document with { TerminalBridges = [.. Document.TerminalBridges, bridge] });
    }

    public void UpdateViewDevicePosition(string viewId, string deviceId, PointV5 position)
    {
        ThrowIfDisposed();
        ArgumentException.ThrowIfNullOrWhiteSpace(viewId);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
        ArgumentNullException.ThrowIfNull(position);
        if (!Document.Devices.Any(device => device.Id == deviceId))
        {
            throw new KeyNotFoundException($"장비를 찾을 수 없습니다: {deviceId}");
        }

        var layouts = new Dictionary<string, ViewLayoutV5>(Document.ViewLayouts, StringComparer.Ordinal);
        var positions = layouts.TryGetValue(viewId, out ViewLayoutV5? layout)
            ? new Dictionary<string, PointV5>(layout.Positions, StringComparer.Ordinal)
            : new Dictionary<string, PointV5>(StringComparer.Ordinal);
        positions[deviceId] = position;
        layouts[viewId] = new ViewLayoutV5(positions);
        Commit(Document with { ViewLayouts = layouts });
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

    private void Commit(WorkshopDocumentV5 candidate)
    {
        _undo.Push(Document);
        _redo.Clear();
        RestoreAsNewRevision(candidate);
    }

    private void RestoreAsNewRevision(WorkshopDocumentV5 candidate)
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
        WorkshopDocumentV5 snapshot = Document;

        if (previous is not null)
        {
            previous.Cancel();
            previous.Dispose();
        }

        _validationTask = ValidateAfterDebounceAsync(snapshot, cancellationToken);
    }

    private async Task ValidateAfterDebounceAsync(
        WorkshopDocumentV5 snapshot,
        CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(_validationDebounce, cancellationToken).ConfigureAwait(false);
            ValidationFreshness = ValidationFreshness.Running;
            Changed?.Invoke(this, EventArgs.Empty);
            ValidationResultV5 result = await _validationService
                .ValidateAsync(snapshot, cancellationToken)
                .ConfigureAwait(false);

            if (result.Revision == Document.Revision
                && string.Equals(result.ContentHash, Document.ContentHash, StringComparison.Ordinal))
            {
                ValidationResult = result;
                ValidationFreshness = result.Issues.Any(issue => issue.Blocking)
                    ? ValidationFreshness.Blocked
                    : result.Issues.Any(issue => issue.Severity == ValidationSeverity.Error)
                        ? ValidationFreshness.Fail
                        : ValidationFreshness.Pass;
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
