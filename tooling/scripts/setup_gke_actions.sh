#!/usr/bin/env bash
# Run once as the owner in Cloud Shell. Configures Actions for the existing GKE app.
set -euo pipefail
if [ "$#" -ne 5 ]; then
  echo 'Usage: setup_gke_actions.sh PROJECT REGION ZONE CLUSTER OWNER/REPO' >&2
  exit 2
fi
PROJECT=$1 REGION=$2 ZONE=$3 CLUSTER=$4 REPOSITORY=$5
[[ "$PROJECT" =~ ^[a-z][a-z0-9-]{4,61}[a-z0-9]$ ]]
[[ "$REGION" =~ ^[a-z]+-[a-z]+[0-9]+$ ]]
[[ "$ZONE" == "$REGION-"[a-z] ]]
[[ "$CLUSTER" =~ ^[a-z][a-z0-9-]{0,61}[a-z0-9]$ ]]
[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
for command in gcloud kubectl gh python3 curl; do
  if ! command -v "$command" >/dev/null; then
    echo "Missing required command: $command" >&2
    exit 2
  fi
done
gh auth status --hostname github.com >/dev/null
gh api "repos/$REPOSITORY/environments/cloud-gke" >/dev/null
gcloud container clusters get-credentials "$CLUSTER" --project="$PROJECT" --zone="$ZONE"
[[ "$(kubectl config current-context)" == "gke_${PROJECT}_${ZONE}_${CLUSTER}" ]]
umask 077
TASK_DIR="$HOME/.docnest-k8s-actions"
mkdir -p "$TASK_DIR"
chmod 700 "$TASK_DIR"
kubectl -n editor-lab get configmap editor-config -o json > "$TASK_DIR/public-config.json"
python3 - "$TASK_DIR/public-config.json" > "$TASK_DIR/live-variables.tsv" <<'PY'
import json, re, sys
data = json.load(open(sys.argv[1]))['data']
fields = {
    'WEB_ORIGIN': ('WEB_ORIGIN', r'https://[A-Za-z0-9.-]+(?::[0-9]+)?'),
    'GCS_SNAPSHOTS_BUCKET': ('SNAPSHOTS_BUCKET', r'[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]'),
    'GCS_RESULTS_BUCKET': ('GCS_BUCKET', r'[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]'),
    'GOOGLE_CLIENT_ID': ('GOOGLE_CLIENT_ID', r'(?:[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com)?'),
    'MAX_USERS': ('MAX_USERS', r'[1-9][0-9]*'),
    'STRIPE_PRO_MONTHLY_PRICE': ('STRIPE_PRO_MONTHLY_PRICE', r'(?:price_[A-Za-z0-9]+)?'),
    'STRIPE_PRO_YEARLY_PRICE': ('STRIPE_PRO_YEARLY_PRICE', r'(?:price_[A-Za-z0-9]+)?'),
}
for target, (source, pattern) in fields.items():
    value = data.get(source, '')
    if not re.fullmatch(pattern, value):
        raise SystemExit('Invalid live public configuration: ' + target)
    print(target + '\t' + value)
PY
ORIGIN=$(awk -F '\t' '$1 == "WEB_ORIGIN" {print $2}' "$TASK_DIR/live-variables.tsv")
SNAPSHOTS=$(awk -F '\t' '$1 == "GCS_SNAPSHOTS_BUCKET" {print $2}' "$TASK_DIR/live-variables.tsv")
RESULTS=$(awk -F '\t' '$1 == "GCS_RESULTS_BUCKET" {print $2}' "$TASK_DIR/live-variables.tsv")
[[ "$SNAPSHOTS" != "$RESULTS" ]]
# The rollout checks this HTTPS origin; finish first-time DNS/TLS before enabling updates.
curl --fail --silent --show-error --max-time 30 "$ORIGIN/healthz" >/dev/null
[[ "$(kubectl -n editor-lab get ingress editor-public -o jsonpath='{.metadata.annotations.kubernetes\.io/ingress\.class}')" == gce ]]
IP_NAME=$(kubectl -n editor-lab get ingress editor-public -o jsonpath='{.metadata.annotations.kubernetes\.io/ingress\.global-static-ip-name}')
[[ "$IP_NAME" =~ ^[a-z][a-z0-9-]*$ ]]
GKE_IP=$(gcloud compute addresses describe "$IP_NAME" --project="$PROJECT" --global --format='value(address)')
python3 -c 'import ipaddress, sys; assert ipaddress.IPv4Address(sys.argv[1]).is_global' "$GKE_IP"

gh api --paginate "repos/$REPOSITORY/environments/cloud-gke/variables" \
  --jq '.variables[].name' > "$TASK_DIR/existing-variable-names.txt"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
bash "$SCRIPT_DIR/setup_gke_deploy.sh" "$PROJECT" "$ZONE" "$CLUSTER" "$REPOSITORY"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
[[ "$PROJECT_NUMBER" =~ ^[0-9]+$ ]]
{
  printf 'GCP_PROJECT\t%s\nGCP_REGION\t%s\nGCP_ZONE\t%s\nGKE_CLUSTER\t%s\n' "$PROJECT" "$REGION" "$ZONE" "$CLUSTER"
  printf 'GCP_WIF_PROVIDER\tprojects/%s/locations/global/workloadIdentityPools/editor-ci/providers/github\n' "$PROJECT_NUMBER"
  printf 'GCP_CI_SERVICE_ACCOUNT\teditor-ci@%s.iam.gserviceaccount.com\n' "$PROJECT"
  printf 'GCP_DEPLOY_SERVICE_ACCOUNT\teditor-deploy@%s.iam.gserviceaccount.com\n' "$PROJECT"
  printf 'TRUSTED_PROXY_CIDRS\t35.191.0.0/16,130.211.0.0/22,%s/32\n' "$GKE_IP"
} > "$TASK_DIR/action-variables.tsv"
cat "$TASK_DIR/live-variables.tsv" >> "$TASK_DIR/action-variables.tsv"
while IFS=$'\t' read -r name value; do
  if [ -n "$value" ]; then
    gh variable set "$name" --repo "$REPOSITORY" --env cloud-gke --body "$value" </dev/null
  elif grep -Fxq "$name" "$TASK_DIR/existing-variable-names.txt"; then
    gh api --method DELETE "repos/$REPOSITORY/environments/cloud-gke/variables/$name" </dev/null
  fi
done < "$TASK_DIR/action-variables.tsv"
echo 'Configured cloud-gke. Use Actions > Build & deploy > Run workflow > main.'
