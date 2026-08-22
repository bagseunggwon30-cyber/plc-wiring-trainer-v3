using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Assets;

public sealed record ActiveAssetV5(
    string ProfileId,
    string RelativePath,
    string Sha256,
    EvidenceGrade EvidenceGrade,
    string EvidenceNote);

/// <summary>포터블 배포물에 허용된 활성 장비 자산과 고정 해시입니다.</summary>
public static class ActiveAssetManifest
{
    public static IReadOnlyList<ActiveAssetV5> Entries { get; } = DeviceProfileCatalog
        .CreateDefault()
        .Profiles
        .Where(profile => profile.IsPaletteVisible)
        .Select(profile => new ActiveAssetV5(
            profile.Id,
            profile.AssetPath,
            profile.Artwork.Sha256,
            profile.EvidenceGrade,
            profile.ManualEvidence switch
            {
                ManualEvidenceStatusV5.ExactProduct => "정확 품번 매뉴얼과 단자 근거가 연결된 레거시 정본",
                ManualEvidenceStatusV5.FamilyManual => "계열 매뉴얼 근거; 정확 품번 검토 전 사전결선 승인 금지",
                _ => "교육용 자산; 검증 근거로 승격하지 않음",
            }))
        .ToArray();
}
