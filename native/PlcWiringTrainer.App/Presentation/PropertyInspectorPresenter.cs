using PlcWiringTrainer.App.Controls;
using PlcWiringTrainer.Core.Documents;

namespace PlcWiringTrainer.App.Presentation;

/// <summary>캔버스 선택 ID를 현재 문서의 속성 대상에 안전하게 해석합니다.</summary>
internal static class PropertyInspectorPresenter
{
    public static PropertyInspectorSelection Resolve(
        WorkshopDocumentV5 document,
        CanvasSelection selection)
        => selection.Kind switch
        {
            CanvasSelectionKind.Device => new PropertyInspectorSelection(
                document.Devices.FirstOrDefault(item => item.Id == selection.Id),
                null,
                null),
            CanvasSelectionKind.Conductor => new PropertyInspectorSelection(
                null,
                document.Conductors.FirstOrDefault(item => item.Id == selection.Id),
                null),
            CanvasSelectionKind.Terminal => new PropertyInspectorSelection(null, null, selection.Id),
            _ => PropertyInspectorSelection.Empty,
        };
}

internal sealed record PropertyInspectorSelection(
    DeviceInstanceV5? Device,
    ConductorV5? Conductor,
    string? TerminalKey)
{
    public static PropertyInspectorSelection Empty { get; } = new(null, null, null);
}
