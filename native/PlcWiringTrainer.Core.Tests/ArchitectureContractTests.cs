using System.Security.Cryptography;
using System.Text;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class ArchitectureContractTests
{
    private static readonly string[] ExpectedValidationIssueCodes =
    [
        "AC_LINE_NEUTRAL_SHORT",
        "AC_LINE_TO_PE",
        "AC_PHASE_SHORT",
        "AC_LOAD_WIRING",
        "ANALOG_SCALING_INCOMPLETE",
        "CABLE_MEMBERSHIP_MISMATCH",
        "CURRENT_LOOP_POLARITY",
        "DC_SHORT_CIRCUIT",
        "DEVICE_OUTSIDE_PANEL",
        "DUPLICATE_CABLE_CORE",
        "DUPLICATE_CONNECTION",
        "DUPLICATE_DOCUMENT_ID",
        "DUPLICATE_WIRE_NUMBER",
        "EDUCATIONAL_PROFILE",
        "INVALID_CONDUCTOR_GAUGE",
        "INVALID_INTERNAL_LINK",
        "INVALID_TERMINAL_BRIDGE",
        "LAMP_OPEN_OR_REVERSED",
        "MANUAL_EVIDENCE_REQUIRED",
        "NPN_INPUT_COMMON_POLARITY",
        "PHYSICAL_SCALE_REQUIRED",
        "PNP_INPUT_COMMON_POLARITY",
        "PROFILE_NOT_FOUND",
        "PROFILE_VERSION_MISMATCH",
        "SENSOR_OUTPUT_NOT_CONNECTED",
        "SENSOR_SUPPLY_POSITIVE",
        "SENSOR_SUPPLY_RETURN",
        "SHIELD_DRAIN_REQUIRED",
        "SOURCE_SYSTEM_INCOMPLETE",
        "TERMINAL_CAPACITY_EXCEEDED",
        "UNKNOWN_CABLE_ASSEMBLY",
        "UNKNOWN_CABLE_CONDUCTOR",
        "UNKNOWN_DRAIN_CONDUCTOR",
        "UNKNOWN_TERMINAL",
        "WIRE_NUMBER_REQUIRED",
    ];

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

    [Fact]
    public void PublicContractSurfaceIsPinnedForTheExeOnlyProduct()
    {
        string[] exportedTypes = typeof(WorkshopDocumentV5).Assembly.ExportedTypes
            .Select(type => type.FullName!)
            .Order(StringComparer.Ordinal)
            .ToArray();
        string surface = string.Join('\n', exportedTypes);
        string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(surface)));

        Assert.Equal(89, exportedTypes.Length);
        Assert.Equal(
            "EEF66F5BC5B721CD25D23B9ED9EA4BD00BE31ED20902873715900F008DED9315",
            hash);
    }

    [Fact]
    public void ValidationIssueCodeAllowlistIsPinned()
    {
        Assert.Equal(
            ExpectedValidationIssueCodes,
            ValidationIssueCodes.All);
        Assert.Equal(35, ValidationIssueCodes.All.Distinct(StringComparer.Ordinal).Count());
    }
}
