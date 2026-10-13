#!/usr/bin/env bash
# Run once as the provisioning operator in Cloud Shell, never on the runtime VM.
set -euo pipefail

PROJECT=${1:?Usage: setup_vm_deploy.sh PROJECT ZONE VM OWNER/REPO}
ZONE=${2:?Set the existing VM zone}
VM=${3:?Set the existing VM name}
REPOSITORY=${4:?Set the authorized GitHub repository}
ACCOUNT="editor-vm-deploy@$PROJECT.iam.gserviceaccount.com"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
VM_IP=$(gcloud compute instances describe "$VM" --zone="$ZONE" --project="$PROJECT" --format='value(networkInterfaces[0].networkIP)')
RUNTIME_ACCOUNT=$(gcloud compute instances describe "$VM" --zone="$ZONE" --project="$PROJECT" --format='value(serviceAccounts[0].email)')

gcloud services enable oslogin.googleapis.com --project="$PROJECT"
if ! gcloud iam service-accounts describe "$ACCOUNT" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create editor-vm-deploy --project="$PROJECT" --display-name='Docnest protected VM deployer'
fi
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$ACCOUNT" --role=roles/compute.viewer --condition=None --quiet >/dev/null
gcloud compute instances add-iam-policy-binding "$VM" --zone="$ZONE" --project="$PROJECT" --member="serviceAccount:$ACCOUNT" --role=roles/compute.osAdminLogin --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$ACCOUNT" --role=roles/iap.tunnelResourceAccessor \
  --condition="expression=destination.port == 22 && destination.ip == '$VM_IP',title=docnest-vm-ssh" --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_ACCOUNT" --project="$PROJECT" --member="serviceAccount:$ACCOUNT" --role=roles/iam.serviceAccountUser --condition=None --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$ACCOUNT" --project="$PROJECT" --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/editor-ci/attribute.repository/$REPOSITORY" --role=roles/iam.workloadIdentityUser --condition=None --quiet >/dev/null
printf 'GCP_VM_DEPLOY_SERVICE_ACCOUNT=%s\nGCP_ZONE=%s\nGCP_VM_INSTANCE=%s\n' "$ACCOUNT" "$ZONE" "$VM"
