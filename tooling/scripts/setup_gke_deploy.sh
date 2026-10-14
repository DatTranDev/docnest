#!/usr/bin/env bash
# Operator-only setup on an existing cluster/bucket; never creates paid compute.
set -euo pipefail
if [ "$#" -ne 5 ]; then
  echo 'Usage: setup_gke_deploy.sh PROJECT ZONE CLUSTER OWNER/REPO BACKUP_BUCKET' >&2
  exit 2
fi
PROJECT=$1 ZONE=$2 CLUSTER=$3 REPOSITORY=$4 BACKUPS=$5
[[ "$PROJECT" =~ ^[a-z][a-z0-9-]{4,61}[a-z0-9]$ ]]
[[ "$ZONE" =~ ^[a-z]+-[a-z]+[0-9]+-[a-z]$ ]]
[[ "$CLUSTER" =~ ^[a-z][a-z0-9-]{0,61}[a-z0-9]$ ]]
[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
[[ "$BACKUPS" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]]
ACCOUNT="editor-deploy@$PROJECT.iam.gserviceaccount.com"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
[[ "$PROJECT_NUMBER" =~ ^[0-9]+$ ]]
gcloud storage buckets describe "gs://$BACKUPS" --project="$PROJECT" --format='value(name)' >/dev/null
gcloud container clusters get-credentials "$CLUSTER" --project="$PROJECT" --zone="$ZONE"
CONTEXT=$(kubectl config current-context)
kubectl --context="$CONTEXT" -n editor-lab get namespace editor-lab >/dev/null
if ! gcloud iam service-accounts describe "$ACCOUNT" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create editor-deploy --project="$PROJECT"
fi
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$ACCOUNT" --role=roles/container.clusterViewer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$ACCOUNT" --project="$PROJECT" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/editor-ci/attribute.repository/$REPOSITORY" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BACKUPS" \
  --member="serviceAccount:$ACCOUNT" --role=roles/storage.objectViewer >/dev/null
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RULES=$(mktemp)
trap 'rm -f -- "$RULES"' EXIT
sed "s/YOUR_PROJECT/$PROJECT/g" "$SCRIPT_DIR/../../infra/k8s/deploy-rbac.example.yaml" > "$RULES"
kubectl --context="$CONTEXT" apply --dry-run=server -f "$RULES"
kubectl --context="$CONTEXT" apply -f "$RULES"
echo 'Configured GKE deploy identity/RBAC and encrypted-backup read access; no runtime Secret permissions added.'
