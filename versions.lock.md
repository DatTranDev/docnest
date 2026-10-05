# Implementation version lock

Locked 4 October 2026. Application version1.0.0-SNAPSHOT; native format remains adaptive-v1. Original OpenAPI fields, event envelopes, golden fixtures and V1 migrations are unchanged. V2 migrations remain additive under ADR015; Processing V3 adds nullable trace correlation under ADR019. This directory has no Git metadata, so no commit SHA can be recorded locally.

| Component                                       | Pin                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Java                                            | Java21; locally verified Temurin21.0.12.1+1, downloaded checksum verified                                                                   |
| Spring Boot parent/BOM                          | 4.1.1, Java21 compilation; dependencies managed by that exact BOM                                                                           |
| Maven / Wrapper                                 | 3.9.16 /3.3.4, distribution URL in .mvn/wrapper/maven-wrapper.properties                                                                    |
| Testcontainers                                  | 2.0.2                                                                                                                                       |
| GCS Java SDK                                    | 2.60.0                                                                                                                                      |
| ICU4J / segmentation                            | 78.3 / Unicode17; unicode-segmenter0.17.3 on the client                                                                                     |
| JSON schema validator                           | networknt1.5.9                                                                                                                              |
| Bouncy Castle                                   | 1.85; security override documented in ADR017                                                                                                |
| Security overrides to Boot BOM                  | Jackson2 BOM2.21.7; Jackson3 BOM3.1.7; Tomcat11.0.25; LZ4 Java1.11.1                                                                        |
| Node / TypeScript                               | 24.11.1 /5.9.3                                                                                                                              |
| Next.js / React / React DOM                     | 16.3.8 /19.3.0 /19.3.0; App Router, production standalone Node server                                                                       |
| CodeMirror state/view/commands                  | 6.7.6 /6.43.13 /6.11.1                                                                                                                      |
| Vite test tooling / Vitest / Playwright         | 8.3.2 /5.0.3 /1.63.0; Vite is retained for tests, not application hosting                                                                   |
| fast-check                                      | 4.10.2                                                                                                                                      |
| ESLint / eslint-config-next / typescript-eslint | 9.39.5 /16.3.8 /8.71.0                                                                                                                      |
| Prettier                                        | 3.9.9                                                                                                                                       |
| Spotless / Google Java Format                   | 3.10.3 /1.36.1; Java21-compatible formatter pin                                                                                             |
| ArchUnit                                        | 1.5.1                                                                                                                                       |
| Next lint directory adapter                     | @ted/lint-glob1.0.0 with tinyglobby0.2.17; scoped fast-glob override and real resolver contract tests                                       |
| Python tools                                    | Python3.12.6+; requirements-implementation.txt pins Black26.5.1, PyYAML6.0.3, jsonschema4.26.0, openapi-spec-validator0.9.0, requests2.32.5 |
| Terraform / Google provider                     | 1.14.0 /6.50.0; signed provider checksum lock in infra/gcp/.terraform.lock.hcl                                                              |
| Local Docker / Compose validation               | 28.5.1 /2.40.3, Linux containers                                                                                                            |
| Benchmark browser                               | Chromium153.0.8010.12; actual report includes hardware/OS/build and sampling method                                                         |

Npm exact dependency resolutions and integrity hashes are in package-lock.json; use npm ci. Maven uses the exact Boot BOM and explicit dependency versions in service POMs. Do not upgrade only one codec's Unicode version. CI actions use full commit SHA references.

The Python formatting pin is [Black26.5.1](https://pypi.org/project/black/26.5.1/), with its AST safety check enabled. The available Python3.12.5 interpreter was rejected by that check; local formatting and final quality use Python3.12.14. Use Python3.12.6+ and install `checks/requirements-implementation.txt` for repeatable checks.

| Container           | Immutable image reference                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL               | mysql:8.4.7@sha256:0426ec38c7a10aa45ba383887df7878f74ee70e2fd589c7b69207f3577901903                                                                   |
| Kafka               | apache/kafka:4.1.1@sha256:0bc1bb2478f45b6cea78864df86acdc11e8df2c5172477819a4d12942cbe5d40                                                            |
| Redis               | redis:8.4.0@sha256:c22af04bb576503bf16b3e34a1fd2fd82de0f765afd866d2e380145e0af30d78                                                                   |
| Java build          | maven:3.9.16-eclipse-temurin-21@sha256:99e61abcff91a9b1333463bd8451fb18495d6eba9250ac66a338b518f8278320                                               |
| Java runtime        | eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5                                                        |
| Node build          | node:24.11.1-alpine3.23@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7                                                       |
| Web runtime         | node:24.11.1-alpine3.23@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7; standalone Next.js behind the Node streaming gateway |
| Future VM TLS proxy | caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d                                                           |

Application image digests are generated per reviewed cloud build; placeholders are deliberately retained in cloud templates. Local image builds do not prove that cloud images were pushed. Real GCS/VM/GKE integration is PENDING/DEPLOY_PENDING; see the progress and handoff reports.

ADR018 established runtime security updates for the previous Nginx image. ADR019 initially introduced Node/Bookworm; its actual scan still found52 High and4 Critical OS package findings after APT upgrades. ADR020 switches both build and runtime to the same pinned official Node24.11.1 Alpine3.23 image, applies `apk upgrade --no-cache`, and installs `gcompat`. The Docker Hub index digest above was resolved with `docker buildx imagetools inspect`; registry proof is in reports/node-alpine-registry-inspect.log. Alpine uses musl, so the Linux build must select its compatible Next SWC binaries; Debian-built native packages are not copied into it. Current build/runtime/security evidence must be inspected before rollout. Record resulting OS packages/image ID with checks/image_os_scan.py, rebuild the runtime layer without cache for security refreshes, scan again, and deploy only the reviewed resulting digest. Previous scans do not verify a replacement image. Trivy0.75.0 archives are checksum verified; reports record the vulnerability database date and remaining findings.
