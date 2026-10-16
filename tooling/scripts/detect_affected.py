"""Dependency-aware monorepo impact resolution. Missing Git history fails closed."""

import argparse
import json
import os
from pathlib import Path
import subprocess

from digest_manifest import NAMES

BACKENDS = NAMES[:-1]


def selection(values, allow_empty=True):
    if (
        not isinstance(values, list)
        or any(not isinstance(value, str) or value not in NAMES for value in values)
        or len(values) != len(set(values))
        or (not values and not allow_empty)
    ):
        raise ValueError("Invalid application selection")
    return [name for name in NAMES if name in values]


def affected(paths):
    images, applications, migrations = set(), set(), set()
    infrastructure = coordinated = False
    for path in paths:
        path = path.replace("\\", "/")
        matched = False
        for name in BACKENDS:
            if path.startswith(f"backend/{name}/"):
                images.add(name)
                if "/src/main/resources/db/migration/" in path:
                    migrations.add(name)
                matched = True
            if path.startswith(f"backend/schema/{name.removesuffix('-service')}/"):
                images.add(name)
                migrations.add(name)
                matched = True
        if matched:
            continue
        if (
            path.startswith("backend/common/")
            or path == "pom.xml"
            or path.startswith((".mvn/", "mvnw"))
        ):
            images.update(BACKENDS)
        elif path.startswith("docs/contracts/") or path in (
            "docs/04_EDITOR_ENGINE.md",
        ):
            images.update(NAMES)
            coordinated = True
        elif path.startswith(("frontend/", "tooling/lint-glob/")) or path in (
            "package.json",
            "package-lock.json",
            "tsconfig.json",
            "eslint.config.mjs",
        ):
            images.add("web")
        elif path in ("infra/compose/Service.Dockerfile",):
            images.update(BACKENDS)
        elif path == "infra/compose/Web.Dockerfile":
            images.add("web")
        elif path == ".dockerignore":
            images.update(NAMES)
        elif path.startswith("infra/k8s/base/") and Path(path).stem in NAMES:
            applications.add(Path(path).stem)
            infrastructure = True
        elif path.startswith("infra/k8s/base/migrate-"):
            name = Path(path).stem.removeprefix("migrate-")
            if name in BACKENDS:
                images.add(name)
                migrations.add(name)
            infrastructure = True
        elif path.startswith(("infra/", "tooling/scripts/", "testing/", ".github/")):
            images.update(NAMES)
            infrastructure = True
        elif path.startswith("docs/") or path.endswith(".md"):
            continue
        else:
            images.update(NAMES)
            infrastructure = True
        if path.startswith("backend/common/") and any(
            part in path for part in ("/codec/", "/contracts/")
        ):
            images.update(NAMES)
            coordinated = True
    applications.update(images)
    return {
        "images": selection(list(images)),
        "applications": selection(list(applications)),
        "migrations": selection(list(migrations)),
        "backends": [name for name in BACKENDS if name in images],
        "web": "web" in images,
        "infrastructure": infrastructure,
        "coordinated": coordinated,
    }


def git(*args):
    return subprocess.check_output(["git", *args])


def resolve(base, head="HEAD", merge_base=True):
    if not base or set(base) == {"0"}:
        result = affected(["unknown-input"])
        result.update(
            base=None,
            head=git("rev-parse", head).decode().strip(),
            reason="full-history-unavailable",
        )
        result["migrations"] = list(BACKENDS)
        return result
    # Invalid/missing nonempty refs fail rather than guessing a smaller deployment.
    base_sha = git("rev-parse", "--verify", base + "^{commit}").decode().strip()
    head_sha = git("rev-parse", "--verify", head + "^{commit}").decode().strip()
    if merge_base:
        base_sha = git("merge-base", base_sha, head_sha).decode().strip()
    immutable = (
        git(
            "diff",
            "--name-only",
            "--diff-filter=MD",
            "--no-renames",
            "-z",
            base_sha,
            head_sha,
        )
        .decode()
        .split("\0")
    )
    if any(
        path.endswith(".sql")
        and (
            path.startswith("backend/schema/")
            or "/src/main/resources/db/migration/" in path
        )
        for path in immutable
    ):
        raise ValueError(
            "Applied migration files are immutable; add a new migration version"
        )
    paths = (
        git("diff", "--name-only", "--no-renames", "-z", base_sha, head_sha)
        .decode()
        .split("\0")
    )
    result = affected([path for path in paths if path])
    result.update(base=base_sha, head=head_sha, reason="git-diff")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--direct", action="store_true")
    parser.add_argument("--full", action="store_true")
    parser.add_argument(
        "--select",
        default="[]",
        help="Explicit additions; never narrows detected impact",
    )
    parser.add_argument("--output", default="affected.json")
    args = parser.parse_args()
    base = args.base
    if base is None and os.environ.get("GITHUB_EVENT_PATH"):
        event = json.loads(
            Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8")
        )
        base = event.get("pull_request", {}).get("base", {}).get("sha") or event.get(
            "before"
        )
    result = resolve(None if args.full else base, args.head, not args.direct)
    extra = selection(json.loads(args.select))
    result["images"] = selection(list(set(result["images"]) | set(extra)))
    result["applications"] = selection(list(set(result["applications"]) | set(extra)))
    result["backends"] = [name for name in BACKENDS if name in result["images"]]
    result["web"] = "web" in result["images"]
    result["maven_projects"] = ",".join(
        "backend/" + name for name in result["backends"]
    )
    Path(args.output).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            for key, value in result.items():
                stream.write(
                    key
                    + "="
                    + (
                        value
                        if isinstance(value, str)
                        else json.dumps(value, separators=(",", ":"))
                    )
                    + "\n"
                )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
