"""Render ordered deployment files with explicit identifiers and immutable digests; no apply."""

import argparse, json, pathlib, re, subprocess, yaml

p = argparse.ArgumentParser(description=__doc__)
for arg in ["project", "origin", "snapshots-bucket", "results-bucket", "digests"]:
    p.add_argument("--" + arg, required=True)
p.add_argument("--output", default=".tools/cloud-render")
a = p.parse_args()
root = pathlib.Path(__file__).resolve().parents[2]
if not a.origin.startswith("https://"):
    raise SystemExit("Cloud requires HTTPS origin")
digests = json.loads(pathlib.Path(a.digests).read_text())
names = [
    "identity-service",
    "document-service",
    "processing-service",
    "collaboration-service",
    "payment-service",
    "web",
]
if set(digests) != set(names):
    raise SystemExit("Digest file must map all six application names")
for v in digests.values():
    if not re.fullmatch(r"[a-z0-9._:/-]+@sha256:[a-f0-9]{64}", v):
        raise SystemExit("Every image must be a registry digest")
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
