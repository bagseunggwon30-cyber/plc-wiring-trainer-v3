using Microsoft.UI.Xaml;

namespace PlcWiringTrainer.App;

public sealed class PaletteItem
{
    public PaletteItem(
        string profileId,
        string displayName,
        string assetUri,
        string category,
        string evidenceLabel,
        string availabilityLabel,
        bool canPlace,
        bool isManualVerified)
    {
        ProfileId = profileId;
        DisplayName = displayName;
        AssetUri = assetUri;
        Category = category;
        EvidenceLabel = evidenceLabel;
        AvailabilityLabel = availabilityLabel;
        CategoryAndAvailability = $"{category} · {availabilityLabel}";
        CanPlace = canPlace;
        IsManualVerified = isManualVerified;
    }

    public string ProfileId { get; }

    public string DisplayName { get; }

    public string AssetUri { get; }

    public string Category { get; }

    public string EvidenceLabel { get; }

    public string AvailabilityLabel { get; }

    public string CategoryAndAvailability { get; }

    public bool CanPlace { get; }

    public bool IsManualVerified { get; }

    public Visibility EditVisibility { get; set; } = Visibility.Collapsed;

    public string HideAutomationName => $"{DisplayName} 팔레트에서 숨기기";
}
