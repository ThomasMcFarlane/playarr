# Playarr standalone Helm chart

This chart adopts one existing SQLite-backed Playarr instance without copying
or deleting its data. It always runs one Pod with a `Recreate` strategy and can
bind a retained local PersistentVolume to the instance's existing data path.

The chart never creates Secrets. Supply `existingSecret` out of band with the
existing instance's database and authentication settings. Environment-specific
host paths and node names belong in the private cluster repository, not here.

For an in-place adoption:

1. Render and review the chart while the original process remains running.
2. Back up the existing data directory without modifying the source.
3. Stop the original process before starting the Pod against the same path.
4. Keep the original process definition disabled but intact for rollback.

Local volumes always use `persistentVolumeReclaimPolicy: Retain`. The chart has
no migration, deletion, cleanup or uninstall hooks.
