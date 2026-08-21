using System.Text.Json;
using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Tests;

public sealed class MigrationTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task LegacyVersionsOneThroughThree_ProduceHashedV4Documents(int schemaVersion)
    {
        string root = TestDirectory.Create();
        string source = Path.Combine(root, $"legacy-v{schemaVersion}.json");
        string versionProperty = schemaVersion == 1 ? string.Empty : $"\"schemaVersion\": {schemaVersion},";
        await File.WriteAllTextAsync(source, $$"""
            {
              {{versionProperty}}
              "documentId": "legacy-{{schemaVersion}}",
              "revision": {{schemaVersion}},
              "devices": [
                { "id": "sensor", "type": "prox-npn-v2", "x": 10, "y": 20 }
              ],
              "wires": [
                {
                  "id": "wire-1",
                  "from": { "equipmentId": "sensor", "portId": "BK" },
                  "to": { "deviceId": "plc", "terminalId": "I0" },
                  "wireNumber": "W001"
                }
              ],
              "unknownLegacyValue": "preserve-me"
            }
            """);
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));

        MigrationResult result = await migrator.MigrateAsync(source);

        Assert.Equal(MigrationStatus.Converted, result.Status);
        WorkshopDocumentV4 document = Assert.IsType<WorkshopDocumentV4>(result.Document);
        Assert.Equal(4, document.SchemaVersion);
        Assert.Equal($"legacy-{schemaVersion}", document.DocumentId);
        Assert.Equal("prox-npn-v2", Assert.Single(document.Devices).ProfileId);
        Assert.Equal("W001", Assert.Single(document.Conductors).Label);
        Assert.Equal(
            "preserve-me",
            document.Extensions["legacy"].GetProperty("originalDocument").GetProperty("unknownLegacyValue").GetString());
        Assert.True(DocumentHasher.MatchesContentHash(document));
        Assert.True(File.Exists(result.BackupPath));
    }

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
