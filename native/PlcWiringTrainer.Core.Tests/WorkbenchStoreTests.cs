using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Wiring;
using PlcWiringTrainer.Core.Workbench;

namespace PlcWiringTrainer.Core.Tests;

public sealed class WorkbenchStoreTests
{
    [Fact]
    public async Task EditMarksValidationStaleAndUndoRedoOwnTheRevision()
    {
        var validator = new CircuitValidationService(DeviceProfileCatalog.CreateDefault());
        await using var store = new WorkbenchStore(
            TestDocuments.WithLamp(),
            validator,
            TimeSpan.FromMilliseconds(5));
        int initialRevision = store.Document.Revision;

        store.UpdateDevice("lamp-1", device => device with { X = 275 });

        Assert.Equal(initialRevision + 1, store.Document.Revision);
        Assert.Equal(ValidationFreshness.Stale, store.ValidationFreshness);
        Assert.True(store.CanUndo);
        await store.WaitForValidationAsync();
        Assert.Equal(ValidationFreshness.Pass, store.ValidationFreshness);
        Assert.Equal(store.Document.ContentHash, store.ValidationResult!.ContentHash);

        Assert.True(store.Undo());
        Assert.Equal(initialRevision + 2, store.Document.Revision);
        Assert.Equal(100, store.Document.Devices.Single(device => device.Id == "lamp-1").X);
        Assert.True(store.Redo());
        Assert.Equal(initialRevision + 3, store.Document.Revision);
        Assert.Equal(275, store.Document.Devices.Single(device => device.Id == "lamp-1").X);
    }

    [Fact]
    public async Task BlockedReconnectDoesNotConsumeRevisionOrUndo()
    {
        DeviceProfileCatalog catalog = DeviceProfileCatalog.CreateDefault();
        WorkshopDocumentV5 document = TestDocuments.WithLamp() with { Mode = WorkshopMode.Prewire };
        await using var store = new WorkbenchStore(
            document,
            new CircuitValidationService(catalog),
            new ConnectionAssessmentService(catalog),
            TimeSpan.Zero);
        int revision = store.Document.Revision;

        ConnectionAssessmentV5 result = store.ReconnectConductor(
            "lamp-positive",
            reconnectStart: false,
            new TerminalRefV5("supply", "0V"));

        Assert.Equal(ConnectionDispositionV5.Blocked, result.Disposition);
        Assert.Equal(revision, store.Document.Revision);
        Assert.False(store.CanUndo);
        Assert.Equal(new TerminalRefV5("lamp-1", "A1"), store.Document.Conductors[0].End);
    }

    [Fact]
    public async Task RemovingDrainConductorClearsCableReferenceAndMembership()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp();
        string drainId = document.Conductors[0].Id;
        document = DocumentHasher.WithContentHash(document with
        {
            CableAssemblies =
            [
                new CableAssemblyV5(
                    "cable-1",
                    "C1",
                    document.Conductors.Select(conductor => conductor.Id).ToArray(),
                    "shielded",
                    1000,
                    true,
                    drainId,
                    []),
            ],
        });
        await using var store = new WorkbenchStore(
            document,
            new CircuitValidationService(DeviceProfileCatalog.CreateDefault()),
            TimeSpan.Zero);

        store.RemoveConductor(drainId);

        CableAssemblyV5 cable = Assert.Single(store.Document.CableAssemblies);
        Assert.Null(cable.DrainConductorId);
        Assert.DoesNotContain(drainId, cable.ConductorIds);
    }

    [Fact]
    public async Task DuplicateTerminalInBridgeIsRejectedWithoutRevision()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp();
        await using var store = new WorkbenchStore(
            document,
            new CircuitValidationService(DeviceProfileCatalog.CreateDefault()),
            TimeSpan.Zero);
        int revision = store.Document.Revision;
        var terminal = new TerminalRefV5("supply", "+24V");

        Assert.Throws<ArgumentException>(() => store.AddTerminalBridge(
            new TerminalBridgeV5("duplicate", [terminal, terminal], "#EF4444")));
        Assert.Equal(revision, store.Document.Revision);
        Assert.False(store.CanUndo);
    }

    [Fact]
    public async Task BatchRouteCleanupUpdatesOnlyUnlockedWiresInOneRevision()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp();
        ConductorV5 locked = document.Conductors[1] with
        {
            RouteLocked = true,
            Waypoints = [new PointV5(10, 10)],
        };
        document = DocumentHasher.WithContentHash(document with
        {
            Conductors = [document.Conductors[0], locked],
        });
        await using var store = new WorkbenchStore(
            document,
            new CircuitValidationService(DeviceProfileCatalog.CreateDefault()),
            TimeSpan.Zero);

        store.ReplaceUnlockedRoutes(new Dictionary<string, PointV5[]>
        {
            [document.Conductors[0].Id] = [new PointV5(40, 40)],
            [locked.Id] = [new PointV5(99, 99)],
        });

        Assert.Equal(document.Revision + 1, store.Document.Revision);
        Assert.Equal([new PointV5(40, 40)], store.Document.Conductors[0].Waypoints);
        Assert.Equal([new PointV5(10, 10)], store.Document.Conductors[1].Waypoints);
        Assert.True(store.Undo());
        Assert.Empty(store.Document.Conductors[0].Waypoints);
    }

    [Fact]
    public async Task BatchWirePropertyEditAndDeleteEachConsumeOneUndoStep()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp();
        string[] ids = document.Conductors.Select(conductor => conductor.Id).ToArray();
        await using var store = new WorkbenchStore(
            document,
            new CircuitValidationService(DeviceProfileCatalog.CreateDefault()),
            TimeSpan.Zero);

        store.UpdateConductors(ids, conductor => WireRouteEditor.ChangeColor(conductor, "#F97316"));

        Assert.Equal(document.Revision + 1, store.Document.Revision);
        Assert.All(store.Document.Conductors, conductor =>
        {
            Assert.Equal("#F97316", conductor.Color);
            Assert.True(conductor.ManualColor);
        });
        Assert.True(store.Undo());
        Assert.Equal(document.Conductors.Select(conductor => conductor.Color), store.Document.Conductors.Select(conductor => conductor.Color));

        int revisionBeforeDelete = store.Document.Revision;
        store.RemoveConductors(ids);

        Assert.Empty(store.Document.Conductors);
        Assert.Equal(revisionBeforeDelete + 1, store.Document.Revision);
        Assert.True(store.Undo());
        Assert.Equal(document.Conductors.Length, store.Document.Conductors.Length);
    }

    [Fact]
    public async Task ReconnectRecomputesAutomaticColorButPreservesManualOverride()
    {
        WorkshopDocumentV5 original = TestDocuments.WithLamp();
        ConductorV5 automatic = original.Conductors[0] with { ManualColor = false, Color = "#EF4444" };
        original = DocumentHasher.WithContentHash(original with { Conductors = [automatic] });
        await using var automaticStore = new WorkbenchStore(
            original,
            new CircuitValidationService(DeviceProfileCatalog.CreateDefault()),
            TimeSpan.Zero);

        automaticStore.ReconnectConductor(
            automatic.Id,
            reconnectStart: true,
            new TerminalRefV5("supply", "0V"));

        Assert.Equal("#3B82F6", Assert.Single(automaticStore.Document.Conductors).Color);

        ConductorV5 manual = automatic with { ManualColor = true, Color = "#F97316" };
        WorkshopDocumentV5 manualDocument = DocumentHasher.WithContentHash(original with { Conductors = [manual] });
        await using var manualStore = new WorkbenchStore(
            manualDocument,
            new CircuitValidationService(DeviceProfileCatalog.CreateDefault()),
            TimeSpan.Zero);

        manualStore.ReconnectConductor(
            manual.Id,
            reconnectStart: true,
            new TerminalRefV5("supply", "0V"));

        Assert.Equal("#F97316", Assert.Single(manualStore.Document.Conductors).Color);
    }
}
