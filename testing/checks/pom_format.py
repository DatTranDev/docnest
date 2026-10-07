"""Consistent POM layout; --write formats, default fails on differences."""

import argparse
from pathlib import Path
from xml.dom import minidom

ROOT = Path(__file__).resolve().parents[2]


def normalized(path):
    document = minidom.parseString(path.read_bytes())

    def strip(node):
        for child in list(node.childNodes):
            if child.nodeType == child.TEXT_NODE and not child.data.strip():
                node.removeChild(child)
            elif child.hasChildNodes():
                strip(child)

    strip(document)
    return document.toprettyxml(indent="  ", encoding="UTF-8").decode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    options = parser.parse_args()
    paths = [ROOT / "pom.xml"] + sorted((ROOT / "backend").glob("*/pom.xml"))
    differences = []
    for path in paths:
        expected = normalized(path)
        if path.read_text(encoding="utf-8") != expected:
            differences.append(str(path.relative_to(ROOT)))
            if options.write:
                path.write_text(expected, encoding="utf-8", newline="\n")
    if differences and not options.write:
        raise SystemExit("POM formatting differs: " + ", ".join(differences))
    print(
        "PASS POM formatting"
        if not options.write
        else f"Formatted {len(differences)} POMs"
    )


if __name__ == "__main__":
    main()
