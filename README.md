# Text Editor

A web editor for large text documents with formatting, folders, sharing, version history and exports. The local stack uses Next.js/CodeMirror, three Spring Boot services, MySQL, Kafka and Redis.

For current project status and benchmark results, see [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md). Cloud setup instructions are in [docs/CLOUD_SETUP_HANDOFF.md](docs/CLOUD_SETUP_HANDOFF.md); cloud resources are not created by local commands.

## Run the app

Install Docker Desktop with Linux containers, Docker Compose v2, and Python 3.12.6 or newer. From the repository root, run:

```powershell
python -X utf8 tooling/scripts/run.py up
```

Open [http://localhost:8080](http://localhost:8080) and register two accounts to try sharing. The first run creates a local `.env` file and builds the app images. MySQL, Kafka, documents and the signing key persist in Docker volumes. Stop the app with:

```powershell
python -X utf8 tooling/scripts/run.py down
```

This keeps the saved data. Do not use `docker compose down -v` unless you intend to erase the local database and files.

## Common commands

| Command                                           | Purpose                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `python -X utf8 tooling/scripts/run.py up`        | Build and start the full app                                         |
| `python -X utf8 tooling/scripts/run.py down`      | Stop it and keep its data                                            |
| `python -X utf8 tooling/scripts/run.py build`     | Build Java and frontend code                                         |
| `python -X utf8 tooling/scripts/run.py test`      | Run quality gates, service tests and frontend tests; Docker required |
| `python -X utf8 tooling/scripts/run.py quality`   | Run formatting, lint, type and contract checks                       |
| `python -X utf8 tooling/scripts/run.py smoke`     | Check a running local app and its services                           |
| `python -X utf8 tooling/scripts/run.py e2e`       | Run browser tests against the local app                              |
| `python -X utf8 tooling/scripts/run.py benchmark` | Measure large-file browser workloads                                 |
| `python -X utf8 tooling/scripts/run.py backup`    | Back up local app data                                               |

Development and test commands also need JDK 21 and Node 24. Install dependencies with `npm ci`; install Chromium with `npx playwright install chromium`. Python quality tools are pinned in `testing/checks/requirements-implementation.txt`. Full command details and recovery steps are in [testing/checks/README.md](testing/checks/README.md).

## Where things live

| Folder           | Contents                                                                        |
| ---------------- | ------------------------------------------------------------------------------- |
| `backend/`       | Identity, Document and Processing services; shared Java code and SQL migrations |
| `frontend/`      | Next.js application and framework-independent editor core                       |
| `infra/compose/` | Local Docker stack, Dockerfiles and MySQL/Kafka setup                           |
| `infra/gcp/`     | Terraform and VM deployment templates                                           |
| `infra/k8s/`     | Kubernetes manifests and lab overlay                                            |
| `testing/`       | Cross-service checks, browser tests, benchmarks and fixtures                    |
| `tooling/`       | Local build, test, run and deployment scripts                                   |
| `docs/`          | Product/design docs, API/event contracts and setup guides                       |

Unit tests live beside the code they exercise. Root Maven/npm files coordinate builds across workspaces. Generated files such as `node_modules/`, `target/`, `.terraform/` and benchmark output are local build artifacts and are ignored by Git.

## Cloud

Cloud templates use placeholders. Configure them by following [docs/CLOUD_SETUP_HANDOFF.md](docs/CLOUD_SETUP_HANDOFF.md), review the cost estimate against the USD 300 learning budget, and only then run its deployment steps. Local validation commands do not deploy or create paid resources.
