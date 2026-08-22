using PlcWiringTrainer.Core.Integration;

namespace PlcWiringTrainer.Core.Tests;

public sealed class IntegrationContractTests
{
    [Fact]
    public void XgSimProtocolRejectsOversizedFrames()
    {
        var request = new XgSimRequestV5(
            "request-1",
            "write-frame",
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["payload"] = new string('X', XgSimJsonlProtocol.MaximumFrameBytes),
            });

        Assert.Throws<InvalidDataException>(() => XgSimJsonlProtocol.Serialize(request));
    }

    [Fact]
    public async Task AdapterFailsClosedWhenProjectIdentityCannotBeProven()
    {
        var adapter = new FailClosedXgSimAdapter();

        XgSimConnectionResultV5 result = await adapter.ConnectAsync(
            new XgSimConnectionRequestV5("project-a", null, TimeSpan.FromSeconds(2)));

        Assert.Equal(XgSimConnectionStatusV5.ProjectIdentityUnverified, result.Status);
        Assert.False(result.CanIssueSilPass);
    }
}
