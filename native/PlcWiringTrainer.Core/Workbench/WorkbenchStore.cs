using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Wiring;

namespace PlcWiringTrainer.Core.Workbench;

/// <summary>ValidationFreshness 값의 종류를 정의합니다.</summary>
public enum ValidationFreshness
{
    /// <summary>Stale 상태를 나타냅니다.</summary>
    Stale,
    /// <summary>Running 상태를 나타냅니다.</summary>
    Running,
    /// <summary>Pass 상태를 나타냅니다.</summary>
    Pass,
    /// <summary>Fail 상태를 나타냅니다.</summary>
    Fail,
    /// <summary>Blocked 상태를 나타냅니다.</summary>
    Blocked,
}

/// <summary>편집 revision, undo/redo, 검증 수명을 한 곳에서 소유합니다.</summary>
public sealed class WorkbenchStore : IAsyncDisposable
{
    private readonly IValidationService _validationService;
    private readonly IConnectionAssessmentService _connectionAssessmentService;
    private readonly TimeSpan _validationDebounce;
    private readonly Stack<WorkshopDocumentV5> _undo = new();
    private readonly Stack<WorkshopDocumentV5> _redo = new();
    private CancellationTokenSource? _validationCancellation;
    private Task _validationTask = Task.CompletedTask;
    private bool _disposed;

    /// <summary>WorkbenchStore 작업을 수행합니다.</summary>
    public WorkbenchStore(
        WorkshopDocumentV5 document,
        IValidationService validationService,
        TimeSpan? validationDebounce = null)
        : this(
            document,
            validationService,
            new ConnectionAssessmentService(DeviceProfileCatalog.CreateDefault()),
            validationDebounce)
    {
    }

    /// <summary>WorkbenchStore 작업을 수행합니다.</summary>
    public WorkbenchStore(
        WorkshopDocumentV5 document,
        IValidationService validationService,
        IConnectionAssessmentService connectionAssessmentService,
        TimeSpan? validationDebounce = null)
    {
        ArgumentNullException.ThrowIfNull(document);
        _validationService = validationService ?? throw new ArgumentNullException(nameof(validationService));
        _connectionAssessmentService = connectionAssessmentService
            ?? throw new ArgumentNullException(nameof(connectionAssessmentService));
        _validationDebounce = validationDebounce ?? TimeSpan.FromMilliseconds(300);
        Document = DocumentHasher.WithContentHash(document);
        ValidationFreshness = ValidationFreshness.Stale;
        ScheduleValidation();
    }

    /// <summary>현재 revision과 canonical hash가 반영된 읽기 전용 문서 스냅샷입니다.</summary>
    public WorkshopDocumentV5 Document { get; private set; }

    /// <summary>ValidationFreshness 값을 제공합니다.</summary>
    public ValidationFreshness ValidationFreshness { get; private set; }

    /// <summary>현재 문서와 revision/hash가 일치할 때만 게시된 마지막 검증 결과입니다.</summary>
    public ValidationResultV5? ValidationResult { get; private set; }

    /// <summary>현재 revision의 검증 실행 자체가 실패했을 때 표시할 오류입니다.</summary>
    public string? ValidationError { get; private set; }

    /// <summary>CanUndo 값을 제공합니다.</summary>
    public bool CanUndo => _undo.Count > 0;

    /// <summary>CanRedo 값을 제공합니다.</summary>
    public bool CanRedo => _redo.Count > 0;

    /// <summary>Changed 값을 제공합니다.</summary>
    public event EventHandler? Changed;

    /// <summary>UpdateDevice 작업을 수행합니다.</summary>
    public void UpdateDevice(string deviceId, Func<DeviceInstanceV5, DeviceInstanceV5> update)
        => TryUpdateDevice(deviceId, update, static _ => true);

    /// <summary>candidate 전체 문서가 추가 안전 조건을 통과할 때만 장비 편집을 원자적으로 반영합니다.</summary>
    public bool TryUpdateDevice(
        string deviceId,
        Func<DeviceInstanceV5, DeviceInstanceV5> update,
        Func<WorkshopDocumentV5, bool> candidateGuard)
    {
        ThrowIfDisposed();
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
        ArgumentNullException.ThrowIfNull(update);
        ArgumentNullException.ThrowIfNull(candidateGuard);
        int index = Array.FindIndex(Document.Devices, device => device.Id == deviceId);
        if (index < 0)
        {
            throw new KeyNotFoundException($"장비를 찾을 수 없습니다: {deviceId}");
        }

        DeviceInstanceV5 original = Document.Devices[index];
        DeviceInstanceV5 updated = update(original);
        if (updated == original)
        {
            return true;
        }

        DeviceInstanceV5[] devices = [.. Document.Devices];
        devices[index] = updated;
        WorkshopDocumentV5 candidate = Document with { Devices = devices };
        if (!candidateGuard(candidate))
        {
            return false;
        }

        Commit(candidate);
        return true;
    }

    /// <summary>UpdateConductor 작업을 수행합니다.</summary>
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

        if (updated.Id != original.Id)
        {
            throw new InvalidOperationException("전선 ID는 편집할 수 없습니다.");
        }

        if (updated.Start != original.Start || updated.End != original.End)
        {
            throw new InvalidOperationException("끝단 변경에는 ReconnectConductor를 사용해야 합니다.");
        }

        ConductorV5[] conductors = [.. Document.Conductors];
        conductors[index] = updated;
        Commit(Document with { Conductors = conductors });
    }

    /// <summary>AddDevice 작업을 수행합니다.</summary>
    public void AddDevice(DeviceInstanceV5 device)
        => TryAddDevice(device, static _ => true);

    /// <summary>장비를 포함한 candidate 문서가 guard를 통과할 때만 한 undo 단계로 추가합니다.</summary>
    public bool TryAddDevice(
        DeviceInstanceV5 device,
        Func<WorkshopDocumentV5, bool> candidateGuard)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(device);
        ArgumentNullException.ThrowIfNull(candidateGuard);
        if (Document.Devices.Any(item => item.Id == device.Id))
        {
            throw new InvalidOperationException($"중복 장비 ID입니다: {device.Id}");
        }

        WorkshopDocumentV5 candidate = Document with { Devices = [.. Document.Devices, device] };
        if (!candidateGuard(candidate))
        {
            return false;
        }

        Commit(candidate);
        return true;
    }

    /// <summary>candidate 문서를 사전판정한 뒤 허용 또는 경고인 경우에만 전선을 한 undo 단계로 추가합니다.</summary>
    /// <returns>차단 결과이면 문서, revision, hash, autosave와 undo 기록은 바뀌지 않습니다.</returns>
    public ConnectionAssessmentV5 AddConductor(ConductorV5 conductor)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(conductor);
        if (Document.Conductors.Any(item => item.Id == conductor.Id))
        {
            throw new InvalidOperationException($"중복 전선 ID입니다: {conductor.Id}");
        }

        ConnectionAssessmentV5 assessment = _connectionAssessmentService.AssessConductor(Document, conductor);
        ConductorV5 committed = ApplyConnectionAssessment(conductor, assessment);
        CommitAssessedCandidate(
            assessment,
            document => document with { Conductors = [.. document.Conductors, committed] });
        return assessment;
    }

    /// <summary>기존 전선을 점유량 계산에서 제외한 candidate로 재판정하고 끝단만 원자적으로 변경합니다.</summary>
    /// <returns>차단 결과이면 기존 끝단과 경로 및 모든 편집 이력이 그대로 유지됩니다.</returns>
    public ConnectionAssessmentV5 ReconnectConductor(
        string conductorId,
        bool reconnectStart,
        TerminalRefV5 terminal)
    {
        ThrowIfDisposed();
        ArgumentException.ThrowIfNullOrWhiteSpace(conductorId);
        ArgumentNullException.ThrowIfNull(terminal);
        int index = Array.FindIndex(Document.Conductors, conductor => conductor.Id == conductorId);
        if (index < 0)
        {
            throw new KeyNotFoundException($"전선을 찾을 수 없습니다: {conductorId}");
        }

        ConductorV5 original = Document.Conductors[index];
        ConductorV5 candidate = reconnectStart
            ? original with { Start = terminal }
            : original with { End = terminal };
        if (candidate == original)
        {
            return new ConnectionAssessmentV5(
                ConnectionDispositionV5.Allowed,
                "CONNECTION_UNCHANGED",
                "전선 끝단이 변경되지 않았습니다.",
                candidate.Start,
                candidate.End);
        }

        ConnectionAssessmentV5 assessment = _connectionAssessmentService.AssessConductor(
            Document,
            candidate,
            conductorId);
        ConductorV5[] conductors = [.. Document.Conductors];
        conductors[index] = ApplyConnectionAssessment(candidate, assessment);
        CommitAssessedCandidate(
            assessment,
            document => document with { Conductors = conductors });
        return assessment;
    }

    private static ConductorV5 ApplyConnectionAssessment(
        ConductorV5 conductor,
        ConnectionAssessmentV5 assessment)
        => conductor with
        {
            Color = conductor.ManualColor ? conductor.Color : assessment.SuggestedColor,
            DiagnosticOverride = conductor.DiagnosticOverride || assessment.RequiresDiagnosticOverride,
        };

    /// <summary>잠기지 않은 전선 경로만 한 revision과 undo 단계로 교체합니다.</summary>
    public void ReplaceUnlockedRoutes(IReadOnlyDictionary<string, PointV5[]> routes)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(routes);
        bool changed = false;
        ConductorV5[] conductors = Document.Conductors
            .Select(conductor =>
            {
                if (conductor.RouteLocked
                    || !routes.TryGetValue(conductor.Id, out PointV5[]? waypoints)
                    || conductor.Waypoints.SequenceEqual(waypoints))
                {
                    return conductor;
                }

                changed = true;
                return conductor with { Waypoints = [.. waypoints] };
            })
            .ToArray();
        if (changed)
        {
            Commit(Document with { Conductors = conductors });
        }
    }

    /// <summary>RemoveDevice 작업을 수행합니다.</summary>
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
                DrainConductorId = cable.DrainConductorId is not null
                    && removedConductorIds.Contains(cable.DrainConductorId, StringComparer.Ordinal)
                        ? null
                        : cable.DrainConductorId,
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

    /// <summary>RemoveConductor 작업을 수행합니다.</summary>
    public void RemoveConductor(string conductorId)
    {
        ThrowIfDisposed();
        ArgumentException.ThrowIfNullOrWhiteSpace(conductorId);
        RemoveConductors([conductorId]);
    }

    /// <summary>여러 전선을 하나의 revision과 undo 단계로 원자적으로 삭제합니다.</summary>
    public void RemoveConductors(IReadOnlyCollection<string> conductorIds)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(conductorIds);
        var ids = new HashSet<string>(conductorIds, StringComparer.Ordinal);
        if (ids.Count == 0)
        {
            return;
        }

        string[] missing = ids.Where(id => !Document.Conductors.Any(conductor => conductor.Id == id)).ToArray();
        if (missing.Length > 0)
        {
            throw new KeyNotFoundException($"전선을 찾을 수 없습니다: {string.Join(", ", missing)}");
        }

        Commit(Document with
        {
            Conductors = Document.Conductors.Where(conductor => !ids.Contains(conductor.Id)).ToArray(),
            CableAssemblies = Document.CableAssemblies
                .Select(cable => cable with
                {
                    ConductorIds = cable.ConductorIds
                        .Where(id => !ids.Contains(id))
                        .ToArray(),
                    DrainConductorId = cable.DrainConductorId is not null && ids.Contains(cable.DrainConductorId)
                        ? null
                        : cable.DrainConductorId,
                })
                .ToArray(),
        });
    }

    /// <summary>여러 전선의 공통 속성을 하나의 revision과 undo 단계로 변경합니다.</summary>
    public void UpdateConductors(
        IReadOnlyCollection<string> conductorIds,
        Func<ConductorV5, ConductorV5> update)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(conductorIds);
        ArgumentNullException.ThrowIfNull(update);
        var ids = new HashSet<string>(conductorIds, StringComparer.Ordinal);
        if (ids.Count == 0)
        {
            return;
        }

        string[] missing = ids.Where(id => !Document.Conductors.Any(conductor => conductor.Id == id)).ToArray();
        if (missing.Length > 0)
        {
            throw new KeyNotFoundException($"전선을 찾을 수 없습니다: {string.Join(", ", missing)}");
        }

        bool changed = false;
        ConductorV5[] conductors = Document.Conductors.Select(conductor =>
        {
            if (!ids.Contains(conductor.Id))
            {
                return conductor;
            }

            ConductorV5 edited = update(conductor);
            if (edited.Id != conductor.Id || edited.Start != conductor.Start || edited.End != conductor.End)
            {
                throw new InvalidOperationException("일괄 속성 편집으로 전선 ID나 끝단을 변경할 수 없습니다.");
            }

            changed |= edited != conductor;
            return edited;
        }).ToArray();
        if (changed)
        {
            Commit(Document with { Conductors = conductors });
        }
    }

    /// <summary>모든 단자 쌍의 전기 위험과 conductor/bridge 합산 점유량을 판정한 뒤 점퍼를 추가합니다.</summary>
    /// <returns>차단 결과이면 문서와 편집 이력은 바뀌지 않습니다.</returns>
    public ConnectionAssessmentV5 AddTerminalBridge(TerminalBridgeV5 bridge)
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

        if (bridge.Terminals.Distinct().Count() != bridge.Terminals.Length)
        {
            throw new ArgumentException("같은 단자를 한 점퍼에 두 번 넣을 수 없습니다.", nameof(bridge));
        }

        ConnectionAssessmentV5 assessment = _connectionAssessmentService.AssessBridge(Document, bridge);
        TerminalBridgeV5 committed = bridge with
        {
            DiagnosticOverride = bridge.DiagnosticOverride || assessment.RequiresDiagnosticOverride,
        };
        CommitAssessedCandidate(
            assessment,
            document => document with { TerminalBridges = [.. document.TerminalBridges, committed] });
        return assessment;
    }

    /// <summary>UpdateViewDevicePosition 작업을 수행합니다.</summary>
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

    /// <summary>Undo 작업을 수행합니다.</summary>
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

    /// <summary>Redo 작업을 수행합니다.</summary>
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

    /// <summary>WaitForValidationAsync 작업을 수행합니다.</summary>
    public Task WaitForValidationAsync()
    {
        ThrowIfDisposed();
        return _validationTask;
    }

    /// <summary>Revalidate 작업을 수행합니다.</summary>
    public void Revalidate()
    {
        ThrowIfDisposed();
        ValidationResult = null;
        ValidationError = null;
        ValidationFreshness = ValidationFreshness.Stale;
        ScheduleValidation();
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>DisposeAsync 작업을 수행합니다.</summary>
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

    private bool CommitAssessedCandidate(
        ConnectionAssessmentV5 assessment,
        Func<WorkshopDocumentV5, WorkshopDocumentV5> update)
    {
        if (assessment.Disposition == ConnectionDispositionV5.Blocked)
        {
            return false;
        }

        Commit(update(Document));
        return true;
    }

    private void RestoreAsNewRevision(WorkshopDocumentV5 candidate)
    {
        Document = DocumentHasher.WithContentHash(candidate with { Revision = Document.Revision + 1 });
        ValidationResult = null;
        ValidationError = null;
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
                ValidationError = null;
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
        catch (Exception exception)
        {
            if (snapshot.Revision == Document.Revision
                && string.Equals(snapshot.ContentHash, Document.ContentHash, StringComparison.Ordinal))
            {
                ValidationResult = null;
                ValidationError = exception.Message;
                ValidationFreshness = ValidationFreshness.Fail;
                Changed?.Invoke(this, EventArgs.Empty);
            }
        }
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }
}
