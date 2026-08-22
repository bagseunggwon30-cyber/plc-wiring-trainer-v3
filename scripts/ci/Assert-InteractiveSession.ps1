[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [int]$Width,

    [Parameter(Mandatory)]
    [int]$Height,

    [Parameter(Mandatory)]
    [int]$Dpi
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class PlcWiringDisplayProbe
{
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForSystem();
}
'@

$sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
if ($sessionId -eq 0) {
    throw 'UI verification cannot run in Windows Session 0'
}

$explorer = Get-Process explorer -ErrorAction SilentlyContinue |
    Where-Object SessionId -eq $sessionId |
    Select-Object -First 1
if (-not $explorer) {
    throw "No interactive Explorer shell exists in session $sessionId"
}

$actualWidth = [PlcWiringDisplayProbe]::GetSystemMetrics(0)
$actualHeight = [PlcWiringDisplayProbe]::GetSystemMetrics(1)
$actualDpi = [int][PlcWiringDisplayProbe]::GetDpiForSystem()
if ($actualWidth -ne $Width -or $actualHeight -ne $Height -or $actualDpi -ne $Dpi) {
    throw "Display mismatch: expected ${Width}x${Height} dpi=$Dpi, actual ${actualWidth}x${actualHeight} dpi=$actualDpi"
}

if (Get-Process PlcWiringTrainer -ErrorAction SilentlyContinue) {
    throw 'A residual PlcWiringTrainer process exists before UI verification'
}

"Interactive session verified: session=$sessionId display=${actualWidth}x${actualHeight} dpi=$actualDpi"
