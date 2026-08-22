namespace PlcWiringTrainer.Core.Wiring;

/// <summary>레거시 저장본과 현재 validator가 공유하는 단자 별칭의 단일 원천입니다.</summary>
internal static class TerminalAliasRegistry
{
    public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> ByLegacyType { get; } =
        new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.OrdinalIgnoreCase)
        {
            ["EXP2-700"] = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["V+"] = "DC24V",
                ["V-"] = "DC0V",
                ["T+"] = "COM1-6",
                ["485+"] = "COM1-6",
                ["RS485+"] = "COM1-6",
                ["T-"] = "COM1-1",
                ["485-"] = "COM1-1",
                ["RS485-"] = "COM1-1",
                ["RXD"] = "COM2-2",
                ["TXD"] = "COM2-3",
                ["SG"] = "COM2-5",
                ["COM3-RDB"] = "COM3-RX-",
                ["COM3-RDA"] = "COM3-RX+",
                ["COM3-SDB"] = "COM3-TX-",
                ["COM3-SDA"] = "COM3-TX+",
            },
        };

    public static string Resolve(string legacyType, string terminalId)
        => ByLegacyType.TryGetValue(legacyType, out IReadOnlyDictionary<string, string>? aliases)
            && aliases.TryGetValue(terminalId, out string? canonical)
                ? canonical
                : terminalId;
}
