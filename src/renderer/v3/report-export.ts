import { canonicalStringify } from '../../domain/migration';
import type { V3ReportClassification } from './workflow-state';

export interface V3ClosedLoopEligibility {
  /** Only the closed-loop v3 engine may make a report eligible for prewire verification. */
  engine?: 'v3-closed-loop' | 'legacy-v2';
  eligible: boolean;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'STALE';
  reason: string | null;
}

export interface V3PinToPinRow {
  from: string;
  fromRole?: string;
  to: string;
  toRole?: string;
  conductorRole?: string;
  cableId?: string;
  conductorId?: string;
  wireNumber?: string;
  core?: string;
  color?: string;
  gauge?: string;
  crossSectionMm2?: number;
  awg?: string;
  lengthMm?: number;
  shielded?: boolean;
  drain?: boolean;
  ferruleFrom?: string | null;
  ferruleTo?: string | null;
  lugFrom?: string | null;
  lugTo?: string | null;
}

export interface V3CableCoreRow {
  cableId: string;
  from: string;
  to: string;
  cores: number;
  cableType?: string;
  lengthMm?: number;
  shielded?: boolean;
  drainConductorId?: string | null;
  conductorIds?: readonly string[];
  description?: string;
}

export interface V3TerminalPlanRow {
  designation: string;
  terminal: string;
  signal: string;
  destination: string;
  terminalType?: string | null;
  marker?: string | null;
  accessories?: readonly string[];
}

export interface V3BomRow {
  designation?: string;
  partNumber: string;
  description: string;
  quantity: number;
  manufacturer?: string;
}

export interface V3ExportReport {
  /** Compatibility-only input. Every serializer recalculates its output class from eligibility. */
  classification?: V3ReportClassification;
  title: string;
  eligibility?: V3ClosedLoopEligibility;
  sourceAssumptions?: {
    sourceSystem?: string | null;
    supply?: string | null;
    earthing?: string | null;
    canvasUnitsPerMm?: number | null;
  };
  sourceProtection?: {
    phaseSequence?: string | null;
    prospectiveShortCircuitCurrentA?: number | null;
    protectiveDeviceCurve?: string | null;
  };
  checks?: {
    supported?: readonly string[];
    unsupported?: readonly string[];
  };
  closedLoopPaths?: readonly {
    scenarioId: string;
    sourceId?: string | null;
    loadId?: string | null;
    status: string;
    terminals: readonly string[];
  }[];
  deviceSettings?: readonly {
    designation: string;
    profileId: string;
    orderCode?: string | null;
    settings: Readonly<Record<string, unknown>>;
  }[];
  hashes?: Readonly<Record<string, string | null | undefined>>;
  pinToPin: readonly V3PinToPinRow[];
  cables: readonly V3CableCoreRow[];
  bom?: readonly V3BomRow[];
  terminals: readonly V3TerminalPlanRow[];
  [key: string]: unknown;
}

function reportClassification(report: V3ExportReport): V3ReportClassification {
  const eligibility = report.eligibility;
  if (eligibility?.engine !== 'v3-closed-loop') return 'LEGACY_DIAGNOSTIC';
  return eligibility.eligible && eligibility.status === 'PASS'
    ? 'VERIFIED_PREWIRE'
    : 'DIAGNOSTIC';
}

function normalizedReport(report: V3ExportReport): V3ExportReport & { classification: V3ReportClassification } {
  return { ...report, classification: reportClassification(report) };
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const text = typeof value === 'string' && /^[=+@-]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: readonly (readonly unknown[])[]): string {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function displayBoolean(value: boolean | undefined): string {
  return value ? 'Yes' : value === false ? 'No' : '';
}

function displayList(values: readonly string[] | undefined): string {
  return values?.join('; ') ?? '';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function table(headings: readonly string[], values: readonly (readonly unknown[])[]): string {
  return `<table><thead><tr>${headings.map((heading) => `<th>${escapeHtml(heading)}</th>`).join('')}</tr></thead>
    <tbody>${values.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function list(title: string, values: readonly string[] | undefined): string {
  if (!values?.length) return `<h2>${escapeHtml(title)}</h2><p>None recorded.</p>`;
  return `<h2>${escapeHtml(title)}</h2><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
}

function hashLabel(name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} hash`;
}

export function pinToPinCsv(report: V3ExportReport): string {
  return csv([
    ['From', 'From electrical role', 'To', 'To electrical role', 'Conductor electrical role', 'Cable', 'Conductor', 'Wire number', 'Core', 'Color', 'Gauge', 'mm²', 'AWG', 'Length mm', 'Shielded', 'Drain', 'Ferrule from', 'Ferrule to', 'Lug from', 'Lug to'],
    ...report.pinToPin.map((row) => [
      row.from, row.fromRole ?? '', row.to, row.toRole ?? '', row.conductorRole ?? '',
      row.cableId ?? '', row.conductorId ?? '', row.wireNumber ?? '', row.core ?? '', row.color ?? '', row.gauge ?? '',
      row.crossSectionMm2 ?? '', row.awg ?? '', row.lengthMm ?? '', displayBoolean(row.shielded), displayBoolean(row.drain),
      row.ferruleFrom ?? '', row.ferruleTo ?? '', row.lugFrom ?? '', row.lugTo ?? '',
    ]),
  ]);
}

export function cableCoreScheduleCsv(report: V3ExportReport): string {
  return csv([
    ['Cable', 'From', 'To', 'Cores', 'Cable type', 'Length mm', 'Shielded', 'Drain conductor', 'Conductors', 'Description'],
    ...report.cables.map((row) => [
      row.cableId, row.from, row.to, row.cores, row.cableType ?? '', row.lengthMm ?? '', displayBoolean(row.shielded),
      row.drainConductorId ?? '', displayList(row.conductorIds), row.description ?? '',
    ]),
  ]);
}

export function terminalPlanCsv(report: V3ExportReport): string {
  return csv([
    ['Designation', 'Terminal', 'Signal', 'Destination', 'Terminal type', 'Marker', 'Accessories'],
    ...report.terminals.map((row) => [
      row.designation, row.terminal, row.signal, row.destination, row.terminalType ?? '', row.marker ?? '', displayList(row.accessories),
    ]),
  ]);
}

export function bomCsv(report: V3ExportReport): string {
  return csv([
    ['Designation', 'Part number', 'Description', 'Quantity', 'Manufacturer'],
    ...(report.bom ?? []).map((row) => [row.designation ?? '', row.partNumber, row.description, row.quantity, row.manufacturer ?? '']),
  ]);
}

/** JSON always carries the computed class, never the compatibility input value. */
export function jsonReport(report: V3ExportReport): string {
  return canonicalStringify(normalizedReport(report));
}

export function htmlReport(report: V3ExportReport): string {
  const normalized = normalizedReport(report);
  const assumptions = normalized.sourceAssumptions;
  const deviceSettings = normalized.deviceSettings ?? [];
  const hashes = Object.entries(normalized.hashes ?? {}).map(([name, value]) => [hashLabel(name), value ?? '']);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(normalized.title)}</title>
    <style>body{font:14px system-ui;margin:32px;color:#17212b}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #9aa8b6;padding:6px;text-align:left;vertical-align:top}th{background:#eaf1f7}code{overflow-wrap:anywhere}</style>
    </head><body><h1>${escapeHtml(normalized.title)}</h1><p>Report class: <strong>${escapeHtml(normalized.classification)}</strong></p>
    <h2>Source and earthing assumptions</h2>${table(
      ['Source system', 'Supply', 'Earthing', 'Canvas units/mm'],
      [[assumptions?.sourceSystem ?? '', assumptions?.supply ?? '', assumptions?.earthing ?? '', assumptions?.canvasUnitsPerMm ?? '']],
    )}
    <h2>AC protection inputs</h2>${table(['Phase sequence', 'Prospective fault current (A)', 'Protective curve'], [[normalized.sourceProtection?.phaseSequence ?? '', normalized.sourceProtection?.prospectiveShortCircuitCurrentA ?? '', normalized.sourceProtection?.protectiveDeviceCurve ?? '']])}
    <h2>Eligibility</h2>${table(['Engine', 'Eligible', 'Status', 'Reason'], [[normalized.eligibility?.engine ?? 'legacy-v2', displayBoolean(normalized.eligibility?.eligible), normalized.eligibility?.status ?? '', normalized.eligibility?.reason ?? '']])}
    ${list('Supported checks', normalized.checks?.supported)}${list('Unsupported checks', normalized.checks?.unsupported)}
    <h2>Closed-loop paths</h2>${table(['Scenario', 'Source', 'Load', 'Status', 'Terminals'], (normalized.closedLoopPaths ?? []).map((path) => [path.scenarioId, path.sourceId ?? '', path.loadId ?? '', path.status, displayList(path.terminals)]))}
    <h2>Pin-to-pin</h2>${table(['From', 'From electrical role', 'To', 'To electrical role', 'Conductor electrical role', 'Cable', 'Conductor', 'Wire number', 'Core', 'Color', 'Gauge', 'mm²', 'AWG', 'Length mm', 'Shielded', 'Drain', 'Ferrule from', 'Ferrule to', 'Lug from', 'Lug to'], normalized.pinToPin.map((row) => [row.from, row.fromRole ?? '', row.to, row.toRole ?? '', row.conductorRole ?? '', row.cableId ?? '', row.conductorId ?? '', row.wireNumber ?? '', row.core ?? '', row.color ?? '', row.gauge ?? '', row.crossSectionMm2 ?? '', row.awg ?? '', row.lengthMm ?? '', displayBoolean(row.shielded), displayBoolean(row.drain), row.ferruleFrom ?? '', row.ferruleTo ?? '', row.lugFrom ?? '', row.lugTo ?? '']))}
    <h2>Cable/core schedule</h2>${table(['Cable', 'From', 'To', 'Cores', 'Cable type', 'Length mm', 'Shielded', 'Drain conductor', 'Conductors', 'Description'], normalized.cables.map((row) => [row.cableId, row.from, row.to, row.cores, row.cableType ?? '', row.lengthMm ?? '', displayBoolean(row.shielded), row.drainConductorId ?? '', displayList(row.conductorIds), row.description ?? '']))}
    <h2>Device settings</h2>${table(['Designation', 'Profile', 'Order code', 'Settings'], deviceSettings.map((row) => [row.designation, row.profileId, row.orderCode ?? '', canonicalStringify(row.settings)]))}
    <h2>BOM</h2>${table(['Designation', 'Part number', 'Description', 'Quantity', 'Manufacturer'], (normalized.bom ?? []).map((row) => [row.designation ?? '', row.partNumber, row.description, row.quantity, row.manufacturer ?? '']))}
    <h2>Terminal plan</h2>${table(['Designation', 'Terminal', 'Signal', 'Destination', 'Terminal type', 'Marker', 'Accessories'], normalized.terminals.map((row) => [row.designation, row.terminal, row.signal, row.destination, row.terminalType ?? '', row.marker ?? '', displayList(row.accessories)]))}
    <h2>Hashes</h2>${table(['Name', 'Hash'], hashes)}
    </body></html>`;
}
