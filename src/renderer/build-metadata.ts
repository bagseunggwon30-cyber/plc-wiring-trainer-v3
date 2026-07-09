export interface BuildMetadata {
  version: string;
  displayVersion: string;
  title: string;
}

export function buildMetadata(version: string): BuildMetadata {
  if (!version.trim()) throw new Error('App version is required');
  return {
    version,
    displayVersion: `v${version}`,
    title: `박승권의 결선 작업장 v${version}`,
  };
}
