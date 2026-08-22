using System.Text.Json;
using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Tests;

public sealed class DocumentContractTests
{
    [Fact]
    public void ContentHash_IsStableAndExcludesTheHashField()
    {
        WorkshopDocumentV5 document = TestDocuments.Empty("hash-test");

        WorkshopDocumentV5 hashedOnce = DocumentHasher.WithContentHash(document);
        WorkshopDocumentV5 hashedTwice = DocumentHasher.WithContentHash(hashedOnce);

        Assert.Equal(64, hashedOnce.ContentHash.Length);
        Assert.Equal(hashedOnce.ContentHash, hashedTwice.ContentHash);
        Assert.True(DocumentHasher.MatchesContentHash(hashedOnce));
    }

    [Fact]
    public void Serializer_RoundTripsUnknownV5FieldsAndLegacyPayload()
    {
        const string json = """
            {
              "schemaVersion": 5,
              "documentId": "round-trip",
              "revision": 7,
              "name": "Round trip",
              "devices": [],
              "conductors": [],
              "terminalBridges": [],
              "panel": { "width": 1200, "height": 800 },
              "viewport": { "zoom": 1, "offsetX": 0, "offsetY": 0 },
              "settings": { "gridSize": 10, "snapToGrid": true },
              "extensions": { "legacy": { "mission": "preserve-me" } },
              "contentHash": "",
              "futureRootField": { "answer": 42 }
            }
            """;

        WorkshopDocumentV5 loaded = WorkshopDocumentSerializer.Deserialize(json, verifyHash: false);
        string serialized = WorkshopDocumentSerializer.Serialize(DocumentHasher.WithContentHash(loaded));
        using JsonDocument parsed = JsonDocument.Parse(serialized);

        Assert.Equal(42, parsed.RootElement.GetProperty("futureRootField").GetProperty("answer").GetInt32());
        Assert.Equal(
            "preserve-me",
            parsed.RootElement.GetProperty("extensions").GetProperty("legacy").GetProperty("mission").GetString());
    }
}
