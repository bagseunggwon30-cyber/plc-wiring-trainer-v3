# XG-SIM Interface Stage A Evidence

## Status

- Date: 2026-08-02
- Gate: passed -- official input channel -> live XG-SIM ladder -> physical output channel round trip confirmed
- Runtime scope: local XG-SIM only
- Live PLC actions: none

## Official interface evidence

LS ELECTRIC document 617, `XG5000 Simulator (XG-SIM) Interface`, documents that:

- `XimUtil.dll` provides an official COM interface for external applications.
- `DeviceInterface.Connect()` returns `0` on success and documented error codes `1` through `5` otherwise.
- `DeviceInterface.ReadDevice()` reads PLC device memory by device name, byte offset and byte count.
- `DeviceInterface.WriteDevice()` exists, but this project does not expose it because the first integration must not force PLC output memory.
- `ChannelDriver.GetChannelCount()` and `GetChannelNameAt()` enumerate configured I/O channels.
- `ChannelDriver.WriteIOChannel()` is the documented way to provide an external value to a configured input module.
- `ChannelDriver.ReadIOChannel()` is the documented way to observe a configured output channel.
- When I/O parameters are configured, direct writes to the related P/I/U area are overwritten by simulator refresh; a physical-input proof must therefore use channel access.

Sources:

- <https://sol.ls-electric.com/ww/en/community/blog/document/617>
- Official sample: <https://sol.ls-electric.com/uploads/document/16384941572140/XGSimTest_1.zip>
- Official XG5000 V4.78 release notes: <https://ssq.ls-electric.com/uploads/document/17485843129120/ReleaseNote_En_V4.78_250528.pdf>
- Local official help: `C:\XG5000\l.kor\XG5000Help_kor.pdf`, PDF page 636, manual page 15-2

The local help states that XG-SIM is started from XG5000 using `Tools -> Start Simulator`; XG5000 then automatically transfers the written program to XG-SIM and enters the online connected stop state.

## Official sample integrity

- File: `XGSimTest_1.zip`
- Size: 42,746 bytes
- SHA-256: `D6F05C2204737D1CFA462E3BBCBB168839BD173CC60FC328944183FBC229B058`
- Sample target: .NET Framework 4.5, COM reference `XIMUTILLib`
- TypeLib GUID: `{4855EFC3-CE79-47C0-811C-CD7A62E03DE6}`
- TypeLib version: 1.0
- Official sample build result on this workstation: pass after command-line retarget to the installed .NET Framework 4.7.2 targeting pack

No LS binary or official sample source is copied into the application source tree. The downloaded archive remains only under the ignored `tmp/` directory.

## Installed compatibility evidence

| Artifact | Version | SHA-256 |
|---|---|---|
| `C:\XG5000\XG5000.exe` | `4.78.2.0 2025-05-28` | `11003D33F645ECBB86AB29DCCAC69A2D95164CD0CF2145B6AAC42BAD619D0284` |
| `C:\XG5000\XG-SIM\XG-SIM.exe` | `1.0.0.1` | `593D8FA43C0271D64B9DE3A7BF97C2A8B5607943EA8AD79AD56BE65B40A435B7` |
| `C:\XG5000\XG-SIM\XimUtil.dll` | `1.0.0.1` | `1E0C375CB4279032DD6F110A7F2A124471112F19104E5651E1E037BFEEB93806` |
| `C:\XG5000\XG-SIM\XGSimulator.dll` | no file version resource | `7418CB4D45B63061A63ACDB27EA398A81783899B67B54D1DB3E9EAD4960C2D0A` |

Windows registers the TypeLib as a 32-bit TypeLib whose `win32` path is `C:\XG5000\XG-SIM\XimUtil.dll`. This confirms that a 64-bit Electron process must not load it directly.

## Redistribution and deployment decision

The official page provides development documentation and a C# sample but does not grant an explicit right to redistribute `XimUtil.dll` with a third-party application. Therefore:

- The application will not package or redistribute any LS binary.
- XG5000/XG-SIM must already be installed locally.
- The x86 host will resolve the registered local COM TypeLib at runtime.
- Missing installation, wrong bitness or missing registration will return `BLOCKED`, not trigger a copied DLL fallback.

This keeps the implementation inside the confirmed use case without claiming an unconfirmed redistribution right.

## PoC implementation

Files:

- `tools/xgsim-interface-poc/XgSimInterfacePoc.csproj`
- `tools/xgsim-interface-poc/Program.cs`
- `tools/xgsim-interface-poc/README.md`

Properties:

- Fixed `x86` process target.
- Uses only the registered official COM TypeLib.
- Writes only channel names matching `B<base>S<slot>.IN<channel>`.
- Rejects output-channel writes.
- Provides read-only output-channel and device-memory inspection.
- Clears the test input after a round trip.

Build evidence:

- Result: pass
- Output SHA-256: `8D34B83D0CA2A0644FFAB4CBFAD81143E69DA748B1AC86E3C4DD8CA6563F3ADA`

First runtime probe against a standalone XG-SIM window:

```text
PROBE connect=failed connectCode=1 base=0 slot=0 channelCount=0
```

This is the documented `DEVICE_SERVER_NOT_READY` result. It proves COM activation and method invocation work, while also proving that launching `XG-SIM.exe` alone is insufficient. XG5000 must load a project using the official simulator-start operation before the input-to-ladder-to-output round trip can run.

Probe after starting the selected project through the official XG5000 simulator menu:

```text
PROBE connect=ok connectCode=0 base=0 slot=0 channelCount=30
CHANNEL index=0..17 name=B0S00.IN00..B0S00.IN17
CHANNEL index=18..29 name=B0S00.OUT00..B0S00.OUT11
```

This confirms that XG5000 4.78.2.0, the installed XG-SIM 1.0.0.1 and the registered 32-bit XimUtil COM server interoperate on this workstation.

The input channel write was also observed in the P device image:

```text
INPUT_BOOL_WRITTEN name=B0S00.IN02 value=true
CHANNEL_BOOL name=B0S00.IN02 value=true
DEVICE_READ device=P offset=0 size=8 code=0 hex=0400000000000000
```

For the loaded `SEQ015` program, driving `IN01` and `IN03` produced ladder internal coils in the M device image, then cleared after the inputs were released:

```text
DEVICE_READ device=M offset=0 size=8 code=0 hex=0000000007000000
DEVICE_READ device=M offset=0 size=16 code=0 hex=00000000000000000000000000000000
```

The XG5000 ladder view showed that this loaded project contains only three rungs ending in `M00020`, `M00021` and `M00022`. It contains no physical P-output coil. Every `B0S00.OUT00..OUT11` therefore remained false. The adjacent `manifest.json`, which claims `P00040..P00045` outputs, is stale and must not be treated as executable-project evidence.

The separate generated candidate `ELEC_SEQ_015_SELFHOLD_FINAL.xgwx` contains 14 encoded rows including `P00040..P00045`, but XG5000 4.78.2.0 rejects it with `파일을 읽을 때 오류가 발생했습니다.` It is excluded from the PoC and must not be repaired by undocumented binary manipulation.

## Passing physical-output round trip

The valid original project used for the final Stage A proof is:

- `C:\XG5000\Projects\15번\15번.xgwx`
- CPU family shown by XG5000: `XGB-XBCH`
- XG5000 program check: no errors, one duplicate-coil warning for `P00000`
- XG-SIM state: local simulator, run

The live ladder and decoded project data both identify this path:

```text
B0S00.IN03 / P00003 -> M00100 -> P00021 / B0S00.OUT01
```

The official COM probe enumerated 16 input and 16 output channels. The guarded PoC then wrote only `IN03`, read only `OUT01`, and cleared the input afterward:

```text
PROBE connect=ok connectCode=0 base=0 slot=0 channelCount=32
ROUNDTRIP input=B0S00.IN03 output=B0S00.OUT01 baseline=pass rising=pass falling=pass observations=0:0,0:0,31:1,0:1,31:0
CHANNEL_BOOL name=B0S00.IN03 value=false
CHANNEL_BOOL name=B0S00.OUT01 value=false
DEVICE_READ device=M offset=32 size=4 code=0 hex=00000000
ROUNDTRIP_EXIT=0
```

## Implementation boundary after the PoC

The verified transport is now implemented as a separately built .NET Framework 4.7.2 x86 host under `native/xgsim-host`. Electron x64 communicates with it only through versioned JSON lines over stdio and a session nonce. The renderer can write only allow-listed `IN` BOOL channels or explicitly declared M request bits; no output-write IPC exists. EOF, explicit shutdown, host error, request timeout, and a two-second authenticated-request watchdog apply each binding's fail-safe value before disconnecting.

The first domain vertical slice is deliberately split into three authorities:

1. the v3 circuit solver decides whether the start/stop input branches are actually energized;
2. the PLC adapter runs the ladder and returns the output image;
3. the v3 circuit solver applies the dry-contact output and decides whether the MY2N coil and lamp have a complete source/return path.

The official interface does not expose a cryptographically verifiable identity for the currently loaded project and does not expose a documented ladder scan-complete event. Therefore the real-interface panel remains a transport diagnostic and emits `PROJECT_IDENTITY_UNVERIFIED`; it cannot issue `SIL_PASS`. The deterministic mock vertical slice covers P20/self-hold/circuit behavior, while the observed real `15번` project evidence remains the exact P03-to-P21 path above. These two mappings are not silently conflated.

This satisfies the Stage A gate: one official input-channel write propagated through a running XG-SIM ladder and was observed on a configured physical output channel, including return to the safe false state. No output channel, output device memory or real PLC was written.

## Stage A conclusion

The selected passing project is `C:\XG5000\Projects\15번\15번.xgwx`, with CPU family `XGB-XBCH` and the exact P03-to-P21 mapping recorded above. Its SHA-256 could not be read while XG5000 held the project file open, so project identity remains unverified and the real-interface result remains `BLOCKED` for SIL/prewire approval. `tools/Get-XgSimProjectIdentity.ps1` can calculate the hash after the project is closed.

The official interface, local installation compatibility and physical-output round trip are confirmed. Runtime integration is implemented behind the x86 sidecar boundary with output-write rejection and fail-safe cleanup. It remains diagnostic until project identity and a documented scan-complete signal can be verified.

## `4층_GEMINI` M-device closed-loop proof

The user-selected project was tested without editing its existing ladder or project file:

- project file: `4층_GEMINI.xgwx` (the local absolute path stays only in `XgSimLocalProjectRefV1`)
- SHA-256: `883a5c1f24820a1a45938dc338fd52650b875876b14620ef375055be1ab7da04`
- CPU: `XGB-XBCH`
- XG5000 Program Check: 0 errors, 82 warnings, 13 messages
- input requests: `M00001` start and `M00002` stop
- observed run latch: `M00100`
- virtual output mapping: `M00100` drives the XBC P21 dry contact, MY2N coil and run lamp

The native host uses a little-endian 16-bit word read-modify-write operation so changing one M bit does not overwrite adjacent bits. XGB addresses are parsed as four decimal word digits followed by one hexadecimal bit digit. Therefore `M00100` means decimal word 10, bit 0 and byte offset 20; it is not hexadecimal address `0x100`.

The live Electron-to-XG-SIM-to-circuit round trip passed all five steps:

```text
initial        M00001=0 M00002=0 M00100=0 relay=OFF lamp=OFF
start pressed  M00001=1 M00002=0 M00100=1 relay=ON  lamp=ON
start released M00001=0 M00002=0 M00100=1 relay=ON  lamp=ON
stop pressed   M00001=0 M00002=1 M00100=0 relay=OFF lamp=OFF
stop released  M00001=0 M00002=0 M00100=0 relay=OFF lamp=OFF
```

Each expected output was observed twice consecutively. Safe stop then wrote `M00001=false` and `M00002=true`, observed `M00100=false` twice and disconnected. The app reported `SAFE-STOPPED · ROUNDTRIP_PASS · PROJECT_IDENTITY_UNVERIFIED`.

This proves the requested start, self-hold, stop, relay-coil and lamp behavior in the local simulator. It remains formally `BLOCKED(PROJECT_IDENTITY_UNVERIFIED)` because XimUtil cannot attest which project XG-SIM currently has loaded. No physical PLC I/O, user ladder, device image or SVG asset was changed.

## Final renderer audit

The Codex in-app browser loaded the Vite preview at 1280 x 720 in review mode. The existing MDR-100-24, XBC-DR32H, XBF-AH04A, MY2N-D2 and UT 2,5 palette entries, the wiring control and the XG-SIM diagnostic panel were present. Because the browser preview has no Electron preload bridge, the panel correctly reported `BLOCKED` and disabled all runtime actions. The browser error log was empty. Evidence: `output/browser/xgsim-panel-final.jpg`.
