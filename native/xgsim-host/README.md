# XG-SIM x86 host

This process is the only component allowed to activate the registered 32-bit `XimUtil` COM server.

- Target: .NET Framework 4.7.2, x86.
- Transport: versioned JSON lines over stdin/stdout; no TCP listener.
- First request: `hello` with a random session nonce.
- Writes: allow-listed `B<base>S<slot>.IN<channel>` BOOL channels and explicitly allow-listed `M00000`-style BOOL devices only.
- Reads: allow-listed input/output channels plus explicitly allow-listed M devices.
- Cleanup: channels are reset to `false`; writable M devices are set to their per-binding fail-safe values before COM objects are released.
- Watchdog: two seconds without an authenticated request applies the same fail-safe values and disconnects the COM session.
- Cold start: the Electron controller allows up to five seconds for the initial stdio `hello`; all later requests and the native watchdog remain limited to two seconds.
- Device access: XimUtil `ReadDevice`/`WriteDevice` uses packed M bits with a little-endian 16-bit word read-modify-write operation so neighboring M bits are preserved. XGB bit notation is four decimal word digits plus one hexadecimal bit digit (`M00100` = word `10`, bit `0`, byte offset `20`).
- Project identity: CPU/project/hash are validated declarations. XimUtil v1 does not expose a verified loaded-project identity, so SIL remains blocked until the operator supplies and separately checks the exact project hash.
- Packaging: the host executable is packaged, but no LS ELECTRIC DLL or sample binary is redistributed.

Build with the installed Visual Studio Build Tools:

```powershell
& 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe' `
  .\native\xgsim-host\XgSimHost.csproj /t:Build /p:Configuration=Release /p:Platform=x86 /m:1
```
