using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Learning;
using PlcWiringTrainer.Core.Validation;

namespace PlcWiringTrainer.Core.Tests;

public sealed class MissionTests
{
    [Fact]
    public void AllLegacyMissionIdsRemainAddressable()
    {
        Assert.Equal(10, LegacyMissionCatalog.Entries.Count);
        Assert.Contains(LegacyMissionCatalog.Entries, mission => mission.Id == "mdr-ac-dc-distribution");
        Assert.Contains(LegacyMissionCatalog.Entries, mission => mission.Id == "door-terminal-block-routing");
        Assert.Equal(10, LegacyMissionCatalog.Entries.Select(mission => mission.Id).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public async Task MissionEvaluatorUsesRoleBindingsAndTheSharedCircuitSolution()
    {
        WorkshopDocumentV5 document = TestDocuments.WithLamp() with
        {
            MissionState = new MissionStateV5(
                "lamp-training",
                0,
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["source"] = "supply",
                    ["load"] = "lamp-1",
                }),
        };
        var mission = new MissionDefinitionV5(
            "lamp-training",
            "lamp-training",
            [
                new MissionRoleDefinitionV5("source", ["dc-supply-24v"]),
                new MissionRoleDefinitionV5("load", ["lamp-green-v1"]),
            ],
            [new MissionConnectionRequirementV5(
                new MissionTerminalRefV5("source", "+24V"),
                new MissionTerminalRefV5("load", "A1"))],
            [],
            ["load"],
            ["개념", "장비", "단자", "정답"]);
        var circuit = new CircuitValidationService(DeviceProfileCatalog.CreateDefault());
        CircuitSolutionV5 solution = await circuit.SolveAsync(document);
        var evaluator = new MissionEvaluator(DeviceProfileCatalog.CreateDefault());

        MissionEvaluationV5 result = evaluator.Evaluate(mission, document, solution);

        Assert.True(result.Passed);
        Assert.Empty(result.Issues);
    }
}
