"""Render ordered deployment files with explicit identifiers and immutable digests; no apply."""

import argparse, json, pathlib, re, subprocess, yaml
from urllib.parse import urlsplit
from digest_manifest import NAMES, validate_manifest

p = argparse.ArgumentParser(description=__doc__)
for arg in ["project", "origin", "snapshots-bucket", "results-bucket", "digests"]:
    p.add_argument("--" + arg, required=True)
p.add_argument("--output", default=".tools/cloud-render")
p.add_argument("--region", default="us-central1")
p.add_argument("--google-client-id", default="")
p.add_argument("--max-users", type=int, default=10)
p.add_argument("--stripe-pro-monthly-price", default="")
p.add_argument("--stripe-pro-yearly-price", default="")
a = p.parse_args()
root = pathlib.Path(__file__).resolve().parents[2]
try:
    origin = urlsplit(a.origin)
    valid_origin = (
        origin.scheme == "https"
        and origin.hostname
        and not origin.username
        and not origin.password
        and not origin.path
        and not origin.query
        and not origin.fragment
        and not re.search(r"[\s\\?#]", a.origin)
        and (origin.port is None or 0 < origin.port <= 65535)
    )
except ValueError:
    valid_origin = False
if not valid_origin:
    raise SystemExit("Cloud requires an exact HTTPS origin without path or credentials")
if a.max_users < 1:
    raise SystemExit("max-users must be a positive integer")
if a.google_client_id and not re.fullmatch(
    r"[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com", a.google_client_id
):
    raise SystemExit("Invalid Google Web client ID")
prices = (a.stripe_pro_monthly_price, a.stripe_pro_yearly_price)
if any(prices) and not all(re.fullmatch(r"price_[a-zA-Z0-9]+", v) for v in prices):
    raise SystemExit("Configure both Stripe Price IDs or leave both empty")
digests = json.loads(pathlib.Path(a.digests).read_text())
names = NAMES
try:
    validate_manifest(digests, a.project, a.region)
except ValueError as error:
    raise SystemExit(str(error)) from None
render = subprocess.run(
    ["kubectl", "kustomize", str(root / "infra/k8s/overlays/lab")],
    capture_output=True,
    text=True,
    check=True,
).stdout
replacements = {
    "YOUR_PROJECT": a.project,
    "https://YOUR_DOMAIN": a.origin,
    "YOUR_PRIVATE_SNAPSHOTS_BUCKET": a.snapshots_bucket,
    "YOUR_PRIVATE_RESULTS_BUCKET": a.results_bucket,
}


def patchobj(o):
    if isinstance(o, dict):
        for k, v in list(o.items()):
            if k == "image":
                for name in names:
                    if "/" + name + ":" in str(v):
                        o[k] = digests[name]
            else:
                o[k] = patchobj(v)
        return o
    if isinstance(o, list):
        return [patchobj(v) for v in o]
    if isinstance(o, str):
        for k, v in replacements.items():
            o = o.replace(k, v)
        return o
    return o


groups = {"bootstrap": [], "infrastructure": [], "migrations": [], "applications": []}
for obj in yaml.safe_load_all(render):
    obj = patchobj(obj)
    if obj["kind"] == "ConfigMap" and obj["metadata"]["name"] == "editor-config":
        obj["data"].update(
            GOOGLE_CLIENT_ID=a.google_client_id,
            MAX_USERS=str(a.max_users),
            STRIPE_PRO_MONTHLY_PRICE=a.stripe_pro_monthly_price,
            STRIPE_PRO_YEARLY_PRICE=a.stripe_pro_yearly_price,
        )
    group = (
        "infrastructure"
        if obj["kind"] == "StatefulSet"
        or (obj["kind"] == "Deployment" and obj["metadata"]["name"] == "redis")
        else ("applications" if obj["kind"] == "Deployment" else "bootstrap")
    )
    groups[group].append(obj)
for name in names[:-1]:
    groups["migrations"].append(
        patchobj(
            yaml.safe_load((root / f"infra/k8s/base/migrate-{name}.yaml").read_text())
        )
    )
out = pathlib.Path(a.output)
out.mkdir(parents=True, exist_ok=True)
for name, objects in groups.items():
    for obj in objects:
        if obj["kind"] != "Namespace":
            obj["metadata"]["namespace"] = "editor-lab"
    contents = yaml.safe_dump_all(objects, sort_keys=False)
    if "YOUR_" in contents or "REPLACE_" in contents:
        raise SystemExit("Unresolved placeholders in " + name)
    (out / (name + ".yaml")).write_text(contents, encoding="utf-8")
print(
    "Rendered four ordered YAML files into "
    + str(out.resolve())
    + ". Review and run server dry-run before apply."
)
