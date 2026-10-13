#!/usr/bin/env bash
# Run once on the existing VM as root. No credentials are generated or rotated.
set -euo pipefail
if [ "$EUID" -ne 0 ]; then
  echo 'Run with sudo on the existing VM.' >&2
  exit 1
fi
if [ "$#" -ne 6 ]; then
  echo 'Usage: setup_vm_runtime.sh PROJECT REGION HTTPS_ORIGIN BACKUPS_BUCKET AGE_PUBLIC_RECIPIENT JWT_VERSION' >&2
  exit 1
fi
test -s /opt/editor/cloud.env
test -s /opt/editor/infra/gcp/Caddyfile
apt-get update
apt-get install -y age
python3 - "$@" <<'PY'
import json, os, re, sys
from pathlib import Path
project, region, origin, bucket, recipient, version = sys.argv[1:]
if not re.fullmatch(r'age1[023456789acdefghjklmnpqrstuvwxyz]{58}', recipient):
    raise SystemExit('Expected the public age1 recipient, not the private key.')
if not re.fullmatch(r'[1-9][0-9]*', version):
    raise SystemExit('JWT secret version must be numeric.')
os.umask(0o077)
target = Path('/opt/editor/vm-deploy.json')
if target.exists():
    raise SystemExit('VM deploy configuration exists; inspect before changing it.')
target.write_text(json.dumps({
    'project': project, 'region': region, 'origin': origin,
    'backups_bucket': bucket, 'jwt_version': version, 'age_recipient': recipient,
}, indent=2) + '\n')
target.chmod(0o600)
PY
chown root:root /opt/editor/cloud.env /opt/editor/vm-deploy.json
chmod 600 /opt/editor/cloud.env /opt/editor/vm-deploy.json
gcloud auth configure-docker "${2}-docker.pkg.dev" --quiet
echo 'VM runtime configuration saved. Existing secrets and JWT key are unchanged.'
