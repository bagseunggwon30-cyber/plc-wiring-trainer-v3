using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;
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
        Assert.Equal(ValidationFreshness.Current, store.ValidationFreshness);
        Assert.Equal(store.Document.ContentHash, store.ValidationResult!.ContentHash);

        Assert.True(store.Undo());
        Assert.Equal(initialRevision + 2, store.Document.Revision);
        Assert.Equal(100, store.Document.Devices.Single(device => device.Id == "lamp-1").X);
        Assert.True(store.Redo());
        Assert.Equal(initialRevision + 3, store.Document.Revision);
        Assert.Equal(275, store.Document.Devices.Single(device => device.Id == "lamp-1").X);
    }
}
