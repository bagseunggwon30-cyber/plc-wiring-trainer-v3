using System.Security.Cryptography;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class LegacyCatalogTests
{
    [Fact]
    public void NativeCatalogMatchesTheUserPrunedInventory()
    {
        DeviceProfileCatalog catalog = DeviceProfileCatalog.CreateDefault();

        Assert.Equal(80, catalog.Profiles.Count);
        DeviceProfileV5[] visible = catalog.Profiles.Where(profile => profile.IsPaletteVisible).ToArray();
        Assert.Equal(48, visible.Length);
        Assert.Equal(482, visible.Sum(profile => profile.Terminals.Length));
        Assert.Equal(8, visible.Select(profile => profile.Category).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(46, visible.Select(profile => profile.AssetPath).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(18, catalog.Profiles.Count(profile => profile.ManualEvidence == ManualEvidenceStatusV5.ExactProduct));
    }

    [Fact]
    public void UserHiddenProfilesAreRemovedFromTheCatalog()
    {
        DeviceProfileCatalog catalog = DeviceProfileCatalog.CreateDefault();
        string[] removedProfileIds =
        [
            "legacy:counter",
            "legacy:encoder",
            "legacy:flicker",
            "legacy:gnd-bar",
            "legacy:limit",
            "legacy:pb-nc",
            "legacy:pb-no",
            "legacy:pressure-tx-420",
            "legacy:pt100",
            "legacy:signal-gen-vi",
            "legacy:timer",
            "legacy:xbe-dc32a",
            "legacy:xbe-dr16a",
            "legacy:xbe-ry16a",
            "legacy:xbe-tn16a",
            "legacy:xbe-tp16a",
            "omron:my2n-d2-dc24",
            "phoenix-contact:ut-2.5-3044076",
            "phoenix-contact:ut-2.5-pe-3044092",
            "phoenix-contact:ut-4-hesi-3046032",
        ];

        Assert.All(removedProfileIds, profileId => Assert.False(catalog.TryGet(profileId, out _), profileId));
    }

    [Theory]
    [InlineData("legacy:xbf-ad04a")]
    [InlineData("legacy:xbf-ad08a")]
    [InlineData("legacy:xbf-dc04a")]
    [InlineData("legacy:xbf-dv04a")]
    [InlineData("legacy:xbf-rd04a")]
    [InlineData("legacy:xbf-tc04s")]
    public void ExactLsAnalogAndTemperatureModelsAreManualVerified(string profileId)
    {
        DeviceProfileV5 profile = Get(DeviceProfileCatalog.CreateDefault(), profileId);

        Assert.Equal(ManualEvidenceStatusV5.ExactProduct, profile.ManualEvidence);
        Assert.Equal(EvidenceGrade.ManualVerified, profile.EvidenceGrade);
    }

    [Fact]
    public void EveryExactProfileHasAFullOrderCodeAndHashPinnedOfficialManual()
    {
        DeviceProfileV5[] exactProfiles = DeviceProfileCatalog.CreateDefault().Profiles
            .Where(profile => profile.ManualEvidence == ManualEvidenceStatusV5.ExactProduct)
            .ToArray();

        Assert.Equal(18, exactProfiles.Length);
        Assert.All(exactProfiles, profile =>
        {
            Assert.False(string.IsNullOrWhiteSpace(profile.Manufacturer), profile.Id);
            Assert.False(string.IsNullOrWhiteSpace(profile.PartNumber), profile.Id);
            Assert.NotEmpty(profile.ManualReferences);
            Assert.All(profile.ManualReferences, reference =>
            {
                Assert.Matches("^[A-F0-9]{64}$", reference.Sha256);
                Assert.StartsWith("assets/source-evidence/manuals/", reference.DocumentPath, StringComparison.Ordinal);
            });
        });
    }

    [Fact]
    public void ExactManualFilesMatchTheirPinnedSha256()
    {
        DirectoryInfo repositoryRoot = FindRepositoryRoot();
        ManualReferenceV5[] references = DeviceProfileCatalog.CreateDefault().Profiles
            .Where(profile => profile.ManualEvidence == ManualEvidenceStatusV5.ExactProduct)
            .SelectMany(profile => profile.ManualReferences)
            .DistinctBy(reference => reference.DocumentPath, StringComparer.Ordinal)
            .ToArray();

        Assert.NotEmpty(references);
        Assert.All(references, reference =>
        {
            string path = Path.Combine(
                repositoryRoot.FullName,
                reference.DocumentPath.Replace('/', Path.DirectorySeparatorChar));
            Assert.True(File.Exists(path), reference.DocumentPath);
            string actual = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
            Assert.Equal(reference.Sha256, actual);
        });
    }

    [Theory]
    [InlineData("legacy:xbf-ad04a", "CH0+", TerminalDomain.AnalogInput, TerminalPolarity.Positive, TerminalRole.AnalogInputPositive)]
    [InlineData("legacy:xbf-ad08a", "CH7-", TerminalDomain.AnalogInput, TerminalPolarity.Negative, TerminalRole.AnalogInputNegative)]
    [InlineData("legacy:xbf-dv04a", "CH0+", TerminalDomain.AnalogOutput, TerminalPolarity.Positive, TerminalRole.Passive)]
    [InlineData("legacy:xbf-dc04a", "CH3-", TerminalDomain.AnalogOutput, TerminalPolarity.Negative, TerminalRole.Passive)]
    [InlineData("legacy:xbf-rd04a", "CH0A", TerminalDomain.AnalogInput, TerminalPolarity.Positive, TerminalRole.AnalogInputPositive)]
    [InlineData("legacy:xbf-rd04a", "CH0b", TerminalDomain.AnalogInput, TerminalPolarity.Negative, TerminalRole.AnalogInputNegative)]
    [InlineData("legacy:xbf-tc04s", "CH3-", TerminalDomain.AnalogInput, TerminalPolarity.Negative, TerminalRole.AnalogInputNegative)]
    public void ExactLsModuleSignalTerminalsHaveManualBackedElectricalSemantics(
        string profileId,
        string terminalId,
        TerminalDomain domain,
        TerminalPolarity polarity,
        TerminalRole role)
    {
        TerminalDefinitionV5 terminal = Assert.Single(
            Get(DeviceProfileCatalog.CreateDefault(), profileId).Terminals,
            item => item.Id == terminalId);

        Assert.Equal(domain, terminal.Domain);
        Assert.Equal(polarity, terminal.Polarity);
        Assert.Equal(role, terminal.Role);
        Assert.Equal(terminalId[..3], terminal.Channel);
    }

    [Theory]
    [InlineData("legacy:xbf-ad04a")]
    [InlineData("legacy:xbf-ad08a")]
    [InlineData("legacy:xbf-dv04a")]
    [InlineData("legacy:xbf-dc04a")]
    [InlineData("legacy:xbf-rd04a")]
    [InlineData("legacy:xbf-tc04s")]
    public void ExactLsModuleExternalSupplyHasCorrectPolarity(string profileId)
    {
        DeviceProfileV5 profile = Get(DeviceProfileCatalog.CreateDefault(), profileId);

        TerminalDefinitionV5 positive = Assert.Single(profile.Terminals, item => item.Id == "+24V");
        TerminalDefinitionV5 zero = Assert.Single(profile.Terminals, item => item.Id == "0V");
        Assert.Equal((TerminalDomain.DcPower, TerminalPotential.Positive24V, TerminalRole.SupplyPositive),
            (positive.Domain, positive.Potential, positive.Role));
        Assert.Equal((TerminalDomain.DcPower, TerminalPotential.ZeroVolt, TerminalRole.SupplyReturn),
            (zero.Domain, zero.Potential, zero.Role));
    }

    [Theory]
    [InlineData("legacy:xbf-ad04a", 10)]
    [InlineData("legacy:xbf-ad08a", 18)]
    [InlineData("legacy:xbf-dv04a", 10)]
    [InlineData("legacy:xbf-dc04a", 10)]
    [InlineData("legacy:xbf-rd04a", 15)]
    [InlineData("legacy:xbf-tc04s", 11)]
    public void ExactLsModuleTerminalAnchorsMatchTheManualConnectorCount(string profileId, int expectedCount)
    {
        DeviceProfileV5 profile = Get(DeviceProfileCatalog.CreateDefault(), profileId);

        Assert.Equal(expectedCount, profile.Terminals.Length);
        Assert.Equal(expectedCount, profile.Terminals.Select(item => (item.OffsetX, item.OffsetY)).Distinct().Count());
        Assert.All(profile.Terminals, terminal =>
        {
            Assert.InRange(terminal.OffsetX, 0, profile.DefaultWidth);
            Assert.InRange(terminal.OffsetY, 0, profile.DefaultHeight);
        });
    }

    [Fact]
    public void UserSelectedLampAndProximityArtworkRemainsCanonical()
    {
        DeviceProfileCatalog catalog = DeviceProfileCatalog.CreateDefault();

        Assert.Equal("Assets/Devices/lamp-green-flat-screw-v1.png", Get(catalog, "lamp-green-v1").AssetPath);
        Assert.Equal("Assets/Devices/lamp-yellow-flat-screw-v1.png", Get(catalog, "lamp-yellow-v1").AssetPath);
        Assert.Equal("Assets/Devices/lamp-white-flat-screw-v1.png", Get(catalog, "lamp-white-v1").AssetPath);
        Assert.Equal("Assets/Devices/prox-npn-v2.svg", Get(catalog, "prox-npn-v2").AssetPath);
        Assert.Equal("Assets/Devices/prox-pnp-v2.svg", Get(catalog, "prox-pnp-v2").AssetPath);
    }

    [Theory]
    [InlineData("legacy:tb-24v-10")]
    [InlineData("legacy:tb-0v-10")]
    [InlineData("legacy:tb-pe-10")]
    public void DistributionBlocksExposeOneCommonConductiveBus(string profileId)
    {
        DeviceProfileV5 profile = Get(DeviceProfileCatalog.CreateDefault(), profileId);

        Assert.Equal(20, profile.Terminals.Length);
        Assert.Equal(19, profile.InternalLinks.Length);
        Assert.All(profile.InternalLinks, link =>
        {
            Assert.Equal("1", link.FromTerminalId);
            Assert.Equal(InternalLinkKind.Conductive, link.Kind);
        });
        Assert.Equal(
            profile.Terminals.Select(terminal => terminal.Id).Skip(1),
            profile.InternalLinks.Select(link => link.ToTerminalId));
    }

    private static DeviceProfileV5 Get(DeviceProfileCatalog catalog, string id)
    {
        Assert.True(catalog.TryGet(id, out DeviceProfileV5? profile), id);
        return profile;
    }

    private static DirectoryInfo FindRepositoryRoot()
    {
        DirectoryInfo? directory = new(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, ".git")))
        {
            directory = directory.Parent;
        }

        return directory ?? throw new DirectoryNotFoundException("Git 저장소 루트를 찾을 수 없습니다.");
    }
}
