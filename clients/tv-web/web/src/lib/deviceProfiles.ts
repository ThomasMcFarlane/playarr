interface ProfileIdentity {
  id: string;
}

/**
 * Keeps the profile selector scoped to accounts with a session on this device.
 * The current account is retained for transparent-login modes where no saved
 * refresh session exists yet.
 */
export function selectDeviceProfiles<T extends ProfileIdentity>(
  availableProfiles: T[],
  isProfileSaved: (userId: string) => boolean,
  currentUserId?: string
): T[] {
  return availableProfiles.filter(
    (profile) => profile.id === currentUserId || isProfileSaved(profile.id)
  );
}
