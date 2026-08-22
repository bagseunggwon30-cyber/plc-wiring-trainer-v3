using Microsoft.UI.Xaml;
using PlcWiringTrainer.Core.Palette;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.App.Presentation;

/// <summary>팔레트 검색·숨김·펼침 상태를 한 설정 소스에서 관리합니다.</summary>
internal sealed class PaletteController
{
    private readonly PalettePreferencesStore _preferencesStore;
    private readonly HashSet<string> _hiddenProfileIds;

    public PaletteController(DeviceProfileCatalog catalog, PalettePreferencesStore preferencesStore)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        _preferencesStore = preferencesStore ?? throw new ArgumentNullException(nameof(preferencesStore));
        PalettePreferencesV1 preferences = _preferencesStore.Load();
        _hiddenProfileIds = new HashSet<string>(preferences.HiddenProfileIds, StringComparer.Ordinal);
        IsPaneOpen = preferences.IsPaneOpen;
        Items = catalog.Profiles
            .Where(profile => profile.Availability is PaletteAvailabilityV5.Ready or PaletteAvailabilityV5.Preparation)
            .OrderBy(profile => CategoryOrder(profile.Category))
            .ThenBy(profile => profile.Category, StringComparer.Ordinal)
            .ThenBy(profile => profile.DisplayName, StringComparer.Ordinal)
            .Select(ToPaletteItem)
            .ToArray();
        PruneStaleIds();
    }

    public IReadOnlyList<PaletteItem> Items { get; }

    public bool IsPaneOpen { get; private set; }

    public bool IsHidden(string profileId) => _hiddenProfileIds.Contains(profileId);

    public int HiddenCount => Items.Count(item => IsHidden(item.ProfileId));

    public IEnumerable<PaletteItem> Filter(string query, bool editMode)
    {
        foreach (PaletteItem item in Items)
        {
            item.EditVisibility = editMode ? Visibility.Visible : Visibility.Collapsed;
        }

        return Items.Where(item => !IsHidden(item.ProfileId) && Matches(item, query));
    }

    public IEnumerable<PaletteItem> QuickInsert(string query)
        => Items.Where(item => item.CanPlace && !IsHidden(item.ProfileId) && Matches(item, query));

    public void SetPaneOpen(bool isOpen)
    {
        bool previous = IsPaneOpen;
        IsPaneOpen = isOpen;
        try
        {
            Save();
        }
        catch
        {
            IsPaneOpen = previous;
            throw;
        }
    }

    public void Hide(string profileId)
    {
        if (!_hiddenProfileIds.Add(profileId))
        {
            return;
        }

        try
        {
            Save();
        }
        catch
        {
            _hiddenProfileIds.Remove(profileId);
            throw;
        }
    }

    public void RestoreAll()
    {
        string[] previous = [.. _hiddenProfileIds];
        _hiddenProfileIds.Clear();
        try
        {
            Save();
        }
        catch
        {
            _hiddenProfileIds.UnionWith(previous);
            throw;
        }
    }

    private void PruneStaleIds()
    {
        var knownIds = new HashSet<string>(Items.Select(item => item.ProfileId), StringComparer.Ordinal);
        string[] stale = _hiddenProfileIds.Where(id => !knownIds.Contains(id)).ToArray();
        if (stale.Length == 0)
        {
            return;
        }

        _hiddenProfileIds.ExceptWith(stale);
        try
        {
            Save();
        }
        catch
        {
            _hiddenProfileIds.UnionWith(stale);
        }
    }

    private void Save()
        => _preferencesStore.Save(new PalettePreferencesV1([.. _hiddenProfileIds], IsPaneOpen));

    private static PaletteItem ToPaletteItem(DeviceProfileV5 profile)
        => new(
            profile.Id,
            profile.DisplayName,
            $"ms-appx:///{profile.AssetPath}",
            profile.Category,
            profile.ManualEvidence switch
            {
                ManualEvidenceStatusV5.ExactProduct => $"정확 품번 · {profile.Manufacturer} {profile.PartNumber}",
                ManualEvidenceStatusV5.FamilyManual => "계열 매뉴얼만 있음 · 전체 주문코드 필요",
                _ => "제조사·전체 품번 필요 · 연습용",
            },
            profile.Availability == PaletteAvailabilityV5.Ready
                ? profile.ManualEvidence == ManualEvidenceStatusV5.ExactProduct
                    ? "매뉴얼 검증 결선 가능"
                    : "연습 결선만 · 사전결선 승인 불가"
                : "준비 중 · 배치/검증 잠금",
            profile.Availability == PaletteAvailabilityV5.Ready,
            profile.ManualEvidence == ManualEvidenceStatusV5.ExactProduct);

    private static bool Matches(PaletteItem item, string query)
        => string.IsNullOrWhiteSpace(query)
            || item.DisplayName.Contains(query, StringComparison.CurrentCultureIgnoreCase)
            || item.ProfileId.Contains(query, StringComparison.OrdinalIgnoreCase)
            || item.Category.Contains(query, StringComparison.OrdinalIgnoreCase)
            || item.EvidenceLabel.Contains(query, StringComparison.CurrentCultureIgnoreCase);

    private static int CategoryOrder(string category)
        => category.ToLowerInvariant() switch
        {
            "power" => 0,
            "plc" => 1,
            "hmi" => 2,
            "motion" => 3,
            "switch" => 4,
            "sensor" => 5,
            "actuator" => 6,
            "wiring" => 7,
            _ => 99,
        };
}
