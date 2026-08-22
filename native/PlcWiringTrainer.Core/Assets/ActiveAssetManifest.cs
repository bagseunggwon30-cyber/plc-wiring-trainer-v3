using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Assets;

/// <summary>배포물에 포함할 장비 자산과 그 전기 근거의 고정 정보를 나타냅니다.</summary>
/// <param name="ProfileId">자산을 사용하는 장비 프로필 ID입니다.</param>
/// <param name="RelativePath">포터블 배포물 기준 상대 경로입니다.</param>
/// <param name="Sha256">승인된 원본의 SHA-256입니다.</param>
/// <param name="EvidenceGrade">자산과 단자 보정의 근거 등급입니다.</param>
/// <param name="EvidenceNote">검증에 사용할 수 있는 범위를 설명합니다.</param>
public sealed record ActiveAssetV5(
    string ProfileId,
    string RelativePath,
    string Sha256,
    EvidenceGrade EvidenceGrade,
    string EvidenceNote);

/// <summary>포터블 배포물에 허용된 활성 장비 자산과 고정 해시입니다.</summary>
public static class ActiveAssetManifest
{
    /// <summary>현재 카탈로그에서 배치 가능한 활성 자산 목록을 반환합니다.</summary>
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
