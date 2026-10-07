# Golden files and benchmark data

Run python testing/fixtures/generate_fixtures.py to create four small fixtures. Add --large for 10 MiB and million-line workloads. Large files are generated on demand to keep the repository small. Use --output PATH for a separate directory.

empty, unicode uniform, mixed runs and dense ascii cover all three tags and N=0. index.json records the full native hash, manifest and expected styles. Fixtures use ZIP STORE and fixed 1980 timestamps for deterministic reproduction. NativeSha256 in event examples is a placeholder; integration tests must use actual fixture hashes rather than copying aaaa.

The generator does not prove renderer performance or application grapheme correctness. P04/P11 implement independent Java/TypeScript decoders and oracle tests. The Java validator must read fixtures rather than invoke the generator as a decoder. Multilingual text, combining marks and emoji are intentional test payloads, not untranslated documentation.
