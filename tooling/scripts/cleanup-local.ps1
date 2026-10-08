# Run from PowerShell. Default: review only; -Execute performs the planned cleanup.
[CmdletBinding()]
param([switch]$Execute)

$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\', '/')
$taskPaths = @(
    '.tools/SpotlessProbe.java'
    '.tools/cloud-compose-validation.env'
    '.tools/cloud-digests.json'
    '.tools/cloud-render'
    '.tools/cloud-render-review'
    '.tools/dependency-scan'
    '.tools/digests-example.json'
    '.tools/final_runtime.py'
    '.tools/finalize_e2e.py'
    '.tools/frontend-refactor'
    '.tools/image-scan'
    '.tools/jdk-assets.json'
    '.tools/jdk.zip'
    '.tools/native_probe.py'
    '.tools/native_repeat_probe.py'
    '.tools/normalize_hcl.py'
    '.tools/old-gateway-keepalive.mjs'
    '.tools/old-gateway.mjs'
    '.tools/read_advisories.py'
    '.tools/refactor-all-cp.txt'
    '.tools/refactor-document-adapters.py'
    '.tools/refactor-document-background.py'
    '.tools/refactor-document-docjdbc.py'
    '.tools/refactor-document-docs.py'
    '.tools/refactor-document-documentcommands.py'
    '.tools/refactor-document-features.py'
    '.tools/refactor-document-http.py'
    '.tools/refactor-document-mutations.py'
    '.tools/refactor-document-save.py'
    '.tools/refactor-document-sharing.py'
    '.tools/refactor-document-sharingcommands.py'
    '.tools/refactor-document-wire.py'
    '.tools/refactor-document.py'
    '.tools/refactor_finish.py'
    '.tools/refactor_processing.py'
    '.tools/spring-kafka-4.1.1-sources.jar'
    '.tools/terraform.zip'
    '.tools/terraform_SHA256SUMS'
    '.tools/update_runtime_compat.py'
    '.tools/write_node_compatibility.py'
    '.tools/write_perf_report.py'
    'ENGLISH_EDITION_REPORT.json'
    'KIT_VALIDATION_REPORT.json'
    'frontend/web/.next'
    'frontend/web/dist'
    'frontend/web/next-env.d.ts'
    'frontend/web/node_modules'
    'frontend/web/public/benchmarks'
    'frontend/web/test-results'
    'frontend/web/tsconfig.tsbuildinfo'
    'testing/checks/__pycache__'
    'testing/benchmark/__pycache__'
    'testing/benchmark/generated'
    'node_modules'
    'frontend/editor-core/node_modules'
    'testing/reports/backup-restore.log'
    'testing/reports/browser-benchmark-initial.json'
    'testing/reports/browser-benchmark-pre-search-optimization.json'
    'testing/reports/dependency-advisory-detail.jsonl'
    'testing/reports/fresh-start.log'
    'testing/reports/image-secrets.log'
    'testing/reports/infrastructure.log'
    'testing/reports/kafka-secure-start.log'
    'testing/reports/kafka-topic-acls.log'
    'testing/reports/kit-check.log'
    'testing/reports/kubernetes-rendered.yaml'
    'testing/reports/maven-dependency-scan.log'
    'testing/reports/memory-sampler-smoke.json'
    'testing/reports/migration-document-standalone.log'
    'testing/reports/migration-document.log'
    'testing/reports/migration-only.log'
    'testing/reports/migration-processing.log'
    'testing/reports/native-benchmark.log'
    'testing/reports/npm-audit.json'
    'testing/reports/npm-final-build.log'
    'testing/reports/npm-final-lint.log'
    'testing/reports/npm-final-tests.log'
    'testing/reports/npm-final-typecheck.log'
    'testing/reports/npm-streaming-final-build.log'
    'testing/reports/npm-streaming-final-lint.log'
    'testing/reports/npm-streaming-final-tests.log'
    'testing/reports/npm-streaming-final-typecheck.log'
    'testing/reports/processing-compile.log'
    'testing/reports/processing-watchdog-tests.log'
    'testing/reports/refactor-browser-benchmark.log'
    'testing/reports/refactor-cloud-backup-local.log'
    'testing/reports/refactor-cloud-backup-mysql.log'
    'testing/reports/refactor-common-compile.log'
    'testing/reports/refactor-compile.log'
    'testing/reports/refactor-dependency-scan.log'
    'testing/reports/refactor-docker-restart.log'
    'testing/reports/refactor-document-compile.log'
    'testing/reports/refactor-document-format-exports.log'
    'testing/reports/refactor-document-formatter-cli-fixed.log'
    'testing/reports/refactor-document-http.log'
    'testing/reports/refactor-document-runtime-debug.log'
    'testing/reports/refactor-document-tests-third.log'
    'testing/reports/refactor-e2e-types.log'
    'testing/reports/refactor-format-frontend.log'
    'testing/reports/refactor-format-java.log'
    'testing/reports/refactor-frontend-boundaries.log'
    'testing/reports/refactor-gateway-retry-build.log'
    'testing/reports/refactor-gateway-retry-existing.log'
    'testing/reports/refactor-identity-tests.log'
    'testing/reports/refactor-image-os.log'
    'testing/reports/refactor-image-secrets.log'
    'testing/reports/refactor-import-expansion.log'
    'testing/reports/refactor-lint.log'
    'testing/reports/refactor-native-benchmark.log'
    'testing/reports/refactor-next-lint-contract.log'
    'testing/reports/refactor-next-lint.log'
    'testing/reports/refactor-npm-audit-initial.json'
    'testing/reports/refactor-npm-install-patched.log'
    'testing/reports/refactor-npm-install.log'
    'testing/reports/refactor-npm-versions.log'
    'testing/reports/refactor-performance-report.log'
    'testing/reports/refactor-processing-proxy-image.log'
    'testing/reports/refactor-processing-proxy-up.log'
    'testing/reports/refactor-python-quality-dependencies.log'
    'testing/reports/refactor-quality.log'
    'testing/reports/refactor-replay-contract.log'
    'testing/reports/refactor-secret-scan.log'
    'testing/reports/refactor-web-alpine-build.log'
    'testing/reports/refactor-web-alpine-gateway-tests.log'
    'testing/reports/refactor-web-alpine-os-scan.log'
    'testing/reports/refactor-web-alpine-platform.log'
    'testing/reports/refactor-web-alpine-up.log'
    'testing/reports/report-generator-tests.log'
    'testing/reports/scout-image-scan.log'
    'testing/reports/trivy-db-download.log'
    'testing/reports/web-streaming-final-image.log'
    'tooling/scripts/__pycache__'
    'backend/common/target/classes'
    'backend/common/target/editor-common-1.0.0-SNAPSHOT.jar'
    'backend/common/target/generated-sources'
    'backend/common/target/generated-test-sources'
    'backend/common/target/maven-archiver'
    'backend/common/target/maven-status'
    'backend/common/target/native-benchmark-classpath.txt'
    'backend/common/target/spotless-index'
    'backend/common/target/test-classes'
    'backend/document-service/target/classes'
    'backend/document-service/target/document-service-1.0.0-SNAPSHOT.jar'
    'backend/document-service/target/document-service-1.0.0-SNAPSHOT.jar.original'
    'backend/document-service/target/generated-sources'
    'backend/document-service/target/generated-test-sources'
    'backend/document-service/target/maven-archiver'
    'backend/document-service/target/maven-status'
    'backend/document-service/target/refactor-cp.txt'
    'backend/document-service/target/spotless-index'
    'backend/document-service/target/test-classes'
    'backend/identity-service/target/classes'
    'backend/identity-service/target/generated-sources'
    'backend/identity-service/target/generated-test-sources'
    'backend/identity-service/target/identity-service-1.0.0-SNAPSHOT.jar'
    'backend/identity-service/target/identity-service-1.0.0-SNAPSHOT.jar.original'
    'backend/identity-service/target/maven-archiver'
    'backend/identity-service/target/maven-status'
    'backend/identity-service/target/spotless-index'
    'backend/identity-service/target/test-classes'
    'backend/processing-service/target/classes'
    'backend/processing-service/target/generated-sources'
    'backend/processing-service/target/generated-test-sources'
    'backend/processing-service/target/maven-archiver'
    'backend/processing-service/target/maven-status'
    'backend/processing-service/target/processing-service-1.0.0-SNAPSHOT.jar'
    'backend/processing-service/target/processing-service-1.0.0-SNAPSHOT.jar.original'
    'backend/processing-service/target/refactor-cp.txt'
    'backend/processing-service/target/spotless-index'
    'backend/processing-service/target/test-classes'
    'target/spotless-index'
)
$taskResults = [Collections.Generic.List[object]]::new()

foreach ($taskRelative in $taskPaths) {
    $taskAbsolute = [IO.Path]::GetFullPath((Join-Path $taskRoot $taskRelative))
    if (-not $taskAbsolute.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Cleanup target is outside the repository: $taskRelative"
    }
    if (-not (Test-Path -LiteralPath $taskAbsolute)) { continue }
    $taskItem = Get-Item -LiteralPath $taskAbsolute -Force
    if ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing a linked cleanup root: $taskRelative"
    }
    $taskFiles = if ($taskItem.PSIsContainer) {
        @(Get-ChildItem -LiteralPath $taskAbsolute -File -Recurse -Force)
    } else { @($taskItem) }
    $taskBytes = [long](($taskFiles | Measure-Object -Property Length -Sum).Sum)
    $taskStatus = 'PLANNED'
    if ($Execute) {
        Remove-Item -LiteralPath $taskAbsolute -Recurse -Force
        $taskStatus = 'DELETED'
    }
    $taskResults.Add([pscustomobject]@{
        path = $taskRelative
        files = $taskFiles.Count
        bytes = $taskBytes
        status = $taskStatus
    })
}

$taskReport = [ordered]@{
    recordedAt = [DateTime]::UtcNow.ToString('o')
    executed = [bool]$Execute
    entries = @($taskResults.ToArray())
    retained = @('source', 'lockfiles', 'handoff documents',
        'current and referenced evidence', 'failure logs', 'JUnit reports',
        '.env', 'Docker images/volumes', 'backups', 'installed validation tools')
}
$taskOutput = if ($Execute) { 'testing/reports/cleanup.json' } else { 'testing/reports/cleanup-plan.json' }
$taskReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskRoot $taskOutput)
$taskResults | Format-Table path, files, bytes, status -AutoSize
$taskTotalBytes = [long](($taskResults | Measure-Object -Property bytes -Sum).Sum)
Write-Output ("{0}: {1} entries, {2:N1} MiB. Report: {3}" -f $(if ($Execute) { 'Deleted' } else { 'Review only' }), $taskResults.Count, ($taskTotalBytes / 1MB), $taskOutput)
if (-not $Execute) {
    Write-Output 'No files deleted. Apply this reviewed plan with: .\tooling\scripts\cleanup-local.ps1 -Execute'
} else {
    Write-Output 'Development dependencies/builds were removed. Run npm ci and rebuild before development tests.'
}
