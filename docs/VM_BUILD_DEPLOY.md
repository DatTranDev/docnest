# Retired VM deployment

The active runtime is GKE. The VM deployment workflow, release executable and VM deployment/setup scripts have been removed. Historical instructions remain available in Git history; do not use them for new releases.

Use [Build & deploy](GKE_ONE_CLICK.md) for application updates and [GKE cutover](GKE_CUTOVER.md) for the separately reviewed infrastructure transition. Removing repository deployment code does not delete any live VM, disk, IP, backup, key or GitHub environment. Confirm inventories and data ownership before an operator removes cloud resources.
