using System.Text.Json;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

internal static class TestDirectory
{
    public static string Create()
    {
        string path = Path.Combine(Path.GetTempPath(), "PlcWiringTrainer.Tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }
}

internal static class TestDocuments
{
    public static WorkshopDocumentV4 Empty(string id = "test")
    {
        var document = new WorkshopDocumentV4
        {
            DocumentId = id,
            Revision = 1,
            Name = "Test panel",
            Devices = [],
            Conductors = [],
            Jumpers = [],
            Panel = new PanelLayoutV4(1200, 800),
            Viewport = new ViewportV4(1, 0, 0),
            Settings = new WorkshopSettingsV4(10, true),
            Extensions = new Dictionary<string, JsonElement>(),
        };
        return DocumentHasher.WithContentHash(document);
    }

    public static WorkshopDocumentV4 WithLamp()
    {
        WorkshopDocumentV4 document = Empty("lamp-document") with
        {
            Devices =
            [
                Device("supply", "dc-supply-24v", 20, 100),
                Device("lamp-1", "lamp-green-v1", 100, 100),
            ],
            Conductors =
            [
                Wire("lamp-positive", "supply", "+24V", "lamp-1", "A1"),
                Wire("lamp-return", "lamp-1", "A2", "supply", "0V"),
            ],
        };
        return DocumentHasher.WithContentHash(document);
    }

    public static WorkshopDocumentV4 ValidNpnCircuit(bool plcCommonToPositive)
    {
        WorkshopDocumentV4 document = Empty("npn-document") with
        {
            Devices =
            [
                Device("supply", "dc-supply-24v", 20, 140),
                Device("sensor", "prox-npn-v2", 180, 100),
                Device("plc-1", "plc-input-24v", 420, 100),
            ],
            Conductors =
            [
                Wire("sensor-positive", "supply", "+24V", "sensor", "BN"),
                Wire("sensor-return", "supply", "0V", "sensor", "BU"),
                Wire("signal", "sensor", "BK", "plc-1", "I0"),
                Wire(
                    "plc-common",
                    "plc-1",
                    "COM",
                    "supply",
                    plcCommonToPositive ? "+24V" : "0V"),
            ],
        };
        return DocumentHasher.WithContentHash(document);
    }

    public static WorkshopDocumentV4 PnpCircuit(bool plcCommonToZero)
    {
        WorkshopDocumentV4 document = Empty("pnp-document") with
        {
            Devices =
            [
                Device("supply", "dc-supply-24v", 20, 140),
                Device("sensor", "prox-pnp-v2", 180, 100),
                Device("plc-1", "plc-input-24v", 420, 100),
            ],
            Conductors =
            [
                Wire("sensor-positive", "supply", "+24V", "sensor", "BN"),
                Wire("sensor-return", "supply", "0V", "sensor", "BU"),
                Wire("signal", "sensor", "BK", "plc-1", "I0"),
                Wire("plc-common", "plc-1", "COM", "supply", plcCommonToZero ? "0V" : "+24V"),
            ],
        };
        return DocumentHasher.WithContentHash(document);
    }

    public static WorkshopDocumentV4 AcShortCircuit()
    {
        WorkshopDocumentV4 document = Empty("ac-short") with
        {
            Devices = [Device("ac-source", "ac-source-220v", 20, 100)],
            Conductors = [Wire("short", "ac-source", "L", "ac-source", "N")],
        };
        return DocumentHasher.WithContentHash(document);
    }

    public static WorkshopDocumentV4 ReversedCurrentLoop()
    {
        WorkshopDocumentV4 document = Empty("current-loop") with
        {
            Devices =
            [
                Device("supply", "dc-supply-24v", 20, 140),
                Device("tx", "transmitter-2wire-4-20ma", 200, 100),
                Device("ai", "analog-input-4-20ma", 430, 100),
            ],
            Conductors =
            [
                Wire("reversed-positive", "supply", "0V", "tx", "+"),
                Wire("tx-to-ai", "tx", "-", "ai", "I+"),
                Wire("ai-return", "ai", "I-", "supply", "+24V"),
            ],
        };
        return DocumentHasher.WithContentHash(document);
    }

    private static DeviceInstanceV4 Device(string id, string profileId, double x, double y)
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

    private static ConductorV4 Wire(
        string id,
        string startDevice,
        string startTerminal,
        string endDevice,
        string endTerminal)
        => new(
            id,
            new TerminalRefV4(startDevice, startTerminal),
            new TerminalRefV4(endDevice, endTerminal),
            [],
            id,
            "#EF4444",
            0.75,
            false);
}
