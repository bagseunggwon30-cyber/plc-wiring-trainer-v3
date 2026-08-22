using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class AdvancedValidationTests
{
    private readonly CircuitValidationService _service = new(DeviceProfileCatalog.CreateDefault());

    [Fact]
    public async Task PnpCircuitRequiresZeroVoltPlcInputCommon()
    {
        ValidationResultV5 result = await _service.ValidateAsync(TestDocuments.PnpCircuit(plcCommonToZero: false));

        Assert.Contains(result.Issues, issue => issue.Code == "PNP_INPUT_COMMON_POLARITY" && issue.Blocking);
    }

    [Fact]
    public async Task AcLineToNeutralShortIsBlocking()
    {
        ValidationResultV5 result = await _service.ValidateAsync(TestDocuments.AcShortCircuit());

        Assert.Contains(result.Issues, issue => issue.Code == "AC_LINE_NEUTRAL_SHORT" && issue.Blocking);
    }

    [Fact]
    public async Task TwoWireCurrentLoopRejectsReversedPolarity()
    {
        ValidationResultV5 result = await _service.ValidateAsync(TestDocuments.ReversedCurrentLoop());

        Assert.Contains(result.Issues, issue => issue.Code == "CURRENT_LOOP_POLARITY" && issue.Blocking);
    }

    [Fact]
    public async Task PhysicalValidationRejectsInvalidGaugeAndDuplicateWireNumber()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp();
        ConductorV5 first = document.Conductors[0] with { GaugeMm2 = 0 };
        ConductorV5 second = document.Conductors[1] with { Label = first.Label };
        document = DocumentHasher.WithContentHash(document with { Conductors = [first, second] });

        ValidationResultV5 result = await _service.ValidateAsync(document);

        Assert.Contains(result.Issues, issue => issue.Code == "INVALID_CONDUCTOR_GAUGE" && issue.Blocking);
        Assert.Contains(result.Issues, issue => issue.Code == "DUPLICATE_WIRE_NUMBER");
    }

    [Fact]
    public async Task TerminalBlockInternalLinkCarriesTheDcNet()
    {
        WorkshopDocumentV5 baseline = TestDocuments.Empty("terminal-link") with
        {
            Devices =
            [
                Device("supply", "dc-supply-24v", 20, 100),
                Device("tb", "educational:terminal-block-4", 200, 100),
                Device("lamp", "lamp-green-v1", 430, 100),
            ],
            Conductors =
            [
                Wire("feed", "supply", "+24V", "tb", "1"),
                Wire("load", "tb", "1'", "lamp", "A1"),
                Wire("return", "lamp", "A2", "supply", "0V"),
            ],
        };

        ValidationResultV5 result = await _service.ValidateAsync(DocumentHasher.WithContentHash(baseline));

        Assert.DoesNotContain(result.Issues, issue => issue.Code == "LAMP_OPEN_OR_REVERSED");
        Assert.Contains("lamp", result.Simulation.EnergizedDeviceIds);
    }

    [Fact]
    public async Task MultiTerminalBridgeCarriesTheDcNet()
    {
        WorkshopDocumentV5 baseline = TestDocuments.Empty("terminal-bridge") with
        {
            Devices =
            [
                Device("supply", "dc-supply-24v", 20, 100),
                Device("lamp", "lamp-green-v1", 300, 100),
            ],
            Conductors = [Wire("return", "lamp", "A2", "supply", "0V")],
            TerminalBridges =
            [
                new TerminalBridgeV5(
                    "bridge-24v",
                    [new TerminalRefV5("supply", "+24V"), new TerminalRefV5("lamp", "A1")],
                    "#EF4444"),
            ],
        };

        ValidationResultV5 result = await _service.ValidateAsync(DocumentHasher.WithContentHash(baseline));

        Assert.Contains("lamp", result.Simulation.EnergizedDeviceIds);
    }

    [Fact]
    public async Task CircuitSolutionProvidesVirtualMeterAndConductionGroups()
    {
        CircuitSolutionV5 solution = await _service.SolveAsync(TestDocuments.WithLamp());
        var meter = new VirtualMeterService();

        double? voltage = meter.MeasureVoltage(
            solution,
            new TerminalRefV5("supply", "+24V"),
            new TerminalRefV5("supply", "0V"));

        Assert.Equal(24, voltage);
        Assert.NotEmpty(solution.Simulation.ConductionGroups);
        Assert.Contains(solution.Simulation.TerminalStates, state =>
            state.TerminalKey == "lamp-1:A1" && state.Voltage == 24);
    }

    [Fact]
    public async Task CompletePhysicalLayoutRequiresAMillimeterScale()
    {
        WorkshopDocumentV5 document = DocumentHasher.WithContentHash(TestDocuments.Empty() with
        {
            PhysicalLayout = new PhysicalLayoutDefinitionV5(CompletenessStatus.Complete, "mm", null),
        });

        ValidationResultV5 result = await _service.ValidateAsync(document);

        Assert.Contains(result.Issues, issue => issue.Code == "PHYSICAL_SCALE_REQUIRED" && issue.Blocking);
    }

    private static DeviceInstanceV5 Device(string id, string profileId, double x, double y)
        => new(
            id,
            profileId,
            profileId.EndsWith("-v2", StringComparison.Ordinal) ? 2 : 1,
            EvidenceGrade.Educational,
            id,
            x,
            y,
            0,
            120,
            80,
            false,
            new Dictionary<string, string>());

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
