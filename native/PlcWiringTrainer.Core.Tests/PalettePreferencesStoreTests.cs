using PlcWiringTrainer.Core.Palette;

namespace PlcWiringTrainer.Core.Tests;

public sealed class PalettePreferencesStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(
        Path.GetTempPath(),
        $"plcw-palette-tests-{Guid.NewGuid():N}");

    [Fact]
    public void MissingPreferencesStartWithEveryDeviceVisible()
    {
        var store = new PalettePreferencesStore(Path.Combine(_directory, "palette.json"));

        PalettePreferencesV1 preferences = store.Load();

        Assert.Empty(preferences.HiddenProfileIds);
        Assert.False(preferences.IsPaneOpen);
    }

    [Fact]
    public void HiddenDevicesPersistWithoutDuplicatesAndCanBeRestored()
    {
        var store = new PalettePreferencesStore(Path.Combine(_directory, "palette.json"));

        store.Save(new PalettePreferencesV1(
            ["lamp-green-v1", "prox-npn-v2", "lamp-green-v1"],
            IsPaneOpen: true));
        PalettePreferencesV1 saved = store.Load();

        Assert.Equal(["lamp-green-v1", "prox-npn-v2"], saved.HiddenProfileIds);
        Assert.True(saved.IsPaneOpen);

        store.Save(new PalettePreferencesV1([], IsPaneOpen: false));
        PalettePreferencesV1 restored = store.Load();
        Assert.Empty(restored.HiddenProfileIds);
        Assert.False(restored.IsPaneOpen);
    }

    [Fact]
    public void CorruptPreferencesDoNotHideTheCatalog()
    {
        Directory.CreateDirectory(_directory);
        string path = Path.Combine(_directory, "palette.json");
        File.WriteAllText(path, "{not-json");
        var store = new PalettePreferencesStore(path);

        PalettePreferencesV1 preferences = store.Load();

        Assert.Empty(preferences.HiddenProfileIds);
        Assert.True(File.Exists(path));
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }
    }
}
