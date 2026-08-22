using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Wiring;

/// <summary>현재 문서에서 중복되지 않는 최저 W### 선번을 결정합니다.</summary>
internal static class WireNumberAllocator
{
    public static string Next(WorkshopDocumentV5 document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var used = new HashSet<int>();
        foreach (string wireNumber in document.Conductors.Select(conductor => conductor.WireNumber))
        {
            if (wireNumber.Length > 1
                && wireNumber[0] is 'W' or 'w'
                && int.TryParse(wireNumber.AsSpan(1), out int number)
                && number > 0)
            {
                used.Add(number);
            }
        }

        int candidate = 1;
        while (used.Contains(candidate))
        {
            candidate++;
        }

        return $"W{candidate:000}";
    }
}
