using System.Text.Json;
using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Tests;

public sealed class MigrationTests
{
    [Fact]
    public async Task V2Migration_PreservesOriginalAndUnknownFields()
    {
        string root = TestDirectory.Create();
        string source = Path.Combine(root, "legacy-v2.json");
        await File.WriteAllTextAsync(source, """
            {
              "schemaVersion": 2,
              "documentId": "legacy-2",
              "revision": 3,
              "name": "Legacy panel",
              "devices": [{ "id": "lamp-1", "profileId": "lamp-green-v1", "x": 10, "y": 20 }],
              "wires": [],
              "vendorField": { "mustRemain": true }
            }
            """);
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));

        MigrationResult result = await migrator.MigrateAsync(source);

        Assert.Equal(MigrationStatus.Converted, result.Status);
        Assert.NotNull(result.Document);
        Assert.True(File.Exists(result.BackupPath));
        JsonElement original = result.Document.Extensions["legacy"].GetProperty("originalDocument");
        Assert.True(original.GetProperty("vendorField").GetProperty("mustRemain").GetBoolean());
        Assert.Equal(4, result.Document.SchemaVersion);
        Assert.True(DocumentHasher.MatchesContentHash(result.Document));
    }

    [Fact]
    public async Task CorruptDocument_IsCopiedToQuarantineAndNeverDeleted()
    {
        string root = TestDirectory.Create();
        string source = Path.Combine(root, "broken.plcw");
        await File.WriteAllTextAsync(source, "{ broken json");
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));

        MigrationResult result = await migrator.MigrateAsync(source);

        Assert.Equal(MigrationStatus.Quarantined, result.Status);
        Assert.True(File.Exists(source));
        Assert.True(File.Exists(result.QuarantinePath));
        Assert.Null(result.Document);
        Assert.False(string.IsNullOrWhiteSpace(result.Error));
    }
}
