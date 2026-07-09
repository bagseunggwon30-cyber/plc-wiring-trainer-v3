# Trainer Suite Design (Live Coach + Sim Monitor + Report Export + Calib Polish)
Date: 2026-07-09
Scope: 1+2+3+4 combined (approved by user)

## Vision
Turn the existing wiring trainer into a complete practice → verification → record cycle:
- Real-time guidance while wiring (Live Mission Coach)
- Live visibility of simulation state (Sim Monitor)
- One-click export of verifiable artifacts (Trainer Report: wires, BOM, validation, sim snapshot, calib info)
- Polish the already strong calibration system and integrate it with the above.

## Architecture Principles
- Additive only. Do not break existing panel-layout, simulate(), buildNets, validate, GOALS, S.terminalCalibration, undo, save/load.
- Hook into existing hot paths: simulate() loop, validate(), wire add/remove, render.
- Keep single index.html.
- Use existing structures (lastNets, SIM.*, goal.checks, terminalCalibration).
- Client-side only exports (Blob + download).

## Data Extensions (minimal)
- SIM.observables (computed on the fly or cached in simulate)
- Enhance goal.checks with _error for coach
- generateTrainerReport() returns structured object

## 1. Live Mission Coach (primarily #4)
- Enhance / replace #goals content with progress bar + ordered steps.
- Highlight "next recommended step".
- Auto re-evaluate on wire changes, simulate tick, validate.
- Show simple reason when a step is failing.

## 2. Simulation Live Monitor (#3)
- New section (or expand stats) showing:
  - Timers: name, elapsed / preset
  - Cylinders: state + approximate %
  - Key I/O and coil states
- Updates every simulate cycle.

## 3. Trainer Report & Export (#1)
- New button "📄 미션 리포트"
- generateTrainerReport() collects:
  - Mission progress + step details
  - Full wires list (device labels + terminals + pol)
  - BOM (devices + counts)
  - Current sim snapshot
  - Validation summary
  - Calib summary (how many patches)
- Export formats:
  - Full JSON
  - Wires + BOM CSV
  - Pretty printable HTML (with tables)

## 4. Calibration Enhancements (#2)
- Use latest terminal-calibration JSON data for TB4 (already applied in this session).
- Include calib info in reports.
- Small UX: better defaults in createTerminalStrip, ensure patches apply cleanly to generated strips.
- Optional future: mission-specific calib snapshots (not MVP).

## UI Changes
- Right panel: Mission Coach (top), Sim Monitor, keep Netlist + Validation.
- New toolbar button near b-validate and b-export-img.
- Live updates without extra user action.

## Compatibility
- Existing .json workshop saves unchanged.
- Old missions continue to work.
- Calibration patches continue to work; TB positions updated from provided JSON.

## Implementation Order (executed together)
1. Terminal block position fix using provided JSON (TB4).
2. Improve createTerminalStrip defaults.
3. Add coach + monitor rendering + hooks.
4. Add report generator + export.
5. Wire up buttons and live updates.
6. Small calib integration polish.

## Risks & Mitigations
- Monolithic file size: keep new code focused, add at logical points.
- Performance: debounce coach/monitor updates.
- Generated TB width change: tested with rail placement.

This design was presented and explicitly approved ("승인").
