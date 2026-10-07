"""Convert reviewed registry digest lines to a strictly scoped four-image manifest."""

import argparse, json, pathlib, re

NAMES = ("identity-service", "document-service", "processing-service", "web")


def validate_manifest(values, project, region):
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,61}[a-z0-9]", project):
        raise ValueError("Invalid project identifier")
    if not re.fullmatch(r"[a-z]+-[a-z]+[0-9]+", region):
        raise ValueError("Invalid registry region")
    if not isinstance(values, dict) or set(values) != set(NAMES):
        raise ValueError("Exactly four application digests required")
    for name, image in values.items():
        prefix = f"{region}-docker.pkg.dev/{project}/editor/{name}@sha256:"
        if (
            not isinstance(image, str)
            or not image.startswith(prefix)
            or not re.fullmatch(r"[a-f0-9]{64}", image[len(prefix) :])
        ):
            raise ValueError(
                "Image must belong to the reviewed project, repository and service: "
                + name
            )
    return values


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("project", "region", "input", "output"):
        p.add_argument("--" + name, required=True)
    a = p.parse_args()
    content = pathlib.Path(a.input).read_text(encoding="utf-8").strip()
    if content.startswith("{"):
        values = json.loads(content)
    else:
        values = {}
        for line in content.splitlines():
            name = line.rsplit("/", 1)[-1].split("@", 1)[0]
            if name in values:
                raise ValueError("Duplicate image " + name)
            values[name] = line
    values = validate_manifest(values, a.project, a.region)
    pathlib.Path(a.output).write_text(
        json.dumps(values, indent=2) + "\n", encoding="utf-8"
    )
    print("Validated four project-scoped immutable image digests")


if __name__ == "__main__":
    main()
