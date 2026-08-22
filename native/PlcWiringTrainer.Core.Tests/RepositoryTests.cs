using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Tests;

public sealed class RepositoryTests
{
    [Fact]
    public async Task SaveUsesSameDirectoryTemporaryFileAndRoundTripsV5()
    {
        string root = TestDirectory.Create();
        string target = Path.Combine(root, "panel.plcw");
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));
        var repository = new WorkshopDocumentRepository(migrator, Path.Combine(root, "autosave"));

        await repository.SaveAsync(target, TestDocuments.WithLamp());
        await repository.SaveAsync(target, TestDocuments.WithLamp() with { Name = "Replaced safely" });
        MigrationResult loaded = await repository.LoadAsync(target);

        Assert.Equal(MigrationStatus.AlreadyV5, loaded.Status);
        Assert.Equal("Replaced safely", loaded.Document!.Name);
        Assert.Empty(Directory.EnumerateFiles(root, "*.tmp.*"));
    }

    [Fact]
    public async Task AutosavesCanBeEnumeratedAndDiscardedInsideTheConfiguredRoot()
    {
        string root = TestDirectory.Create();
        string autosave = Path.Combine(root, "autosave");
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));
        var repository = new WorkshopDocumentRepository(migrator, autosave);

        await repository.SaveAutosaveAsync(TestDocuments.WithLamp());

        string path = Assert.Single(await repository.FindAutosavePathsAsync());
        Assert.StartsWith(Path.GetFullPath(autosave), Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase);
        await repository.DeleteAutosaveAsync("lamp-document");
        Assert.Empty(await repository.FindAutosavePathsAsync());
    }

    [Fact]
    public async Task AutosaveRecoveryPreservesWiringCableRouteAndViewportHash()
    {
        string root = TestDirectory.Create();
        var repository = new WorkshopDocumentRepository(
            new WorkshopDocumentMigrator(Path.Combine(root, "backups"), Path.Combine(root, "quarantine")),
            Path.Combine(root, "autosave"));
        WorkshopDocumentV5 source = TestDocuments.WithLamp();
        ConductorV5 routed = source.Conductors[0] with
        {
            Waypoints = [new PointV5(300, 140), new PointV5(300, 260)],
            RouteLocked = true,
            CableAssemblyId = "cable-1",
            Core = "1",
        };
        source = DocumentHasher.WithContentHash(source with
        {
            Conductors = [routed, .. source.Conductors.Skip(1)],
            CableAssemblies =
            [
                new CableAssemblyV5("cable-1", "C1", [routed.Id], "shielded", 1800, true, null, []),
            ],
            Viewport = new ViewportV5(1.25, 84, -32),
        });

        await repository.SaveAutosaveAsync(source);
        string recoveryPath = Assert.Single(await repository.FindAutosavePathsAsync());
        MigrationResult recovered = await repository.LoadAsync(recoveryPath);

        WorkshopDocumentV5 document = Assert.IsType<WorkshopDocumentV5>(recovered.Document);
        Assert.Equal(source.ContentHash, document.ContentHash);
        Assert.True(DocumentHasher.MatchesContentHash(document));
        Assert.Equal(source.Viewport, document.Viewport);
        Assert.Equal(routed.Waypoints, document.Conductors[0].Waypoints);
        Assert.True(document.Conductors[0].RouteLocked);
        Assert.Equal("cable-1", document.Conductors[0].CableAssemblyId);
        Assert.Equal([routed.Id], Assert.Single(document.CableAssemblies).ConductorIds);
    }

    [Fact]
    public async Task AutosaveNeverLetsAnOlderRevisionReplaceANewerSnapshot()
    {
        string root = TestDirectory.Create();
        var repository = new WorkshopDocumentRepository(
            new WorkshopDocumentMigrator(Path.Combine(root, "backups"), Path.Combine(root, "quarantine")),
            Path.Combine(root, "autosave"));
        WorkshopDocumentV5 baseline = TestDocuments.WithLamp();
        WorkshopDocumentV5 newer = DocumentHasher.WithContentHash(baseline with
        {
            Revision = baseline.Revision + 2,
            Name = "newer",
        });
        WorkshopDocumentV5 older = DocumentHasher.WithContentHash(baseline with
        {
            Revision = baseline.Revision + 1,
            Name = "older",
        });

        await repository.SaveAutosaveAsync(newer);
        await repository.SaveAutosaveAsync(older);

        string path = Assert.Single(await repository.FindAutosavePathsAsync());
        MigrationResult loaded = await repository.LoadAsync(path);
        Assert.Equal(newer.Revision, loaded.Document!.Revision);
        Assert.Equal("newer", loaded.Document.Name);
        Assert.Equal(newer.ContentHash, loaded.Document.ContentHash);
    }

    [Fact]
    public async Task CorruptAutosaveIsQuarantinedAndRemovedFromRecoveryRoot()
    {
        string root = TestDirectory.Create();
        string autosave = Path.Combine(root, "autosave");
        Directory.CreateDirectory(autosave);
        string path = Path.Combine(autosave, "corrupt.plcw");
        await File.WriteAllTextAsync(path, "{ broken json");
        var repository = new WorkshopDocumentRepository(
            new WorkshopDocumentMigrator(Path.Combine(root, "backups"), Path.Combine(root, "quarantine")),
            autosave);

        MigrationResult result = await repository.LoadAsync(path);

        Assert.Equal(MigrationStatus.Quarantined, result.Status);
        Assert.False(File.Exists(path));
        Assert.True(File.Exists(result.QuarantinePath));
        Assert.Empty(await repository.FindAutosavePathsAsync());
    }
}
