using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.Core.Assets;

public sealed record ActiveAssetV4(
    string ProfileId,
    string RelativePath,
    string Sha256,
    EvidenceGrade EvidenceGrade,
    string EvidenceNote);

/// <summary>포터블 배포물에 허용된 활성 장비 자산과 고정 해시입니다.</summary>
public static class ActiveAssetManifest
{
    public static IReadOnlyList<ActiveAssetV4> Entries { get; } =
    [
        new(
            "dc-supply-24v",
            "Assets/Devices/dc-supply-24v.svg",
            "D10F576E71633FDA5DCCD13AE84B9C1DEC22F0EC4876497E21BBA62723A74B9E",
            EvidenceGrade.Educational,
            "네이티브 편집기용 단순화 도식"),
        new(
            "lamp-green-v1",
            "Assets/Devices/lamp-green-flat-screw-v1.png",
            "9391F32747BEADB390979CDAAAF2E065E0E9894860B54A6536454E71C46339D3",
            EvidenceGrade.Educational,
            "사용자가 교체한 녹색 램프 이미지"),
        new(
            "lamp-yellow-v1",
            "Assets/Devices/lamp-yellow-flat-screw-v1.png",
            "81F6EFA634CC413E6D487CF0F34311FFF52D5547F1F9B31BB83A566BCC12AC7E",
            EvidenceGrade.Educational,
            "사용자가 교체한 황색 램프 이미지"),
        new(
            "lamp-white-v1",
            "Assets/Devices/lamp-white-flat-screw-v1.png",
            "B37BB6A624CC79F07EE94DE3570F26FACEE0DC1206ECF462FC18967350266F8A",
            EvidenceGrade.Educational,
            "사용자가 교체한 백색 램프 이미지"),
        new(
            "prox-npn-v2",
            "Assets/Devices/prox-npn-v2.svg",
            "A2E9D821033A5F38D389044CC578B4B83F85EA4684CE819EEF6B8C1EB2C5EC1A",
            EvidenceGrade.Educational,
            "사용자가 교체한 NPN 센서 이미지; sinking 규칙은 별도 전기 프로필에서 검증"),
        new(
            "prox-pnp-v2",
            "Assets/Devices/prox-pnp-v2.svg",
            "FF6F4888BFB8AAED0C9FC58A4D476623A3D52FA5217D1D6D394EB6738734B295",
            EvidenceGrade.Educational,
            "사용자가 교체한 PNP 센서 이미지; sourcing 규칙은 별도 전기 프로필에서 검증"),
        new(
            "plc-input-24v",
            "Assets/Devices/plc-input-24v.svg",
            "A8468BC88F4880E2A19A1CA9E75D49A17CAF5C3446F51C012E985160A4B62849",
            EvidenceGrade.Educational,
            "네이티브 편집기용 단순화 도식"),
    ];
}
