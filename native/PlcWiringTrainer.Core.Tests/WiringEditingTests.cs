using PlcWiringTrainer.Core.Documents;
using PlcWiringTrainer.Core.Validation;
using PlcWiringTrainer.Core.Wiring;
using PlcWiringTrainer.Core.Workbench;

namespace PlcWiringTrainer.Core.Tests;

public sealed class WiringEditingTests
{
    [Fact]
    public void WireDraftConsumesNoPersistentCommandUntilCompletion()
    {
        var draft = new WireDraftMachine();
        var start = new TerminalRefV5("left", "A1");

        draft.Begin(start, dragInitiated: false);
        draft.AddWaypoint(new PointV5(120, 80));
        draft.AddWaypoint(new PointV5(180, 80));
        Assert.True(draft.RemoveLastWaypoint());
        WireDraftV5 current = Assert.IsType<WireDraftV5>(draft.Current);
        Assert.Equal([new PointV5(120, 80)], current.Waypoints);

        ConductorV5 conductor = draft.Complete(
            new TerminalRefV5("right", "A2"),
            "wire-1",
            "W001",
            "#EF4444",
            0.75);

        Assert.Null(draft.Current);
        Assert.Equal(start, conductor.Start);
        Assert.Equal([new PointV5(120, 80)], conductor.Waypoints);
    }

    [Fact]
    public void ClickingTheStartTerminalAgainCancelsTheDraft()
    {
        var draft = new WireDraftMachine();
        var start = new TerminalRefV5("left", "A1");
        draft.Begin(start, dragInitiated: false);

        Assert.True(draft.ToggleTerminal(start, dragInitiated: false));
        Assert.Null(draft.Current);
    }

    [Fact]
    public void DeviceTransformUsesOneRotationAwareTerminalCoordinate()
    {
        var device = new DeviceInstanceV5(
            "d1", "profile", 1, EvidenceGrade.Educational, "D1",
            100, 200, 90, 240, 160, false, new Dictionary<string, string>());
        var profileSize = new PointV5(120, 80);

        PointV5 world = DeviceTransform.TerminalToWorld(device, profileSize, new PointV5(120, 40));

        Assert.Equal(220, world.X, precision: 6);
        Assert.Equal(400, world.Y, precision: 6);
        Assert.True(DeviceTransform.Contains(device, new PointV5(220, 320)));
        Assert.False(DeviceTransform.Contains(device, new PointV5(50, 50)));
    }

    [Fact]
    public void OrthogonalPlannerPreservesManualWaypointsAndAvoidsDeviceBounds()
    {
        var planner = new OrthogonalRoutePlanner();
        var request = new RouteRequestV5(
            new PointV5(20, 100),
            new PointV5(300, 100),
            new PointV5(40, 100),
            new PointV5(280, 100),
            [new PointV5(150, 40)],
            [new RectV5(110, 70, 80, 60)],
            false);

        PointV5[] route = planner.Plan(request);

        Assert.Contains(new PointV5(150, 40), route);
        Assert.All(route.Zip(route.Skip(1)), pair =>
            Assert.True(pair.First.X == pair.Second.X || pair.First.Y == pair.Second.Y));
        Assert.DoesNotContain(route.Zip(route.Skip(1)), pair =>
            SegmentCrossesInterior(pair.First, pair.Second, request.Obstacles[0]));
    }

    [Fact]
    public async Task RemovingADeviceAndItsWiresIsOneUndoableRevision()
    {
        WorkshopDocumentV5 original = TestDocuments.WithLamp();
        await using var store = new WorkbenchStore(
            original,
            new CircuitValidationService(DeviceProfileCatalog.CreateDefault()),
            TimeSpan.Zero);

        store.RemoveDevice("lamp-1");

        Assert.DoesNotContain(store.Document.Devices, device => device.Id == "lamp-1");
        Assert.Empty(store.Document.Conductors);
        Assert.Equal(original.Revision + 1, store.Document.Revision);
        Assert.True(store.Undo());
        Assert.Equal(2, store.Document.Devices.Length);
        Assert.Equal(2, store.Document.Conductors.Length);
    }

    [Fact]
    public async Task ViewSpecificLayoutKeepsCanonicalDeviceAndWireIds()
    {
        WorkshopDocumentV5 original = TestDocuments.WithLamp();
        await using var store = new WorkbenchStore(
            original,
            new CircuitValidationService(DeviceProfileCatalog.CreateDefault()),
            TimeSpan.Zero);

        store.UpdateViewDevicePosition("schematic", "lamp-1", new PointV5(800, 300));

        Assert.Equal(new PointV5(800, 300), store.Document.ViewLayouts["schematic"].Positions["lamp-1"]);
        Assert.Equal(100, store.Document.Devices.Single(device => device.Id == "lamp-1").X);
        Assert.Equal(original.Conductors.Select(conductor => conductor.Id), store.Document.Conductors.Select(conductor => conductor.Id));
    }

    [Fact]
    public async Task SelectingWithoutMovingDoesNotConsumeARevision()
    {
        WorkshopDocumentV5 original = TestDocuments.WithLamp();
        await using var store = new WorkbenchStore(
            original,
            new CircuitValidationService(DeviceProfileCatalog.CreateDefault()),
            TimeSpan.Zero);

        store.UpdateDevice("lamp-1", device => device with { X = device.X, Y = device.Y });
        store.UpdateConductor("lamp-positive", conductor => conductor with { RouteLocked = conductor.RouteLocked });

        Assert.Equal(original.Revision, store.Document.Revision);
        Assert.False(store.CanUndo);
    }

    [Fact]
    public void CompletedWireRouteCanInsertMoveRecolorAndClearWaypoints()
    {
        ConductorV5 wire = TestDocuments.WithLamp().Conductors[0];

        wire = WireRouteEditor.InsertWaypoint(wire, 0, new PointV5(40, 60));
        wire = WireRouteEditor.MoveWaypoint(wire, 0, new PointV5(80, 90));
        wire = WireRouteEditor.ChangeColor(wire, "#2563EB");

        Assert.Equal([new PointV5(80, 90)], wire.Waypoints);
        Assert.Equal("#2563EB", wire.Color);
        Assert.Empty(WireRouteEditor.ClearWaypoints(wire).Waypoints);
    }

    [Fact]
    public void LockedWireRouteRejectsWaypointChanges()
    {
        ConductorV5 wire = TestDocuments.WithLamp().Conductors[0] with
        {
            Waypoints = [new PointV5(40, 60)],
            RouteLocked = true,
        };

        Assert.Same(wire, WireRouteEditor.InsertWaypoint(wire, 1, new PointV5(80, 90)));
        Assert.Same(wire, WireRouteEditor.MoveWaypoint(wire, 0, new PointV5(90, 100)));
        Assert.Same(wire, WireRouteEditor.ClearWaypoints(wire));
    }

    private static bool SegmentCrossesInterior(PointV5 start, PointV5 end, RectV5 bounds)
    {
        if (start.X == end.X)
        {
            return start.X > bounds.X && start.X < bounds.X + bounds.Width
                && Math.Max(start.Y, end.Y) > bounds.Y
                && Math.Min(start.Y, end.Y) < bounds.Y + bounds.Height;
        }

        return start.Y > bounds.Y && start.Y < bounds.Y + bounds.Height
            && Math.Max(start.X, end.X) > bounds.X
            && Math.Min(start.X, end.X) < bounds.X + bounds.Width;
    }
}
