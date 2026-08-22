using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace PlcWiringTrainer.Core.Documents;

/// <summary>schema v5 JSON의 역직렬화, canonical hash 계산과 직렬화를 담당합니다.</summary>
public static class WorkshopDocumentSerializer
{
    private static readonly JsonSerializerOptions CompactOptions = CreateOptions(writeIndented: false);
    private static readonly JsonSerializerOptions IndentedOptions = CreateOptions(writeIndented: true);

    /// <summary>Deserialize 작업을 수행합니다.</summary>
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

    /// <summary>Serialize 작업을 수행합니다.</summary>
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

/// <summary>DocumentHasher 값을 제공합니다.</summary>
public static class DocumentHasher
{
    /// <summary>WithContentHash 작업을 수행합니다.</summary>
    public static WorkshopDocumentV5 WithContentHash(WorkshopDocumentV5 document)
    {
        ArgumentNullException.ThrowIfNull(document);
        string hash = ComputeContentHash(document);
        return document with { ContentHash = hash };
    }

    /// <summary>MatchesContentHash 작업을 수행합니다.</summary>
    public static bool MatchesContentHash(WorkshopDocumentV5 document)
    {
        ArgumentNullException.ThrowIfNull(document);
        return document.ContentHash.Length == 64
            && string.Equals(document.ContentHash, ComputeContentHash(document), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>ComputeContentHash 작업을 수행합니다.</summary>
    public static string ComputeContentHash(WorkshopDocumentV5 document)
    {
        ArgumentNullException.ThrowIfNull(document);
        string json = WorkshopDocumentSerializer.SerializeCanonicalCandidate(document with { ContentHash = string.Empty });
        JsonNode root = JsonNode.Parse(json) ?? throw new InvalidDataException("문서 해시를 계산할 수 없습니다.");
        string canonical = JsonCanonicalizer.Canonicalize(root);
        byte[] digest = SHA256.HashData(Encoding.UTF8.GetBytes(canonical));
        return Convert.ToHexStringLower(digest);
    }
}
