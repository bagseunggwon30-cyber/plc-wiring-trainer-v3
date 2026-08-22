using Microsoft.UI;
using Microsoft.UI.Xaml.Media;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.App;

public sealed class ValidationIssueItem
{
    public ValidationIssueItem(ValidationIssueV5 issue)
    {
        Issue = issue;
        Code = issue.Code;
        Message = issue.Message;
        SeverityLabel = issue.Severity switch
        {
            ValidationSeverity.Error => "오류",
            ValidationSeverity.Warning => "경고",
            _ => "정보",
        };
        BlockingLabel = issue.Blocking ? "작동 차단 문제 · 눌러서 이동" : "안내 · 눌러서 이동";
        BadgeBrush = new SolidColorBrush(issue.Severity switch
        {
            ValidationSeverity.Error => ColorHelper.FromArgb(255, 220, 38, 38),
            ValidationSeverity.Warning => ColorHelper.FromArgb(255, 217, 119, 6),
            _ => ColorHelper.FromArgb(255, 2, 132, 199),
        });
    }

    public ValidationIssueV5 Issue { get; }

    public string Code { get; }

    public string Message { get; }

    public string SeverityLabel { get; }

    public string BlockingLabel { get; }

    public Brush BadgeBrush { get; }
}
