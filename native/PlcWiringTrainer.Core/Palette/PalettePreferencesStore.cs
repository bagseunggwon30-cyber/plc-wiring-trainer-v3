using System.Text;
using System.Text.Json;

namespace PlcWiringTrainer.Core.Palette;

/// <summary>사용자가 팔레트에서 숨긴 장비 ID를 보존합니다.</summary>
public sealed record PalettePreferencesV1(string[] HiddenProfileIds);

/// <summary>패키지 식별자가 없는 포터블 앱용 팔레트 설정 저장소입니다.</summary>
public sealed class PalettePreferencesStore
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    private readonly string _path;

    public PalettePreferencesStore(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        _path = Path.GetFullPath(path);
    }

    public PalettePreferencesV1 Load()
    {
        if (!File.Exists(_path))
        {
            return new PalettePreferencesV1([]);
        }

        try
        {
            string json = File.ReadAllText(_path, Encoding.UTF8);
            PalettePreferencesV1? preferences = JsonSerializer.Deserialize<PalettePreferencesV1>(json, Options);
            return Normalize(preferences ?? new PalettePreferencesV1([]));
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            // 손상된 개인 UI 설정 때문에 전체 장비 카탈로그가 사라져 보이면 안 됩니다.
            return new PalettePreferencesV1([]);
        }
    }

    public void Save(PalettePreferencesV1 preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        PalettePreferencesV1 normalized = Normalize(preferences);
        string? directory = Path.GetDirectoryName(_path);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        string temporaryPath = $"{_path}.tmp-{Guid.NewGuid():N}";
        try
        {
            string json = JsonSerializer.Serialize(normalized, Options) + Environment.NewLine;
            File.WriteAllText(temporaryPath, json, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.Move(temporaryPath, _path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    private static PalettePreferencesV1 Normalize(PalettePreferencesV1 preferences)
        => new(preferences.HiddenProfileIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(id => id, StringComparer.Ordinal)
            .ToArray());
}
