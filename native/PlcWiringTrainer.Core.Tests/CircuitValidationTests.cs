using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class CircuitValidationTests
{
    [Fact]
    public async Task NpnCircuit_RequiresPositivePlcInputCommon()
    {
        var service = new CircuitValidationService(DeviceProfileCatalog.CreateDefault());
        WorkshopDocumentV4 document = TestDocuments.ValidNpnCircuit(plcCommonToPositive: false);

        ValidationResultV4 result = await service.ValidateAsync(document);

        ValidationIssueV4 issue = Assert.Single(result.Issues, item => item.Code == "NPN_INPUT_COMMON_POLARITY");
        Assert.True(issue.Blocking);
        Assert.Equal(ValidationSeverity.Error, issue.Severity);
        Assert.Contains(issue.Targets, target => target.Kind == ValidationTargetKind.Conductor);
    }

    [Fact]
    public async Task CorrectNpnCircuit_HasNoBlockingElectricalIssue()
    {
        var service = new CircuitValidationService(DeviceProfileCatalog.CreateDefault());

        ValidationResultV4 result = await service.ValidateAsync(TestDocuments.ValidNpnCircuit(plcCommonToPositive: true));

        Assert.DoesNotContain(result.Issues, issue => issue.Blocking);
    }

    [Fact]
    public async Task EducationalLamp_RemainsUsableButIsNotClaimedAsManualVerified()
    {
        var service = new CircuitValidationService(DeviceProfileCatalog.CreateDefault());

        ValidationResultV4 result = await service.ValidateAsync(TestDocuments.WithLamp());

        Assert.Contains(result.Issues, issue => issue.Code == "EDUCATIONAL_PROFILE" && !issue.Blocking);
    }
}
