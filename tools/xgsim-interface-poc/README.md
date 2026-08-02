# XG-SIM Interface PoC

This is a local, x86-only proof program for the officially documented XG-SIM COM interface.

Official source:

- <https://sol.ls-electric.com/ww/en/community/blog/document/617>
- Official sample attachment: `XGSimTest_1.zip`
- Local TypeLib: `{4855EFC3-CE79-47C0-811C-CD7A62E03DE6}`, version 1.0

The project does not contain or redistribute `XimUtil.dll`. It resolves the registered COM TypeLib from an existing XG5000/XG-SIM installation at build and runtime.

Safety boundary:

- Connects only to local XG-SIM.
- Writes only documented channel names matching `B<base>S<slot>.IN<channel>`.
- Never writes an output channel or PLC device memory.
- Reads output channels and device memory for evidence only.
- Restores the test input channel to `false` after a round trip.

Build:

```powershell
& 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe' `
  .\XgSimInterfacePoc.csproj /t:Build /p:Configuration=Debug /p:Platform=x86 /m:1
```

Example:

```powershell
.\bin\Debug\xgsim-interface-poc.exe probe 0 0
.\bin\Debug\xgsim-interface-poc.exe list-channels 0 0
.\bin\Debug\xgsim-interface-poc.exe roundtrip-bool B0S00.IN00 B0S01.OUT00 3000
```

The round-trip command is considered successful only when the output is initially false, becomes true after the input is written, and returns to false after the input is cleared. XG-SIM must already be running with a matching XG5000 project and ladder.
