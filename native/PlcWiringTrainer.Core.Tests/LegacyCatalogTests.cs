using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class LegacyCatalogTests
{
    [Fact]
    public void NativeCatalogPreservesTheMeasuredLegacyInventory()
    {
        DeviceProfileCatalog catalog = DeviceProfileCatalog.CreateDefault();

        Assert.Equal(100, catalog.Profiles.Count);
        DeviceProfileV5[] visible = catalog.Profiles.Where(profile => profile.IsPaletteVisible).ToArray();
        Assert.Equal(68, visible.Length);
        Assert.Equal(657, visible.Sum(profile => profile.Terminals.Length));
        Assert.Equal(8, visible.Select(profile => profile.Category).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(64, visible.Select(profile => profile.AssetPath).Distinct(StringComparer.Ordinal).Count());
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

    private static DeviceProfileV5 Get(DeviceProfileCatalog catalog, string id)
    {
        Assert.True(catalog.TryGet(id, out DeviceProfileV5? profile), id);
        return profile;
    }
}
