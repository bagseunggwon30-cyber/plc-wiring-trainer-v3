[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Executable,

    [Parameter(Mandatory)]
    [string]$DataRoot,

    [Parameter(Mandatory)]
    [string]$EvidenceRoot,

    [Parameter(Mandatory)]
    [string]$PortableZip
)

$ErrorActionPreference = 'Stop'
if (Get-Command dotnet -ErrorAction SilentlyContinue) {
    throw 'Clean portable verification requires a runner without the .NET SDK on PATH'
}

if (Get-Command node -ErrorAction SilentlyContinue) {
    throw 'Clean portable verification requires a runner without Node.js on PATH'
}

$exe = (Resolve-Path -LiteralPath $Executable).Path
$zip = (Resolve-Path -LiteralPath $PortableZip).Path
$data = [IO.Path]::GetFullPath($DataRoot)
$evidence = [IO.Path]::GetFullPath($EvidenceRoot)
New-Item -ItemType Directory -Path $data, $evidence -Force | Out-Null
$legacyDataRoot = Join-Path $env:LOCALAPPDATA 'PLC Wiring Trainer'
if (Test-Path -LiteralPath $legacyDataRoot) {
    throw "Clean snapshot is already contaminated: $legacyDataRoot"
}

$env:PLCW_DATA_ROOT = $data
$shortcutPath = Join-Path $evidence 'PLC Wiring Trainer.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = Split-Path $exe
$shortcut.Save()

Add-Type -AssemblyName UIAutomationClient
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class PlcWiringPortableInput
{
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@

function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$Failure) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        $value = & $Condition
        if ($null -ne $value -and $value -ne $false) { return $value }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    throw $Failure
}

function Find-Element([Windows.Automation.AutomationElement]$Root, [string]$AutomationId) {
    $condition = [Windows.Automation.PropertyCondition]::new(
        [Windows.Automation.AutomationElement]::AutomationIdProperty,
        $AutomationId)
    return $Root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
}

function Start-PortableWindow {
    Start-Process -FilePath $shortcutPath | Out-Null
    $process = Wait-Until {
        Get-Process PlcWiringTrainer -ErrorAction SilentlyContinue |
            Where-Object MainWindowHandle -ne 0 |
            Select-Object -First 1
    } 25 'Portable shortcut did not open a native window'
    $window = [Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    return @{ Process = $process; Window = $window }
}

$first = Start-PortableWindow
$device = Wait-Until { Find-Element $first.Window 'Device:supply' } 15 'Device automation target was not exposed'
$bounds = $device.Current.BoundingRectangle
$x = [int]($bounds.Left + ($bounds.Width / 2))
$y = [int]($bounds.Top + ($bounds.Height / 2))
[PlcWiringPortableInput]::SetCursorPos($x, $y) | Out-Null
[PlcWiringPortableInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[PlcWiringPortableInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)

$label = Wait-Until { Find-Element $first.Window 'DeviceLabelBox' } 10 'Device property editor was not exposed'
$valuePattern = $label.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
$valuePattern.SetValue("portable-recovery-$([DateTime]::UtcNow.Ticks)")
$autosave = Wait-Until {
    Get-ChildItem -LiteralPath (Join-Path $data 'Autosave') -Filter *.plcw -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
} 10 'Autosave was not created after a document edit'

Stop-Process -Id $first.Process.Id -Force
Wait-Until { -not (Get-Process PlcWiringTrainer -ErrorAction SilentlyContinue) } 10 'Forced-exit process remained alive' | Out-Null

$second = Start-PortableWindow
$dialog = Wait-Until { Find-Element $second.Window 'RecoveryDialog' } 15 'Recovery dialog did not appear after forced exit'
$recover = Wait-Until { Find-Element $dialog 'RecoverButton' } 10 'Recovery button was not exposed'
$invoke = $recover.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
Wait-Until { -not (Test-Path -LiteralPath $autosave.FullName) } 10 'Recovered autosave was not removed' | Out-Null

$windowPattern = $second.Window.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern)
$windowPattern.Close()
Wait-Until { -not (Get-Process PlcWiringTrainer -ErrorAction SilentlyContinue) } 10 'Portable app did not exit cleanly' | Out-Null
if (Test-Path -LiteralPath $legacyDataRoot) {
    throw "Portable verification wrote outside PLCW_DATA_ROOT: $legacyDataRoot"
}

@(
    "utc=$([DateTime]::UtcNow.ToString('O'))"
    "commit=$env:GITHUB_SHA"
    "os=$([Environment]::OSVersion.VersionString)"
    "sessionId=$([Diagnostics.Process]::GetCurrentProcess().SessionId)"
    "portableZipSha256=$((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash)"
    "exeSha256=$((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash)"
    "autosaveRecovery=pass"
    "shortcutLaunch=pass"
    "residualProcesses=0"
    "legacyLocalAppDataPollution=0"
) | Set-Content -LiteralPath (Join-Path $evidence 'portable-evidence.txt') -Encoding utf8NoBOM
'Clean portable verification passed.'
