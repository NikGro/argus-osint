# Validation

The CI run attached to the release commit and its runtime-validation artifact are the authoritative full-suite results. All research inputs are synthetic or mocked; no real-person research or face recognition is run.

CI runs Ruff, Black, ESLint, Prettier, deterministic frontend build verification, production-bundle Node contracts, the complete Python suite and real Chromium workflows on every push and pull request. ExifTool, FFmpeg and browser dependencies are present in the runtime test image. A smoke test starts the release image with the Compose permissions and checks that the application runs unprivileged and ships no research tools. Publication depends on both CI jobs succeeding.

Changes are also checked on the Synology DSM instance (Linux 4.4, legacy iptables) before release.

Previous iteration records: [archive](archive/iteration-test-history.md).
