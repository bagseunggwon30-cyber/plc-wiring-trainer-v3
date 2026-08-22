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

    [Fact]
    public void CapacityAssessmentCountsTerminalBridges()
    {
        var service = new ConnectionAssessmentService(DeviceProfileCatalog.CreateDefault());
        WorkshopDocumentV5 document = TestDocuments.WithLamp() with
        {
            Mode = WorkshopMode.Prewire,
            Conductors = [],
            TerminalBridges =
            [
                new TerminalBridgeV5(
                    "bridge-1",
                    [new TerminalRefV5("supply", "+24V"), new TerminalRefV5("lamp-1", "A1")],
                    "#EF4444"),
            ],
        };

        ConnectionAssessmentV5 result = service.Assess(
            DocumentHasher.WithContentHash(document),
            new TerminalRefV5("lamp-1", "A1"),
            new TerminalRefV5("lamp-1", "A2"));

        Assert.Equal(ConnectionDispositionV5.Blocked, result.Disposition);
        Assert.Equal("TERMINAL_CAPACITY_EXCEEDED", result.Code);
        Assert.Equal(1, result.StartOccupancy);
        Assert.Equal(1, result.StartCapacity);
        Assert.Equal(0, result.EndOccupancy);
        Assert.Equal(1, result.EndCapacity);
    }

    [Fact]
    public void MultiTerminalBridgeChecksEveryPairForAHiddenSupplyShort()
    {
        var service = new ConnectionAssessmentService(DeviceProfileCatalog.CreateDefault());
        WorkshopDocumentV5 document = TestDocuments.Empty() with
        {
            Devices = [Device("left", 20), Device("right", 220)],
        };
        var bridge = new TerminalBridgeV5(
            "bridge-short",
            [
                new TerminalRefV5("left", "+24V"),
                new TerminalRefV5("right", "+24V"),
                new TerminalRefV5("right", "0V"),
            ],
            "#EF4444");

        ConnectionAssessmentV5 result = service.AssessBridge(document, bridge);

        Assert.Equal(ConnectionDispositionV5.Warning, result.Disposition);
        Assert.Equal("DIRECT_SUPPLY_SHORT", result.Code);
    }

    [Fact]
    public void ConductorAssessmentChecksTerminalGaugeRange()
    {
        DeviceProfileV5 profile = LimitedGaugeProfile();
        var service = new ConnectionAssessmentService(new DeviceProfileCatalog([profile]));
        WorkshopDocumentV5 document = TestDocuments.Empty() with
        {
            Devices =
            [
                new DeviceInstanceV5("left", profile.Id, 1, EvidenceGrade.ManualVerified, "L", 0, 0, 0, 100, 80, false, []),
                new DeviceInstanceV5("right", profile.Id, 1, EvidenceGrade.ManualVerified, "R", 200, 0, 0, 100, 80, false, []),
            ],
        };
        var conductor = new ConductorV5(
            "oversized",
            new TerminalRefV5("left", "T"),
            new TerminalRefV5("right", "T"),
            [],
            "표시명",
            "#EF4444",
            100,
            false)
        {
            WireNumber = "W100",
        };

        ConnectionAssessmentV5 result = service.AssessConductor(document, conductor);

        Assert.Equal("CONDUCTOR_GAUGE_OUT_OF_RANGE", result.Code);
        Assert.NotEqual(ConnectionDispositionV5.Allowed, result.Disposition);
    }

    private static DeviceProfileV5 LimitedGaugeProfile()
        => new(
            "limited-gauge",
            1,
            "Limited gauge",
            DeviceProfileKind.Generic,
            EvidenceGrade.ManualVerified,
            "Assets/none.svg",
            [
                new TerminalDefinitionV5(
                    "T",
                    "T",
                    TerminalDomain.Signal,
                    TerminalPolarity.Signal,
                    TerminalRole.Passive,
                    0,
                    0)
                {
                    MinimumConductorMm2 = 0.25,
                    MaximumConductorMm2 = 2.5,
                },
            ])
        {
            LegacyType = "TEST",
            Category = "test",
            ManualEvidence = ManualEvidenceStatusV5.ExactProduct,
            Manufacturer = "Test",
            PartNumber = "TEST-1",
            Artwork = new DeviceArtworkV5("Assets/none.svg", "test", "0", null, false),
        };

    private static DeviceInstanceV5 Device(string id, double x)
        => new(
            id, "dc-supply-24v", 1, EvidenceGrade.Educational, id,
            x, 20, 0, 120, 80, false, new Dictionary<string, string>());
}
