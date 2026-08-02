# XG-SIM x86 host

This process is the only component allowed to activate the registered 32-bit `XimUtil` COM server.

- Target: .NET Framework 4.7.2, x86.
- Transport: versioned JSON lines over stdin/stdout; no TCP listener.
- First request: `hello` with a random session nonce.
- Writes: allow-listed `B<base>S<slot>.IN<channel>` BOOL channels only.
- Reads: allow-listed input and output channels only.
- Cleanup: all allow-listed virtual inputs are reset to `false` before COM objects are released.
- Watchdog: five seconds without an authenticated request disconnects the COM session and resets every allow-listed input.
- Project identity: CPU/project/hash are validated declarations. XimUtil v1 does not expose a verified loaded-project identity, so SIL remains blocked until the operator supplies and separately checks the exact project hash.
- Packaging: the host executable is packaged, but no LS ELECTRIC DLL or sample binary is redistributed.

Build with the installed Visual Studio Build Tools:

```powershell
& 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe' `
  .\native\xgsim-host\XgSimHost.csproj /t:Build /p:Configuration=Release /p:Platform=x86 /m:1
```
