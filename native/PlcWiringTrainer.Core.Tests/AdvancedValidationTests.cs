using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class AdvancedValidationTests
{
    private readonly CircuitValidationService _service = new(DeviceProfileCatalog.CreateDefault());

    [Fact]
    public async Task PnpCircuitRequiresZeroVoltPlcInputCommon()
    {
        ValidationResultV4 result = await _service.ValidateAsync(TestDocuments.PnpCircuit(plcCommonToZero: false));

        Assert.Contains(result.Issues, issue => issue.Code == "PNP_INPUT_COMMON_POLARITY" && issue.Blocking);
    }

    [Fact]
    public async Task AcLineToNeutralShortIsBlocking()
    {
        ValidationResultV4 result = await _service.ValidateAsync(TestDocuments.AcShortCircuit());

        Assert.Contains(result.Issues, issue => issue.Code == "AC_LINE_NEUTRAL_SHORT" && issue.Blocking);
    }

    [Fact]
    public async Task TwoWireCurrentLoopRejectsReversedPolarity()
    {
        ValidationResultV4 result = await _service.ValidateAsync(TestDocuments.ReversedCurrentLoop());

        Assert.Contains(result.Issues, issue => issue.Code == "CURRENT_LOOP_POLARITY" && issue.Blocking);
    }

    [Fact]
    public async Task PhysicalValidationRejectsInvalidGaugeAndDuplicateWireNumber()
    {
        WorkshopDocumentV4 document = TestDocuments.WithLamp();
        ConductorV4 first = document.Conductors[0] with { GaugeMm2 = 0 };
        ConductorV4 second = document.Conductors[1] with { Label = first.Label };
        document = DocumentHasher.WithContentHash(document with { Conductors = [first, second] });

        ValidationResultV4 result = await _service.ValidateAsync(document);

        Assert.Contains(result.Issues, issue => issue.Code == "INVALID_CONDUCTOR_GAUGE" && issue.Blocking);
        Assert.Contains(result.Issues, issue => issue.Code == "DUPLICATE_WIRE_NUMBER");
    }
}
