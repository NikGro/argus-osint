# 26.10.2 Beta 1 validation

The CI run attached to the release commit and its runtime-validation artifact are the authoritative full-suite results. All research inputs are synthetic or mocked; no real-person research or face recognition is run.

CI runs Ruff, Black, ESLint, Prettier, deterministic frontend build verification, production-bundle Node contracts, the complete Python suite and real Chromium workflows on every push and pull request. ExifTool, FFmpeg and browser dependencies are present in the runtime test image. A separate root-container probe checks zero worker capabilities, inherited seccomp, a private-data community subprocess and Chromium’s offline self-test. Publication depends on both CI jobs succeeding.

The managed Synology host is a separate environment: absent namespace/capability permissions remain a fail-closed limitation and must not be reported as a successful isolated-worker test. Optional AppArmor requires host-specific validation.

Previous iteration records: [archive](archive/iteration-test-history.md).
