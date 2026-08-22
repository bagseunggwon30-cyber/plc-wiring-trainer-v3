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

        Assert.Equal(ValidationFreshness.Pass, store.ValidationFreshness);
        Assert.Equal(currentRevision, store.ValidationResult!.Revision);
        Assert.Equal(store.Document.ContentHash, store.ValidationResult.ContentHash);
    }

    [Fact]
    public async Task ValidatorFailureLeavesTheCurrentDocumentInFailInsteadOfRunningForever()
    {
        await using var store = new WorkbenchStore(
            TestDocuments.WithLamp(),
            new ThrowingValidator(),
            TimeSpan.Zero);

        await store.WaitForValidationAsync();

        Assert.Equal(ValidationFreshness.Fail, store.ValidationFreshness);
        Assert.Null(store.ValidationResult);
        Assert.Contains("validation failed", store.ValidationError, StringComparison.Ordinal);
    }

    private sealed class OutOfOrderValidator : IValidationService
    {
        private int _callCount;

        public TaskCompletionSource FirstRevisionStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource ReleaseFirstRevision { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<ValidationResultV5> ValidateAsync(
            WorkshopDocumentV5 document,
            CancellationToken cancellationToken = default)
        {
            int call = Interlocked.Increment(ref _callCount);
            if (call == 1)
            {
                FirstRevisionStarted.TrySetResult();
                await ReleaseFirstRevision.Task;
            }

            return new ValidationResultV5(
                document.Revision,
                document.ContentHash,
                [],
                new SimulationResultV5([]));
        }
    }


    private sealed class ThrowingValidator : IValidationService
    {
        public Task<ValidationResultV5> ValidateAsync(
            WorkshopDocumentV5 document,
            CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("validation failed");
    }
}
