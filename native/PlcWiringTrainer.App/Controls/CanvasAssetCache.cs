using System.Numerics;
using System.Runtime.InteropServices;
using Microsoft.Graphics.Canvas;
using Microsoft.Graphics.Canvas.Svg;
using Microsoft.Graphics.Canvas.UI.Xaml;
using PlcWiringTrainer.Core.Validation;
using Windows.Foundation;

namespace PlcWiringTrainer.App.Controls;

/// <summary>CanvasControl 수명에 묶인 PNG/SVG 장비 자원을 로드하고 해제합니다.</summary>
internal sealed class CanvasAssetCache
{
    private readonly Dictionary<string, CanvasBitmap> _bitmaps = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CanvasSvgDocument> _svgDocuments = new(StringComparer.Ordinal);

    public async Task LoadAsync(CanvasControl canvas, IEnumerable<DeviceProfileV5> profiles)
    {
        ArgumentNullException.ThrowIfNull(canvas);
        ArgumentNullException.ThrowIfNull(profiles);
        DisposeResources();
        foreach (DeviceProfileV5 profile in profiles.Where(profile => !string.IsNullOrWhiteSpace(profile.AssetPath)))
        {
            string assetPath = Path.Combine(
                AppContext.BaseDirectory,
                profile.AssetPath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(assetPath))
            {
                continue;
            }

            try
            {
                if (string.Equals(Path.GetExtension(assetPath), ".svg", StringComparison.OrdinalIgnoreCase))
                {
                    string svg = await File.ReadAllTextAsync(assetPath).ConfigureAwait(true);
                    _svgDocuments[profile.Id] = CanvasSvgDocument.LoadFromXml(canvas, svg);
                }
                else
                {
                    _bitmaps[profile.Id] = await CanvasBitmap.LoadAsync(canvas, assetPath);
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException or COMException)
            {
                // 한 교육용 이미지가 손상돼도 문서 편집과 나머지 장비 자원은 계속 사용할 수 있어야 합니다.
            }
        }

        canvas.Invalidate();
    }

    public bool Draw(
        CanvasDrawingSession drawing,
        string profileId,
        double x,
        double y,
        double width,
        double height)
    {
        double imageX = x + 3;
        double imageY = y + 3;
        double imageWidth = Math.Max(1, width - 6);
        double imageHeight = Math.Max(1, height - 6);
        if (_bitmaps.TryGetValue(profileId, out CanvasBitmap? bitmap))
        {
            drawing.DrawImage(bitmap, new Rect(imageX, imageY, imageWidth, imageHeight), bitmap.Bounds);
            return true;
        }

        if (_svgDocuments.TryGetValue(profileId, out CanvasSvgDocument? svgDocument))
        {
            drawing.DrawSvg(
                svgDocument,
                new Size(imageWidth, imageHeight),
                new Vector2((float)imageX, (float)imageY));
            return true;
        }

        return false;
    }

    public void Clear() => DisposeResources();

    private void DisposeResources()
    {
        // Win2D 자원은 만든 CanvasControl의 장치 수명 안에서 명시적으로 해제합니다.
        foreach (CanvasBitmap bitmap in _bitmaps.Values)
        {
            bitmap.Dispose();
        }

        foreach (CanvasSvgDocument document in _svgDocuments.Values)
        {
            document.Dispose();
        }

        _bitmaps.Clear();
        _svgDocuments.Clear();
    }
}
