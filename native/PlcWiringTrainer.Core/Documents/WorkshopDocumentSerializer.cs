using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace PlcWiringTrainer.Core.Documents;

public static class WorkshopDocumentSerializer
{
    private static readonly JsonSerializerOptions CompactOptions = CreateOptions(writeIndented: false);
    private static readonly JsonSerializerOptions IndentedOptions = CreateOptions(writeIndented: true);

    public static WorkshopDocumentV5 Deserialize(string json, bool verifyHash = true)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(json);
        WorkshopDocumentV5 document = JsonSerializer.Deserialize<WorkshopDocumentV5>(json, CompactOptions)
            ?? throw new InvalidDataException("문서 내용을 읽을 수 없습니다.");

        if (document.SchemaVersion != 5)
        {
            throw new InvalidDataException($"지원하지 않는 문서 스키마입니다: {document.SchemaVersion}");
        }

        if (string.IsNullOrWhiteSpace(document.DocumentId))
        {
            throw new InvalidDataException("문서 ID가 없습니다.");
        }

        if (verifyHash && !DocumentHasher.MatchesContentHash(document))
        {
            throw new InvalidDataException("문서 내용 해시가 일치하지 않습니다.");
        }

        return document;
    }

    public static string Serialize(WorkshopDocumentV5 document)
    {
        ArgumentNullException.ThrowIfNull(document);
        return JsonSerializer.Serialize(document, IndentedOptions) + Environment.NewLine;
    }

    internal static string SerializeCanonicalCandidate(WorkshopDocumentV5 document)
        => JsonSerializer.Serialize(document, CompactOptions);

    private static JsonSerializerOptions CreateOptions(bool writeIndented)
        => new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
            WriteIndented = writeIndented,
            DefaultIgnoreCondition = JsonIgnoreCondition.Never,
            Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        };
}

public static class DocumentHasher
{
    public static WorkshopDocumentV5 WithContentHash(WorkshopDocumentV5 document)
    {
        ArgumentNullException.ThrowIfNull(document);
        string hash = ComputeContentHash(document);
        return document with { ContentHash = hash };
    }

    public static bool MatchesContentHash(WorkshopDocumentV5 document)
    {
        ArgumentNullException.ThrowIfNull(document);
        return document.ContentHash.Length == 64
            && string.Equals(document.ContentHash, ComputeContentHash(document), StringComparison.OrdinalIgnoreCase);
    }

    public static string ComputeContentHash(WorkshopDocumentV5 document)
    {
        ArgumentNullException.ThrowIfNull(document);
        string json = WorkshopDocumentSerializer.SerializeCanonicalCandidate(document with { ContentHash = string.Empty });
        JsonNode root = JsonNode.Parse(json) ?? throw new InvalidDataException("문서 해시를 계산할 수 없습니다.");
        string canonical = Canonicalize(root);
        byte[] digest = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
        return Convert.ToHexStringLower(digest);
    }

    private static string Canonicalize(JsonNode node)
    {
        var builder = new StringBuilder();
        WriteCanonical(node, builder);
        return builder.ToString();
    }

    private static void WriteCanonical(JsonNode? node, StringBuilder builder)
    {
        switch (node)
        {
            case null:
                builder.Append("null");
                break;
            case JsonObject jsonObject:
                builder.Append('{');
                bool firstProperty = true;
                foreach (KeyValuePair<string, JsonNode?> property in jsonObject.OrderBy(item => item.Key, StringComparer.Ordinal))
                {
                    if (!firstProperty)
                    {
                        builder.Append(',');
                    }

                    firstProperty = false;
                    builder.Append(JsonSerializer.Serialize(property.Key));
                    builder.Append(':');
                    WriteCanonical(property.Value, builder);
                }

                builder.Append('}');
                break;
            case JsonArray jsonArray:
                builder.Append('[');
                for (int index = 0; index < jsonArray.Count; index++)
                {
                    if (index > 0)
                    {
                        builder.Append(',');
                    }

                    WriteCanonical(jsonArray[index], builder);
                }

                builder.Append(']');
                break;
            default:
                builder.Append(node.ToJsonString());
                break;
        }
    }
}
