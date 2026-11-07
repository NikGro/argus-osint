# Runtime: plugins, tools and parallel work

ARGUS runs as one container. It starts with no research plugins installed:
the image holds the application, the browser and media system libraries
(Chromium, Xvfb, ExifTool, FFmpeg, libGL) and the VPN controller, and nothing
else. Everything a plugin needs is downloaded when you install it.

## Installing plugins

The plugin library lists the ARGUS plugins (`plugins/native.json`) and the
plugins of every community repository you added. **Install** downloads:

1. The plugin's files from the ARGUS repository at the image's source
   revision (`ARGUS_SOURCE_REF`, by default the release tag `v<VERSION>`).
   Every file must match the SHA-256 in `plugins/native.json`; otherwise the
   installation fails and nothing changes.
2. The research tools the plugin declares (for example Sherlock, Maigret,
   DeepFace or the FlareSolverr browser). Each tool gets its own Python
   environment or binary under `DATA_DIR/tools/<tool>`. Python tools install
   only the packages in `core/tool_locks/<tool>.txt`, each verified by
   SHA-256 (`pip --require-hashes`); sources from GitHub are pinned to a commit
   and binaries to the publisher's checksum. `scripts/lock_tools.py`
   regenerates the locks after a version change.
3. The website catalogues built from the installed tools.

Installation runs in the background; the library shows the current step and,
on failure, the error and the installation log. An interrupted or outdated tool
installation is repeated on the next start.

**Remove** uninstalls the plugin, keeps its settings and deletes every tool
that no other installed plugin needs. Reinstalling downloads them again.

## Execution

Plugins and tools run as ordinary child processes of the application, as UID
10001, inside the container. There is no per-job sandbox and no time limit for
a whole tool run: a tool runs until it is done or you cancel it. Individual
network requests keep their own timeouts. Heavy work such as DeepFace or video
fusion uses all processor cores available to the container.

Community plugins run the same way, with all of ARGUS's permissions: they can
read projects, credentials and files and use the network. ARGUS does not review
them. Install only repositories you have read and whose author you trust.

## Parallel tools

**Settings → Parallel tools** sets how many tools run at the same time (1–32,
default 1). **Detect system resources** reads the processor cores and free
memory available to the container (cgroup limits included) and sets a
recommendation of one tool per core, limited to about 1.5 GB of free memory per
tool. The change applies immediately.

Tools that run at the same time share the VPN connection. A VPN rotation waits
until no tool is running; new tools wait until the new connection is verified.
Results of tools that run in parallel in the same project are merged when they
are saved.

## Supervisor

`scripts/container_entry.py` starts as root only to prepare the data folders
and start the VPN controller, then starts the application as UID 10001. If the
VPN controller stops, the application stops too, so traffic never leaves the
tunnel unexpectedly. Started without root, ARGUS runs normally with the VPN
unavailable. See [deployment](../deploy/README.md) for the capabilities.
