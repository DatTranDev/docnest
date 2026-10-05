# Run from PowerShell. Default: review only; -Execute performs the planned cleanup.
[CmdletBinding()]
param([switch]$Execute)

$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
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
    'apps/web/.next'
    'apps/web/dist'
    'apps/web/next-env.d.ts'
    'apps/web/node_modules'
    'apps/web/public/benchmarks'
    'apps/web/test-results'
    'apps/web/tsconfig.tsbuildinfo'
    'checks/__pycache__'
    'fixtures/__pycache__'
    'fixtures/large'
    'node_modules'
    'packages/editor-core/node_modules'
    'reports/backup-restore.log'
    'reports/browser-benchmark-initial.json'
    'reports/browser-benchmark-pre-search-optimization.json'
    'reports/dependency-advisory-detail.jsonl'
    'reports/fresh-start.log'
    'reports/image-secrets.log'
    'reports/infrastructure.log'
    'reports/kafka-secure-start.log'
    'reports/kafka-topic-acls.log'
    'reports/kit-check.log'
    'reports/kubernetes-rendered.yaml'
    'reports/maven-dependency-scan.log'
    'reports/memory-sampler-smoke.json'
    'reports/migration-document-standalone.log'
    'reports/migration-document.log'
    'reports/migration-only.log'
    'reports/migration-processing.log'
    'reports/native-benchmark.log'
    'reports/npm-audit.json'
    'reports/npm-final-build.log'
    'reports/npm-final-lint.log'
    'reports/npm-final-tests.log'
    'reports/npm-final-typecheck.log'
    'reports/npm-streaming-final-build.log'
    'reports/npm-streaming-final-lint.log'
    'reports/npm-streaming-final-tests.log'
    'reports/npm-streaming-final-typecheck.log'
    'reports/processing-compile.log'
    'reports/processing-watchdog-tests.log'
    'reports/refactor-browser-benchmark.log'
    'reports/refactor-cloud-backup-local.log'
    'reports/refactor-cloud-backup-mysql.log'
    'reports/refactor-common-compile.log'
    'reports/refactor-compile.log'
    'reports/refactor-dependency-scan.log'
    'reports/refactor-docker-restart.log'
    'reports/refactor-document-compile.log'
    'reports/refactor-document-format-exports.log'
    'reports/refactor-document-formatter-cli-fixed.log'
    'reports/refactor-document-http.log'
    'reports/refactor-document-runtime-debug.log'
    'reports/refactor-document-tests-third.log'
    'reports/refactor-e2e-types.log'
    'reports/refactor-format-frontend.log'
    'reports/refactor-format-java.log'
    'reports/refactor-frontend-boundaries.log'
    'reports/refactor-gateway-retry-build.log'
    'reports/refactor-gateway-retry-existing.log'
    'reports/refactor-identity-tests.log'
    'reports/refactor-image-os.log'
    'reports/refactor-image-secrets.log'
    'reports/refactor-import-expansion.log'
    'reports/refactor-lint.log'
    'reports/refactor-native-benchmark.log'
    'reports/refactor-next-lint-contract.log'
    'reports/refactor-next-lint.log'
    'reports/refactor-npm-audit-initial.json'
    'reports/refactor-npm-install-patched.log'
    'reports/refactor-npm-install.log'
    'reports/refactor-npm-versions.log'
    'reports/refactor-performance-report.log'
    'reports/refactor-processing-proxy-image.log'
    'reports/refactor-processing-proxy-up.log'
    'reports/refactor-python-quality-dependencies.log'
    'reports/refactor-quality.log'
    'reports/refactor-replay-contract.log'
    'reports/refactor-secret-scan.log'
    'reports/refactor-web-alpine-build.log'
    'reports/refactor-web-alpine-gateway-tests.log'
    'reports/refactor-web-alpine-os-scan.log'
    'reports/refactor-web-alpine-platform.log'
    'reports/refactor-web-alpine-up.log'
    'reports/report-generator-tests.log'
    'reports/scout-image-scan.log'
    'reports/trivy-db-download.log'
    'reports/web-streaming-final-image.log'
    'scripts/__pycache__'
    'services/common/target/classes'
    'services/common/target/editor-common-1.0.0-SNAPSHOT.jar'
    'services/common/target/generated-sources'
    'services/common/target/generated-test-sources'
    'services/common/target/maven-archiver'
    'services/common/target/maven-status'
    'services/common/target/native-benchmark-classpath.txt'
    'services/common/target/spotless-index'
    'services/common/target/test-classes'
    'services/document-service/target/classes'
    'services/document-service/target/document-service-1.0.0-SNAPSHOT.jar'
    'services/document-service/target/document-service-1.0.0-SNAPSHOT.jar.original'
    'services/document-service/target/generated-sources'
    'services/document-service/target/generated-test-sources'
    'services/document-service/target/maven-archiver'
    'services/document-service/target/maven-status'
    'services/document-service/target/refactor-cp.txt'
    'services/document-service/target/spotless-index'
    'services/document-service/target/test-classes'
    'services/identity-service/target/classes'
    'services/identity-service/target/generated-sources'
    'services/identity-service/target/generated-test-sources'
    'services/identity-service/target/identity-service-1.0.0-SNAPSHOT.jar'
    'services/identity-service/target/identity-service-1.0.0-SNAPSHOT.jar.original'
    'services/identity-service/target/maven-archiver'
    'services/identity-service/target/maven-status'
    'services/identity-service/target/spotless-index'
    'services/identity-service/target/test-classes'
    'services/processing-service/target/classes'
    'services/processing-service/target/generated-sources'
    'services/processing-service/target/generated-test-sources'
    'services/processing-service/target/maven-archiver'
    'services/processing-service/target/maven-status'
    'services/processing-service/target/processing-service-1.0.0-SNAPSHOT.jar'
    'services/processing-service/target/processing-service-1.0.0-SNAPSHOT.jar.original'
    'services/processing-service/target/refactor-cp.txt'
    'services/processing-service/target/spotless-index'
    'services/processing-service/target/test-classes'
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
    retained = @('source', 'lockfiles', 'small native fixtures', 'handoff documents',
        'current and referenced evidence', 'failure logs', 'JUnit reports',
        '.env', 'Docker images/volumes', 'backups', 'installed validation tools')
}
$taskOutput = if ($Execute) { 'reports/cleanup.json' } else { 'reports/cleanup-plan.json' }
$taskReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskRoot $taskOutput)
$taskResults | Format-Table path, files, bytes, status -AutoSize
$taskTotalBytes = [long](($taskResults | Measure-Object -Property bytes -Sum).Sum)
Write-Output ("{0}: {1} entries, {2:N1} MiB. Report: {3}" -f $(if ($Execute) { 'Deleted' } else { 'Review only' }), $taskResults.Count, ($taskTotalBytes / 1MB), $taskOutput)
if (-not $Execute) {
    Write-Output 'No files deleted. Apply this reviewed plan with: .\scripts\cleanup-local.ps1 -Execute'
} else {
    Write-Output 'Development dependencies/builds were removed. Run npm ci and rebuild before development tests.'
}
