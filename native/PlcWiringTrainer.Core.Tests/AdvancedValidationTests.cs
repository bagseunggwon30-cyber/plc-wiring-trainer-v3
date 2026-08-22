using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class AdvancedValidationTests
{
    [Fact]
    public async Task ValidationIssueOrderingAndTypedTargetsAreDeterministic()
    {
        var service = new CircuitValidationService(DeviceProfileCatalog.CreateDefault());
        WorkshopDocumentV5 document = TestDocuments.WithLamp();

        ValidationResultV5 first = await service.ValidateAsync(document);
        ValidationResultV5 second = await service.ValidateAsync(document);

        Assert.Equal(
            first.Issues
                .OrderBy(issue => issue.Severity)
                .ThenByDescending(issue => issue.Blocking)
                .ThenBy(issue => issue.Code),
            first.Issues);
        Assert.Equal(
            first.Issues.Select(issue =>
                (issue.Code, issue.Severity, issue.Blocking, Targets: string.Join('|', issue.Targets.Select(TargetKey)))),
            second.Issues.Select(issue =>
                (issue.Code, issue.Severity, issue.Blocking, Targets: string.Join('|', issue.Targets.Select(TargetKey)))));
    }

    private static string TargetKey(ValidationTargetV5 target)
        => $"{target.Kind}:{target.Id}:{target.DeviceId}:{target.TerminalId}";

    private readonly CircuitValidationService _service = new(DeviceProfileCatalog.CreateDefault());

    [Fact]
    public async Task TerminalAliasesAreCanonicalizedBeforeWholeDocumentValidation()
    {
        WorkshopDocumentV5 source = TestDocuments.WithLamp();
        var exp = new DeviceInstanceV5(
            "exp",
            "ls-electric:exp2-0700d",
            1,
            EvidenceGrade.ManualVerified,
            "EXP2",
            300,
            120,
            0,
            220,
            180,
            false,
            new Dictionary<string, string>());
        var conductor = new ConductorV5(
            "alias-wire",
            new TerminalRefV5("supply", "+24V"),
            new TerminalRefV5("exp", "V+"),
            [],
            "alias",
            "#EF4444",
            0.75,
            false)
        {
            WireNumber = "W701",
        };
        WorkshopDocumentV5 document = DocumentHasher.WithContentHash(source with
        {
            Devices = [source.Devices.Single(device => device.Id == "supply"), exp],
            Conductors = [conductor],
        });

        ValidationResultV5 result = await _service.ValidateAsync(document);

        Assert.DoesNotContain(result.Issues, issue => issue.Code == "UNKNOWN_TERMINAL");
    }

    [Fact]
    public async Task DuplicatePersistentIdsProduceBlockingIssuesInsteadOfValidatorExceptions()
    {
        WorkshopDocumentV5 source = TestDocuments.WithLamp();
        WorkshopDocumentV5 document = DocumentHasher.WithContentHash(source with
        {
            Devices = [source.Devices[0], source.Devices[0]],
            Conductors = [source.Conductors[0], source.Conductors[0]],
            CableAssemblies =
            [
                new CableAssemblyV5("C1", "C1", [], null, null, false, null, []),
                new CableAssemblyV5("C1", "C1 duplicate", [], null, null, false, null, []),
            ],
        });

        ValidationResultV5 result = await _service.ValidateAsync(document);

        ValidationIssueV5[] duplicateIssues = result.Issues
            .Where(issue => issue.Code == "DUPLICATE_DOCUMENT_ID")
            .ToArray();
        Assert.Equal(3, duplicateIssues.Length);
        Assert.All(duplicateIssues, issue => Assert.True(issue.Blocking));
    }

    [Fact]
    public async Task DuplicateDirectConnectionAcrossConductorAndBridgeIsBlocking()
    {
        WorkshopDocumentV5 source = TestDocuments.WithLamp();
        ConductorV5 conductor = source.Conductors[0];
        WorkshopDocumentV5 document = DocumentHasher.WithContentHash(source with
        {
            TerminalBridges =
            [
                new TerminalBridgeV5(
                    "duplicate-path",
                    [conductor.Start, conductor.End],
                    "#EF4444"),
            ],
        });

        ValidationResultV5 result = await _service.ValidateAsync(document);

        Assert.Contains(result.Issues, issue => issue.Code == "DUPLICATE_CONNECTION" && issue.Blocking);
    }

    [Fact]
    public async Task ThreePhaseSourceRejectsADirectL1ToL2Connection()
    {
        DeviceProfileCatalog catalog = DeviceProfileCatalog.CreateDefault();
        Assert.True(catalog.TryGet("boundary:ac-supply", out DeviceProfileV5 profile));
        var source = new DeviceInstanceV5(
            "three-phase",
            profile.Id,
            profile.Version,
            EvidenceGrade.Educational,
            "3상 전원",
            20,
            20,
            0,
            220,
            220,
            false,
            []);
        WorkshopDocumentV5 document = DocumentHasher.WithContentHash(TestDocuments.Empty() with
        {
            Devices = [source],
            Conductors =
            [
                new ConductorV5(
                    "phase-short",
                    new TerminalRefV5(source.Id, "L1"),
                    new TerminalRefV5(source.Id, "L2"),
                    [],
                    "W3",
                    "#92400E",
                    0.75,
                    false)
                {
                    WireNumber = "W3",
                },
            ],
        });

        ValidationResultV5 result = await new CircuitValidationService(catalog).ValidateAsync(document);

        Assert.Contains(result.Issues, issue => issue.Code == "AC_PHASE_SHORT" && issue.Blocking);
    }

    [Fact]
    public async Task EveryDcSourceParticipatesInShortCircuitDetection()
    {
        WorkshopDocumentV5 source = TestDocuments.WithLamp();
        DeviceInstanceV5 secondSupply = source.Devices[0] with
        {
            Id = "supply-2",
            Label = "supply-2",
            X = 400,
        };
        WorkshopDocumentV5 document = DocumentHasher.WithContentHash(source with
        {
            Devices = [source.Devices[0], secondSupply],
            Conductors =
            [
                new ConductorV5(
                    "second-source-short",
                    new TerminalRefV5(secondSupply.Id, "+24V"),
                    new TerminalRefV5(secondSupply.Id, "0V"),
                    [],
                    "W4",
                    "#EF4444",
                    0.75,
                    false)
                {
                    WireNumber = "W4",
                },
            ],
        });

        ValidationResultV5 result = await _service.ValidateAsync(document);

        Assert.Contains(result.Issues, issue => issue.Code == "DC_SHORT_CIRCUIT" && issue.Blocking);
    }

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
    public async Task TwoWireCurrentLoopRejectsAParallelTransmitterBypass()
    {
        WorkshopDocumentV5 source = TestDocuments.ReversedCurrentLoop();
        ConductorV5[] validLoop =
        [
            source.Conductors[0] with
            {
                Start = new TerminalRefV5("supply", "+24V"),
                End = new TerminalRefV5("tx", "+"),
            },
            source.Conductors[1],
            source.Conductors[2] with
            {
                Start = new TerminalRefV5("ai", "I-"),
                End = new TerminalRefV5("supply", "0V"),
            },
            source.Conductors[0] with
            {
                Id = "tx-bypass",
                Start = new TerminalRefV5("tx", "+"),
                End = new TerminalRefV5("tx", "-"),
                WireNumber = "W99",
            },
        ];
        WorkshopDocumentV5 document = DocumentHasher.WithContentHash(source with { Conductors = validLoop });

        ValidationResultV5 result = await _service.ValidateAsync(document);

        Assert.Contains(result.Issues, issue => issue.Code == "CURRENT_LOOP_POLARITY" && issue.Blocking);
    }

    [Fact]
    public async Task PhysicalValidationRejectsInvalidGaugeAndDuplicateWireNumber()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp();
        ConductorV5 first = document.Conductors[0] with { GaugeMm2 = 0 };
        ConductorV5 second = document.Conductors[1] with
        {
            Label = "서로 다른 표시명",
            WireNumber = first.WireNumber,
        };
        document = DocumentHasher.WithContentHash(document with { Conductors = [first, second] });

        ValidationResultV5 result = await _service.ValidateAsync(document);

        Assert.Contains(result.Issues, issue => issue.Code == "INVALID_CONDUCTOR_GAUGE" && issue.Blocking);
        Assert.Contains(result.Issues, issue => issue.Code == "DUPLICATE_WIRE_NUMBER");
    }

    [Fact]
    public async Task CableMembershipAndDrainReferencesMustExistAndAgree()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp();
        ConductorV5 assigned = document.Conductors[0] with
        {
            CableAssemblyId = "cable-1",
            Core = "1",
        };
        document = DocumentHasher.WithContentHash(document with
        {
            Conductors = [assigned, document.Conductors[1]],
            CableAssemblies =
            [
                new CableAssemblyV5(
                    "cable-1",
                    "C1",
                    ["missing-conductor"],
                    "shielded",
                    1000,
                    true,
                    "missing-drain",
                    []),
            ],
        });

        ValidationResultV5 result = await _service.ValidateAsync(document);

        Assert.Contains(result.Issues, issue => issue.Code == "CABLE_MEMBERSHIP_MISMATCH" && issue.Blocking);
        Assert.Contains(result.Issues, issue => issue.Code == "UNKNOWN_CABLE_CONDUCTOR" && issue.Blocking);
        Assert.Contains(result.Issues, issue => issue.Code == "UNKNOWN_DRAIN_CONDUCTOR" && issue.Blocking);
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
