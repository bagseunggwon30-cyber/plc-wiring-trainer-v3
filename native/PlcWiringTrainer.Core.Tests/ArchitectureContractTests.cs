using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Tests;

public sealed class ArchitectureContractTests
{
    [Theory]
    [InlineData("PlcWiringTrainer.Core.Integration.IAutomationRuntime")]
    [InlineData("PlcWiringTrainer.Core.Integration.IXgSimAdapter")]
    [InlineData("PlcWiringTrainer.Core.Integration.ISceneRenderer")]
    [InlineData("PlcWiringTrainer.Core.Learning.IMissionEvaluator")]
    [InlineData("PlcWiringTrainer.Core.Validation.DeviceCatalogEntryV5")]
    [InlineData("PlcWiringTrainer.Core.Validation.ElectricalProfileV5")]
    public void UnimplementedOrUnusedPublicContractsAreNotShipped(string typeName)
    {
        Type? type = typeof(WorkshopDocumentV5).Assembly.GetType(typeName, throwOnError: false);

        Assert.Null(type);
    }
}
