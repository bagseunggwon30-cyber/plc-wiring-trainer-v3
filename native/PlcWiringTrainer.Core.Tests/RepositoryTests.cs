using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Tests;

public sealed class RepositoryTests
{
    [Fact]
    public async Task SaveUsesSameDirectoryTemporaryFileAndRoundTripsV4()
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

        Assert.Equal(MigrationStatus.AlreadyV4, loaded.Status);
        Assert.Equal("Replaced safely", loaded.Document!.Name);
        Assert.Empty(Directory.EnumerateFiles(root, "*.tmp.*"));
    }
}
