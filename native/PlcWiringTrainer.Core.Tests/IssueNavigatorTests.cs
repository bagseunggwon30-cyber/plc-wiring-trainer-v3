using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Navigation;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class IssueNavigatorTests
{
    [Fact]
    public void ResolveFallsBackFromMissingConductorToTerminalAndSelectsIncidentWire()
    {
        WorkshopDocumentV4 document = TestDocuments.ValidNpnCircuit(plcCommonToPositive: false);
        var issue = new ValidationIssueV4(
            "TEST",
            ValidationSeverity.Error,
            true,
            "문제가 있는 단자",
            document.Revision,
            document.ContentHash,
            [
                new ValidationTargetV4(ValidationTargetKind.Conductor, "deleted-wire"),
                new ValidationTargetV4(ValidationTargetKind.Terminal, "plc-1:I0", "plc-1", "I0"),
                new ValidationTargetV4(ValidationTargetKind.Device, "plc-1", "plc-1"),
            ],
            "test");

        NavigationTarget? target = IssueNavigator.Resolve(document, issue);

        Assert.NotNull(target);
        Assert.Equal(NavigationSelectionKind.Conductor, target.Kind);
        Assert.Equal("signal", target.Id);
        Assert.True(target.FocusBounds.Width > 0);
        Assert.True(target.FocusBounds.Height > 0);
    }
}
