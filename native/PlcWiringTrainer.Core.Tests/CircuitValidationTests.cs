using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class CircuitValidationTests
{
    [Fact]
    public async Task NpnCircuit_RequiresPositivePlcInputCommon()
    {
        var service = new CircuitValidationService(DeviceProfileCatalog.CreateDefault());
        WorkshopDocumentV5 document = TestDocuments.ValidNpnCircuit(plcCommonToPositive: false);

        ValidationResultV5 result = await service.ValidateAsync(document);

        ValidationIssueV5 issue = Assert.Single(result.Issues, item => item.Code == "NPN_INPUT_COMMON_POLARITY");
        Assert.True(issue.Blocking);
        Assert.Equal(ValidationSeverity.Error, issue.Severity);
        Assert.Contains(issue.Targets, target => target.Kind == ValidationTargetKind.Conductor);
    }

    [Fact]
    public async Task CorrectNpnCircuit_HasNoBlockingElectricalIssue()
    {
        var service = new CircuitValidationService(DeviceProfileCatalog.CreateDefault());

        ValidationResultV5 result = await service.ValidateAsync(TestDocuments.ValidNpnCircuit(plcCommonToPositive: true));

        Assert.DoesNotContain(result.Issues, issue => issue.Blocking);
    }

    [Fact]
    public async Task RealMdrAndXbcProfilesUseTheSameNpnCommonRule()
    {
        DeviceProfileCatalog catalog = DeviceProfileCatalog.CreateDefault();
        Assert.True(catalog.TryGet("ls-electric:xbc-dn32h", out DeviceProfileV5 plcProfile));
        Assert.Equal(TerminalRole.PlcInput, Assert.Single(plcProfile.Terminals, terminal => terminal.Id == "P00").Role);
        Assert.Equal(TerminalRole.PlcInputCommon, Assert.Single(plcProfile.Terminals, terminal => terminal.Id == "COMI").Role);

        WorkshopDocumentV5 document = TestDocuments.Empty("real-npn") with
        {
            Devices =
            [
                Device(catalog, "supply", "mean-well:mdr-100-24"),
                Device(catalog, "sensor", "prox-npn-v2"),
                Device(catalog, "plc", "ls-electric:xbc-dn32h"),
            ],
            Conductors =
            [
                Wire("positive", "supply", "V+1", "sensor", "BN"),
                Wire("return", "supply", "V-1", "sensor", "BU"),
                Wire("signal", "sensor", "BK", "plc", "P00"),
                Wire("wrong-common", "plc", "COMI", "supply", "V-2"),
            ],
        };
        document = DocumentHasher.WithContentHash(document);
        var service = new CircuitValidationService(catalog);

        ValidationResultV5 result = await service.ValidateAsync(document);

        Assert.Contains(result.Issues, issue => issue.Code == "NPN_INPUT_COMMON_POLARITY");
    }

    [Fact]
    public async Task EducationalLamp_RemainsUsableButIsNotClaimedAsManualVerified()
    {
        var service = new CircuitValidationService(DeviceProfileCatalog.CreateDefault());

        ValidationResultV5 result = await service.ValidateAsync(TestDocuments.WithLamp());

        Assert.Contains(result.Issues, issue => issue.Code == "EDUCATIONAL_PROFILE" && !issue.Blocking);
    }

    private static DeviceInstanceV5 Device(DeviceProfileCatalog catalog, string id, string profileId)
    {
        Assert.True(catalog.TryGet(profileId, out DeviceProfileV5 profile));
        return new(
            id,
            profileId,
            profile.Version,
            profile.EvidenceGrade,
            id,
            0,
            0,
            0,
            100,
            80,
            false,
            new Dictionary<string, string>());
    }

    private static ConductorV5 Wire(
        string id,
        string startDevice,
        string startTerminal,
        string endDevice,
        string endTerminal)
        => new(
            id,
            new TerminalRefV5(startDevice, startTerminal),
            new TerminalRefV5(endDevice, endTerminal),
            [],
            id,
            "#EF4444",
            0.75,
            false);
}
