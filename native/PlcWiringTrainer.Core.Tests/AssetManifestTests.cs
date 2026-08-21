using System.Security.Cryptography;
using PlcWiringTrainer.Core.Assets;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class AssetManifestTests
{
    [Fact]
    public void EveryPaletteProfileHasTerminalsAndAnAssetWithThePinnedHash()
    {
        string root = FindRepositoryRoot();
        DeviceProfileCatalog catalog = DeviceProfileCatalog.CreateDefault();

        foreach (DeviceProfileV4 profile in catalog.Profiles.Where(profile => profile.IsPaletteVisible))
        {
            Assert.NotEmpty(profile.Terminals);
            ActiveAssetV4 asset = Assert.Single(ActiveAssetManifest.Entries, item => item.ProfileId == profile.Id);
            string fullPath = Path.Combine(root, "native", "PlcWiringTrainer.App", asset.RelativePath.Replace('/', Path.DirectorySeparatorChar));
            Assert.True(File.Exists(fullPath), fullPath);
            Assert.Equal(asset.Sha256, Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(fullPath))));
        }
    }

    [Fact]
    public void LampAndSensorImagesRemainTheExpectedChangedAssets()
    {
        Assert.Contains(ActiveAssetManifest.Entries, asset =>
            asset.ProfileId == "lamp-green-v1" && asset.RelativePath.EndsWith("lamp-green-flat-screw-v1.png", StringComparison.Ordinal));
        Assert.Contains(ActiveAssetManifest.Entries, asset =>
            asset.ProfileId == "prox-npn-v2" && asset.RelativePath.EndsWith("prox-npn-v2.svg", StringComparison.Ordinal));
        Assert.Contains(ActiveAssetManifest.Entries, asset =>
            asset.ProfileId == "prox-pnp-v2" && asset.RelativePath.EndsWith("prox-pnp-v2.svg", StringComparison.Ordinal));
    }

    private static string FindRepositoryRoot()
    {
        DirectoryInfo? directory = new(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "PlcWiringTrainer.slnx")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new DirectoryNotFoundException("솔루션 루트를 찾지 못했습니다.");
    }
}
