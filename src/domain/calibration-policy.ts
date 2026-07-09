import type { DeviceProfile, ProfileOverride } from './types';

function cloneProfile(profile: DeviceProfile): DeviceProfile {
  return structuredClone(profile);
}

export function applyProfileOverride(profile: DeviceProfile, override: ProfileOverride): DeviceProfile {
  const result = cloneProfile(profile);
  const extensions = { ...(result.extensions ?? {}) };
  const overrides = Array.isArray(extensions.overrides) ? [...extensions.overrides] : [];
  overrides.push(override);
  result.extensions = { ...extensions, overrides };

  if (override.kind === 'geometry') return result;

  result.profileId = `${profile.profileId}:local:${override.kind}`;
  result.version = `${profile.version}-local`;
  result.evidence = {
    level: 'educational',
    documents: [],
    note: `Electrical profile changed locally (${override.kind}); manual verification no longer applies.`,
  };
  return result;
}

