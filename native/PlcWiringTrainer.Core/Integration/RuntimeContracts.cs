using System.Text;
using System.Text.Json;
using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Integration;

public sealed record AutomationInputV5(string Id, double Value, bool Active);

public sealed record AutomationFrameV5(
    long Sequence,
    TimeSpan Elapsed,
    Dictionary<string, double> States,
    string[] ActiveAnimations);

public interface IAutomationRuntime
{
    AutomationFrameV5 Reset(WorkshopDocumentV5 document);

    AutomationFrameV5 Advance(
        WorkshopDocumentV5 document,
        CircuitSolutionV5 circuit,
        AutomationInputV5[] inputs,
        TimeSpan elapsed);
}

public enum XgSimConnectionStatusV5
{
    Connected,
    Unavailable,
    TimedOut,
    ProjectIdentityUnverified,
    ProtocolError,
}

public sealed record XgSimConnectionRequestV5(
    string ExpectedProjectId,
    string? ProvenProjectIdentity,
    TimeSpan Timeout);

public sealed record XgSimConnectionResultV5(
    XgSimConnectionStatusV5 Status,
    string Message,
    bool CanIssueSilPass);

public interface IXgSimAdapter
{
    Task<XgSimConnectionResultV5> ConnectAsync(
        XgSimConnectionRequestV5 request,
        CancellationToken cancellationToken = default);

    Task FailSafeResetAsync(CancellationToken cancellationToken = default);
}

/// <summary>공식 API로 프로젝트 신원을 증명할 수 없는 환경에서는 연결과 SIL 판정을 차단합니다.</summary>
public sealed class FailClosedXgSimAdapter : IXgSimAdapter
{
    public Task<XgSimConnectionResultV5> ConnectAsync(
        XgSimConnectionRequestV5 request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(request.ProvenProjectIdentity)
            || !string.Equals(
                request.ExpectedProjectId,
                request.ProvenProjectIdentity,
                StringComparison.Ordinal))
        {
            return Task.FromResult(new XgSimConnectionResultV5(
                XgSimConnectionStatusV5.ProjectIdentityUnverified,
                "PROJECT_IDENTITY_UNVERIFIED",
                false));
        }

        return Task.FromResult(new XgSimConnectionResultV5(
            XgSimConnectionStatusV5.Unavailable,
            "LS 공식 어댑터 호스트가 연결되지 않았습니다.",
            false));
    }

    public Task FailSafeResetAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

public sealed record XgSimRequestV5(
    string RequestId,
    string Operation,
    Dictionary<string, string> Payload);

public static class XgSimJsonlProtocol
{
    public const int MaximumFrameBytes = 64 * 1024;

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static byte[] Serialize(XgSimRequestV5 request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (string.IsNullOrWhiteSpace(request.RequestId) || string.IsNullOrWhiteSpace(request.Operation))
        {
            throw new InvalidDataException("XG-SIM 프레임에는 requestId와 operation이 필요합니다.");
        }

        byte[] content = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request, Options) + "\n");
        return content.Length <= MaximumFrameBytes
            ? content
            : throw new InvalidDataException($"XG-SIM 프레임이 {MaximumFrameBytes}바이트 제한을 초과했습니다.");
    }

    public static XgSimRequestV5 Parse(ReadOnlySpan<byte> frame)
    {
        if (frame.Length == 0 || frame.Length > MaximumFrameBytes || frame[^1] != (byte)'\n')
        {
            throw new InvalidDataException("XG-SIM JSONL 프레임 길이 또는 줄 끝이 올바르지 않습니다.");
        }

        XgSimRequestV5? request = JsonSerializer.Deserialize<XgSimRequestV5>(frame[..^1], Options);
        return request is not null
            && !string.IsNullOrWhiteSpace(request.RequestId)
            && !string.IsNullOrWhiteSpace(request.Operation)
                ? request
                : throw new InvalidDataException("XG-SIM JSONL 프레임 계약이 올바르지 않습니다.");
    }
}

public sealed record SceneSelectionV5(
    string? DeviceId,
    TerminalRefV5? Terminal,
    string? ConductorId);

public interface ISceneRenderer
{
    void Initialize(nint surfaceHandle, double dpiScale);

    void Render(WorkshopDocumentV5 document, SceneSelectionV5 selection);

    SceneSelectionV5 HitTest(double x, double y);

    void ResetDeviceResources();
}
