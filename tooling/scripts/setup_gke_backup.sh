#!/usr/bin/env bash
# Operator-only IAM/RBAC setup on existing GKE/buckets. No compute, bucket or key creation.
set -euo pipefail
if [ "$#" -ne 7 ]; then
  echo 'Usage: setup_gke_backup.sh PROJECT ZONE CLUSTER OWNER/REPO SNAPSHOTS RESULTS BACKUPS' >&2
  exit 2
fi
PROJECT=$1 ZONE=$2 CLUSTER=$3 REPOSITORY=$4 SNAPSHOTS=$5 RESULTS=$6 BACKUPS=$7
[[ "$PROJECT" =~ ^[a-z][a-z0-9-]{4,61}[a-z0-9]$ ]]
[[ "$ZONE" =~ ^[a-z]+-[a-z]+[0-9]+-[a-z]$ ]]
[[ "$CLUSTER" =~ ^[a-z][a-z0-9-]{0,61}[a-z0-9]$ ]]
[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
[[ "$SNAPSHOTS" != "$RESULTS" && "$SNAPSHOTS" != "$BACKUPS" && "$RESULTS" != "$BACKUPS" ]]
for bucket in "$SNAPSHOTS" "$RESULTS" "$BACKUPS"; do
  [[ "$bucket" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]]
  gcloud storage buckets describe "gs://$bucket" --project="$PROJECT" --format='value(name)' >/dev/null
done
gcloud container clusters get-credentials "$CLUSTER" --project="$PROJECT" --zone="$ZONE"
CONTEXT=$(kubectl config current-context)
[[ "$CONTEXT" == "gke_${PROJECT}_${ZONE}_${CLUSTER}" ]]
ACCOUNT="editor-backup@$PROJECT.iam.gserviceaccount.com"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
[[ "$PROJECT_NUMBER" =~ ^[0-9]+$ ]]
if ! gcloud iam service-accounts describe "$ACCOUNT" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create editor-backup --project="$PROJECT"
fi
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$ACCOUNT" --role=roles/container.clusterViewer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$ACCOUNT" --project="$PROJECT" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/editor-ci/attribute.repository/$REPOSITORY" >/dev/null
for bucket in "$SNAPSHOTS" "$RESULTS"; do
  gcloud storage buckets add-iam-policy-binding "gs://$bucket" \
    --member="serviceAccount:$ACCOUNT" --role=roles/storage.objectViewer >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://$BACKUPS" \
  --member="serviceAccount:$ACCOUNT" --role=roles/storage.objectCreator >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BACKUPS" \
  --member="serviceAccount:$ACCOUNT" --role=roles/storage.objectViewer >/dev/null
gcloud secrets add-iam-policy-binding editor-jwt --project="$PROJECT" \
  --member="serviceAccount:$ACCOUNT" --role=roles/secretmanager.secretAccessor >/dev/null
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RULES=$(mktemp)
trap 'rm -f -- "$RULES"' EXIT
sed "s/YOUR_PROJECT/$PROJECT/g" "$SCRIPT_DIR/../../infra/k8s/backup-rbac.example.yaml" > "$RULES"
kubectl --context="$CONTEXT" apply --dry-run=server -f "$RULES"
kubectl --context="$CONTEXT" apply -f "$RULES"
echo 'Configured dedicated backup identity: application pause, MySQL exec, named JWT read, source object read and backup object create.'
