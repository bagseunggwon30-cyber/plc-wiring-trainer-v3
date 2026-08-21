using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Workbench;

namespace PlcWiringTrainer.Core.Tests;

public sealed class ValidationRaceTests
{
    [Fact]
    public async Task LateResultFromOldRevisionNeverReplacesCurrentValidation()
    {
        var validator = new OutOfOrderValidator();
        await using var store = new WorkbenchStore(TestDocuments.WithLamp(), validator, TimeSpan.Zero);
        await validator.FirstRevisionStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));

        store.UpdateDevice("lamp-1", device => device with { X = 333 });
        await store.WaitForValidationAsync();
        int currentRevision = store.Document.Revision;
        validator.ReleaseFirstRevision.TrySetResult();
        await Task.Delay(50);

        Assert.Equal(ValidationFreshness.Current, store.ValidationFreshness);
        Assert.Equal(currentRevision, store.ValidationResult!.Revision);
        Assert.Equal(store.Document.ContentHash, store.ValidationResult.ContentHash);
    }

    private sealed class OutOfOrderValidator : IValidationService
    {
        private int _callCount;

        public TaskCompletionSource FirstRevisionStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource ReleaseFirstRevision { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<ValidationResultV4> ValidateAsync(
            WorkshopDocumentV4 document,
            CancellationToken cancellationToken = default)
        {
            int call = Interlocked.Increment(ref _callCount);
            if (call == 1)
            {
                FirstRevisionStarted.TrySetResult();
                await ReleaseFirstRevision.Task;
            }

            return new ValidationResultV4(
                document.Revision,
                document.ContentHash,
                [],
                new SimulationResultV4([]));
        }
    }
}
