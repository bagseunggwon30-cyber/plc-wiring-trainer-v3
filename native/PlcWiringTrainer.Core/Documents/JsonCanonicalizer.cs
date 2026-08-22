using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PlcWiringTrainer.Core.Documents;

/// <summary>문서 세대와 관계없이 JSON 객체 키를 같은 순서로 기록합니다.</summary>
internal static class JsonCanonicalizer
{
    public static string Canonicalize(JsonNode node)
    {
        ArgumentNullException.ThrowIfNull(node);
        var builder = new StringBuilder();
        Write(node, builder);
        return builder.ToString();
    }

    private static void Write(JsonNode? node, StringBuilder builder)
    {
        switch (node)
        {
            case null:
                builder.Append("null");
                break;
            case JsonObject jsonObject:
                builder.Append('{');
                bool first = true;
                foreach (KeyValuePair<string, JsonNode?> property in jsonObject.OrderBy(
                    item => item.Key,
                    StringComparer.Ordinal))
                {
                    if (!first)
                    {
                        builder.Append(',');
                    }

                    first = false;
                    builder.Append(JsonSerializer.Serialize(property.Key));
                    builder.Append(':');
                    Write(property.Value, builder);
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

                    Write(jsonArray[index], builder);
                }

                builder.Append(']');
                break;
            default:
                builder.Append(node.ToJsonString());
                break;
        }
    }
}
