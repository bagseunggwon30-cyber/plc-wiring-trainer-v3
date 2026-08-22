using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Wiring;

namespace PlcWiringTrainer.Core.Tests;

public sealed class ConnectionAssessmentTests
{
    [Fact]
    public void PracticeWarnsButPrewireBlocksDcPositiveToReturnShort()
    {
        var service = new ConnectionAssessmentService(DeviceProfileCatalog.CreateDefault());
        WorkshopDocumentV5 practice = TestDocuments.Empty() with
        {
            Devices =
            [
                Device("left", 20),
                Device("right", 220),
            ],
        };

        ConnectionAssessmentV5 warning = service.Assess(
            DocumentHasher.WithContentHash(practice),
            new TerminalRefV5("left", "+24V"),
            new TerminalRefV5("right", "0V"));
        ConnectionAssessmentV5 blocked = service.Assess(
            DocumentHasher.WithContentHash(practice with { Mode = WorkshopMode.Prewire }),
            new TerminalRefV5("left", "+24V"),
            new TerminalRefV5("right", "0V"));

        Assert.Equal(ConnectionDispositionV5.Warning, warning.Disposition);
        Assert.Equal(ConnectionDispositionV5.Blocked, blocked.Disposition);
    }

    [Fact]
    public void ProtectiveEarthToSignalIsBlockedInPrewire()
    {
        var service = new ConnectionAssessmentService(DeviceProfileCatalog.CreateDefault());
        WorkshopDocumentV5 document = TestDocuments.Empty() with
        {
            Mode = WorkshopMode.Prewire,
            Devices =
            [
                new DeviceInstanceV5(
                    "ac", "ac-source-220v", 1, EvidenceGrade.Educational, "AC",
                    20, 20, 0, 120, 80, false, new Dictionary<string, string>()),
                Device("dc", 220),
            ],
        };

        ConnectionAssessmentV5 result = service.Assess(
            DocumentHasher.WithContentHash(document),
            new TerminalRefV5("ac", "PE"),
            new TerminalRefV5("dc", "+24V"));

        Assert.Equal(ConnectionDispositionV5.Blocked, result.Disposition);
        Assert.Equal("PE_DOMAIN_MISMATCH", result.Code);
    }

    [Fact]
    public void SafeElectricalTerminalsStillRequireExactManualEvidenceInPrewire()
    {
        var service = new ConnectionAssessmentService(DeviceProfileCatalog.CreateDefault());
        WorkshopDocumentV5 document = TestDocuments.Empty() with
        {
            Mode = WorkshopMode.Prewire,
            Devices = [Device("left", 20), Device("right", 220)],
        };

        ConnectionAssessmentV5 result = service.Assess(
            DocumentHasher.WithContentHash(document),
            new TerminalRefV5("left", "+24V"),
            new TerminalRefV5("right", "+24V"));

        Assert.Equal(ConnectionDispositionV5.Blocked, result.Disposition);
        Assert.Equal("MANUAL_EVIDENCE_REQUIRED", result.Code);
    }

    private static DeviceInstanceV5 Device(string id, double x)
        => new(
            id, "dc-supply-24v", 1, EvidenceGrade.Educational, id,
            x, 20, 0, 120, 80, false, new Dictionary<string, string>());
}
