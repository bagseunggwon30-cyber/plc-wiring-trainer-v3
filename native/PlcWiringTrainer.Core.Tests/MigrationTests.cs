using System.Reflection;
using System.Text.Json;
using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Tests;

public sealed class MigrationTests
{
    [Fact]
    public async Task AllSixtyFourLegacyProfileAndTerminalAliasesMigrateBehaviorally()
    {
        const BindingFlags flags = BindingFlags.NonPublic | BindingFlags.Static;
        var profileAliases = Assert.IsAssignableFrom<IReadOnlyDictionary<string, string>>(
            typeof(WorkshopDocumentMigrator).GetField("LegacyProfileAliases", flags)!.GetValue(null));
        var terminalAliasGroups = Assert.IsAssignableFrom<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>>(
            typeof(WorkshopDocumentMigrator).GetField("LegacyTerminalAliases", flags)!.GetValue(null));
        string[] activeIdentityAliases =
        [
            "dc-supply-24v",
            "lamp-green-v1",
            "lamp-yellow-v1",
            "lamp-white-v1",
            "prox-npn-v2",
            "prox-pnp-v2",
        ];
        Assert.Equal(64, profileAliases.Count + terminalAliasGroups.Sum(group => group.Value.Count) + activeIdentityAliases.Length);

        string root = TestDirectory.Create();
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));
        int index = 0;
        foreach ((string alias, string expectedProfileId) in profileAliases
            .Concat(activeIdentityAliases.Select(alias => new KeyValuePair<string, string>(alias, alias))))
        {
            string source = Path.Combine(root, $"profile-alias-{index++}.json");
            await File.WriteAllTextAsync(source, $$"""
                { "d": { "device": { "type": "{{alias}}", "x": 10, "y": 20 } }, "w": [], "n": 1 }
                """);

            MigrationResult result = await migrator.MigrateAsync(source);

            Assert.Equal(MigrationStatus.Converted, result.Status);
            Assert.Equal(expectedProfileId, Assert.Single(result.Document!.Devices).ProfileId);
        }

        foreach ((string legacyType, IReadOnlyDictionary<string, string> aliases) in terminalAliasGroups)
        {
            foreach ((string alias, string expectedTerminalId) in aliases)
            {
                string source = Path.Combine(root, $"terminal-alias-{index++}.json");
                await File.WriteAllTextAsync(source, $$"""
                    {
                      "d": {
                        "source": { "type": "{{legacyType}}", "x": 10, "y": 20 },
                        "lamp": { "type": "LAMP-W", "x": 200, "y": 20 }
                      },
                      "w": [{
                        "id": "wire",
                        "from": { "dev": "source", "term": "{{alias}}" },
                        "to": { "dev": "lamp", "term": "A1" }
                      }],
                      "n": 1
                    }
                    """);

                MigrationResult result = await migrator.MigrateAsync(source);

                Assert.Equal(MigrationStatus.Converted, result.Status);
                Assert.Equal(expectedTerminalId, Assert.Single(result.Document!.Conductors).Start.TerminalId);
            }
        }
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task LegacyVersionsOneThroughThree_ProduceHashedV5Documents(int schemaVersion)
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
        WorkshopDocumentV5 document = Assert.IsType<WorkshopDocumentV5>(result.Document);
        Assert.Equal(5, document.SchemaVersion);
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
        Assert.Equal(5, result.Document.SchemaVersion);
        Assert.True(DocumentHasher.MatchesContentHash(result.Document));
    }

    [Fact]
    public async Task CompactLegacyState_PreservesObjectDevicesAndDevTermEndpoints()
    {
        string root = TestDirectory.Create();
        string source = Path.Combine(root, "compact-legacy.json");
        await File.WriteAllTextAsync(source, """
            {
              "d": {
                "d1": { "type": "MDR-100", "x": 120, "y": 100, "rot": 90, "scale": 1.25 },
                "d2": { "type": "PB-1C", "label": "운전 PB", "x": 420, "y": 120, "rot": 0, "scale": 1 }
              },
              "w": [
                {
                  "id": "w1",
                  "from": { "dev": "d1", "term": "V+1" },
                  "to": { "dev": "d2", "term": "11" },
                  "tag": "W001",
                  "gauge": "1.5㎟",
                  "color": "#d33",
                  "waypoints": [{ "x": 260, "y": 100 }],
                  "routeLocked": true
                }
              ],
              "n": 3,
              "workspaceView": "schematic",
              "diagramLayouts": { "schematic": { "d1": { "x": 10, "y": 20 } } },
              "jumpers": []
            }
            """);
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));

        MigrationResult result = await migrator.MigrateAsync(source);

        Assert.Equal(MigrationStatus.Converted, result.Status);
        WorkshopDocumentV5 document = Assert.IsType<WorkshopDocumentV5>(result.Document);
        Assert.Equal(5, document.SchemaVersion);
        Assert.Equal(2, document.Devices.Length);
        Assert.Equal("mean-well:mdr-100-24", document.Devices.Single(device => device.Id == "d1").ProfileId);
        Assert.Equal("MDR-100", document.Devices.Single(device => device.Id == "d1").CatalogEntryId);
        Assert.Equal("educational:pushbutton-1c", document.Devices.Single(device => device.Id == "d2").ProfileId);
        Assert.Equal("PB-1C", document.Devices.Single(device => device.Id == "d2").CatalogEntryId);
        Assert.Equal(90, document.Devices.Single(device => device.Id == "d1").Rotation);
        ConductorV5 conductor = Assert.Single(document.Conductors);
        Assert.Equal(new TerminalRefV5("d1", "V+1"), conductor.Start);
        Assert.Equal(new TerminalRefV5("d2", "11"), conductor.End);
        Assert.Equal("W001", conductor.Label);
        Assert.True(conductor.RouteLocked);
        Assert.Single(conductor.Waypoints);
    }

    [Fact]
    public async Task ActualV3_JoinsConductorMetadataAndBranches()
    {
        string root = TestDirectory.Create();
        string source = Path.Combine(root, "actual-v3.json");
        await File.WriteAllTextAsync(source, """
            {
              "schemaVersion": 3,
              "revision": 9,
              "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "mode": "practice",
              "deviceInstances": [
                {
                  "id": "supply",
                  "profileId": "mean-well:mdr-100-24",
                  "profileVersion": "1.0.0",
                  "assetVersion": "asset-1",
                  "exactOrderCode": "MDR-100-24",
                  "designation": "PS1",
                  "configuration": {},
                  "layoutMm": { "x": 10, "y": 20, "rotation": 0, "width": 120, "height": 80 },
                  "verification": "unverified"
                },
                {
                  "id": "lamp",
                  "profileId": "lamp-green-v1",
                  "profileVersion": "1.0.0",
                  "assetVersion": "asset-2",
                  "exactOrderCode": null,
                  "designation": "H1",
                  "configuration": {},
                  "layoutMm": { "x": 300, "y": 20, "rotation": 0 },
                  "verification": "legacy-unverified"
                }
              ],
              "conductors": [
                {
                  "id": "c1",
                  "cableAssemblyId": "field",
                  "core": "1",
                  "color": "#ef4444",
                  "gauge": "0.75㎟",
                  "wireNumber": "W101",
                  "crossSectionMm2": 0.75,
                  "awg": null,
                  "lengthMm": 420,
                  "pairId": null,
                  "shielded": false,
                  "drain": false,
                  "ferruleFrom": "E7508",
                  "ferruleTo": "E7508",
                  "lugFrom": null,
                  "lugTo": null
                }
              ],
              "conductorBranches": [
                {
                  "id": "b1",
                  "conductorId": "c1",
                  "from": { "elementId": "supply", "terminalId": "V+1" },
                  "to": { "elementId": "lamp", "terminalId": "A1" },
                  "waypointsMm": [{ "x": 180, "y": 24 }]
                }
              ],
              "terminalAssemblies": [],
              "cableAssemblies": [],
              "scenarios": [],
              "settings": {},
              "layout": {},
              "extensions": { "legacy": {} }
            }
            """);
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));

        MigrationResult result = await migrator.MigrateAsync(source);

        Assert.Equal(MigrationStatus.Converted, result.Status);
        WorkshopDocumentV5 document = Assert.IsType<WorkshopDocumentV5>(result.Document);
        Assert.Equal(2, document.Devices.Length);
        ConductorV5 conductor = Assert.Single(document.Conductors);
        Assert.Equal("W101", conductor.Label);
        Assert.Equal(0.75, conductor.GaugeMm2);
        Assert.Equal(new TerminalRefV5("supply", "V+1"), conductor.Start);
        Assert.Equal(new TerminalRefV5("lamp", "A1"), conductor.End);
        Assert.Single(conductor.Waypoints);
    }

    [Fact]
    public async Task CompactSchemaSeven_IsDetectedByShapeInsteadOfRejectedByNumber()
    {
        string root = TestDirectory.Create();
        string source = Path.Combine(root, "compact-v7.json");
        await File.WriteAllTextAsync(source, """
            {
              "schemaVersion": 7,
              "d": { "d1": { "type": "MCCB1P", "x": 120, "y": 120 } },
              "w": [],
              "n": 2,
              "jumpers": []
            }
            """);
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));

        MigrationResult result = await migrator.MigrateAsync(source);

        Assert.Equal(MigrationStatus.Converted, result.Status);
        Assert.Single(result.Document!.Devices);
        Assert.Equal(5, result.Document.SchemaVersion);
    }

    [Fact]
    public async Task NativeV4_IsUpgradedToV5AndTwoEndedJumpersBecomeTerminalBridges()
    {
        string root = TestDirectory.Create();
        string source = Path.Combine(root, "native-v4.plcw");
        await File.WriteAllTextAsync(source, """
            {
              "schemaVersion": 4,
              "documentId": "native-v4",
              "revision": 4,
              "name": "Native v4",
              "devices": [
                { "id": "tb", "profileId": "educational:terminal-block-4", "profileVersion": 1,
                  "evidenceGrade": "educational", "label": "TB1", "x": 10, "y": 20,
                  "rotation": 0, "width": 120, "height": 80, "locked": false, "userProperties": {} }
              ],
              "conductors": [],
              "jumpers": [
                {
                  "id": "j1",
                  "start": { "deviceId": "tb", "terminalId": "1" },
                  "end": { "deviceId": "tb", "terminalId": "2" },
                  "color": "#d33"
                }
              ],
              "panel": { "width": 1200, "height": 800 },
              "viewport": { "zoom": 1, "offsetX": 0, "offsetY": 0 },
              "settings": { "gridSize": 10, "snapToGrid": true },
              "extensions": {},
              "contentHash": ""
            }
            """);
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));

        MigrationResult result = await migrator.MigrateAsync(source);

        Assert.Equal(MigrationStatus.Converted, result.Status);
        Assert.Equal(5, result.Document!.SchemaVersion);
        TerminalBridgeV5 bridge = Assert.Single(result.Document.TerminalBridges);
        Assert.Equal(2, bridge.Terminals.Length);
        Assert.Equal("tb:1", bridge.Terminals[0].Key);
        Assert.Equal("tb:2", bridge.Terminals[1].Key);
    }

    [Fact]
    public async Task CompactMultiTerminalJumper_RemainsOneBridge()
    {
        string root = TestDirectory.Create();
        string source = Path.Combine(root, "compact-bridge.json");
        await File.WriteAllTextAsync(source, """
            {
              "d": { "tb": { "type": "TB4", "x": 10, "y": 20 } },
              "w": [],
              "jumpers": [
                { "id": "bridge-1", "deviceId": "tb", "terms": ["1", "2", "3"], "color": "#d33" }
              ]
            }
            """);
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));

        MigrationResult result = await migrator.MigrateAsync(source);

        TerminalBridgeV5 bridge = Assert.Single(result.Document!.TerminalBridges);
        Assert.Equal(["tb:1", "tb:2", "tb:3"], bridge.Terminals.Select(terminal => terminal.Key));
    }

    [Fact]
    public async Task CompleteV3WithStaleHash_IsQuarantined()
    {
        string root = TestDirectory.Create();
        string source = Path.Combine(root, "stale-v3.json");
        await File.WriteAllTextAsync(source, """
            {
              "schemaVersion": 3,
              "revision": 1,
              "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "sources": [],
              "elements": [],
              "branches": [],
              "sourceSystem": {},
              "reviewScope": {},
              "deviceInstances": [],
              "conductors": [],
              "conductorBranches": []
            }
            """);
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));

        MigrationResult result = await migrator.MigrateAsync(source);

        Assert.Equal(MigrationStatus.Quarantined, result.Status);
        Assert.Contains("해시", result.Error, StringComparison.Ordinal);
        Assert.True(File.Exists(result.QuarantinePath));
    }

    [Fact]
    public async Task NonEmptyLegacyInput_CannotSucceedAsAnEmptyDocument()
    {
        string root = TestDirectory.Create();
        string source = Path.Combine(root, "unsupported-shape.json");
        await File.WriteAllTextAsync(source, """
            {
              "schemaVersion": 3,
              "deviceInstances": [{ "id": "device-1" }],
              "conductorBranches": []
            }
            """);
        var migrator = new WorkshopDocumentMigrator(
            Path.Combine(root, "backups"),
            Path.Combine(root, "quarantine"));

        MigrationResult result = await migrator.MigrateAsync(source);

        Assert.Equal(MigrationStatus.Quarantined, result.Status);
        Assert.Null(result.Document);
        Assert.True(File.Exists(result.QuarantinePath));
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
