using PlcWiringTrainer.Core.Workbench;

namespace PlcWiringTrainer.App.Presentation;

/// <summary>검증 수명 상태와 문제 목록을 화면 표시 모델로 변환합니다.</summary>
internal static class ValidationPresenter
{
    public static ValidationPresentation Present(WorkbenchStore store)
    {
        string freshness = store.ValidationFreshness switch
        {
            ValidationFreshness.Stale => "STALE · 편집 내용이 바뀌어 결과를 다시 계산합니다.",
            ValidationFreshness.Running => "RUNNING · 백그라운드에서 결선을 계산 중입니다.",
            ValidationFreshness.Blocked => $"BLOCKED · 차단 문제 있음 · rev {store.ValidationResult?.Revision}",
            ValidationFreshness.Fail => $"FAIL · 검증 오류 있음 · rev {store.ValidationResult?.Revision}",
            _ => $"PASS · 현재 문서와 일치 · rev {store.ValidationResult?.Revision}",
        };

        if (store.ValidationResult is null)
        {
            return new ValidationPresentation(freshness, "검증 대기", []);
        }

        ValidationIssueItem[] items = store.ValidationResult.Issues
            .Select(issue => new ValidationIssueItem(issue))
            .ToArray();
        int blocking = store.ValidationResult.Issues.Count(issue => issue.Blocking);
        string summary = blocking == 0
            ? $"차단 오류 없음 · 안내 {items.Length}건"
            : $"차단 오류 {blocking}건 · 전체 {items.Length}건";
        return new ValidationPresentation(freshness, summary, items);
    }
}

internal sealed record ValidationPresentation(
    string Freshness,
    string Summary,
    ValidationIssueItem[] Items);
