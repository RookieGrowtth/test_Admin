# Original testcase engine

Copied without changes from `/Users/sheep/Desktop/test_Tool/helpers/TestCaseGeneratorEngine`.
SHA256: `fd64bac8d7fc84014481c1994a9971824b6da9b02f854688f667548b75c9902b`.

This self-contained PyInstaller executable supports macOS arm64 only. It contains the original document parsers, vision workflow, knowledge profiles, strict quality gate and Excel/XMind/Markdown writers. Do not claim Linux/Docker support for this adapter. No desktop configuration, API keys or user documents are included.

The Node service supplies an authenticated loopback gateway, per-account knowledge and per-job inputs/artifacts. Model secrets are decrypted in memory and are not passed to the executable; the executable receives a short-lived gateway token. SSE responses are accepted only when complete.
