# Third-party projects and notices

The original ARGUS application code is MIT licensed; see [LICENSE](LICENSE). That license does **not** replace the licenses of research engines, datasets, libraries, icons, model weights or operating-system packages. This repository publishes application source and build recipes, not a prebuilt third-party tool/model distribution. The research tools below are not part of the image: ARGUS downloads each one from its upstream source into the data volume when you install a plugin that needs it. A built image and a data volume with installed tools contain separately licensed components and cannot be described as MIT-only.

The following projects make ARGUS possible. Repository ownership and links identify upstream maintainers; no endorsement or partnership is implied. The executable version record is the Dockerfile, `requirements.txt`, the tool recipes in `core/tools.py`, the hash-pinned tool locks in `core/tool_locks/` and the package lock.

| Component / upstream credit | Version or pin | Role and license notes |
| --- | --- | --- |
| [Consensus OSINT — OSINT Experts Society](https://github.com/OSINT-Experts-Society/Consensus-OSINT/tree/d8545a7ebf39bf40ce11b5ee7c6f1c2ebb9c5697) | v0.4.10 / `d8545a7ebf39bf40ce11b5ee7c6f1c2ebb9c5697` | Research aggregation; GPL-3.0-or-later. Its own third-party notices and vendored license files are retained in `DATA_DIR/tools/consensus/src`. |
| [Sherlock — Sherlock Project](https://github.com/sherlock-project/sherlock) | `sherlock-project==0.16.2` | Username discovery; MIT. |
| [Holehe — megadose](https://github.com/megadose/holehe) | `1.61` | Email-account checks; GPL-3.0. |
| [Maigret — soxoj and contributors](https://github.com/soxoj/maigret) | `0.6.6` | Username/profile research; MIT. |
| [User Scanner — kaifcodec](https://github.com/kaifcodec/user-scanner) | `1.5.2.2` | Username/email providers; MIT. |
| [Ignorant — megadose](https://github.com/megadose/ignorant) | `1.2` | Supported phone checks; GPL-3.0. |
| [PhoneInfoga — sundowndev](https://github.com/sundowndev/phoneinfoga/tree/v2.11.0) | `v2.11.0`, verified release checksums | Phone research; GPL-3.0. |
| [Blackbird — Lucas Antoniaci / p1ngul1n0](https://github.com/p1ngul1n0/blackbird/tree/b45505080ef51bb3ef52dc29879ee6bef31e5b94) | `b45505080ef51bb3ef52dc29879ee6bef31e5b94` | Research adapter. **CC BY-NC-SA 4.0** in the pinned archive's `.github/LICENSE`; noncommercial/share-alike terms apply to Blackbird. Its source, data and notices remain in the isolated checkout. Blackbird incorporates work such as [WhatsMyName](https://github.com/WebBreacher/WhatsMyName); retain upstream dataset notices too. |
| [FlareSolverr — FlareSolverr contributors](https://github.com/FlareSolverr/FlareSolverr/tree/76dc4049becf8fcb26b7ebd6a7ef266d508a5909) | `76dc4049becf8fcb26b7ebd6a7ef266d508a5909` | On-demand browser-backed collection; MIT. |
| [instagrapi — Mark Subzeroid and contributors](https://github.com/subzeroid/instagrapi) | `3.0.25` | Instagram adapter runtime; MIT. |
| [Toutatis — megadose](https://github.com/megadose/toutatis) | `1.31` | Supplemental Instagram profile/masked lookup adapter; GPL-3.0. |
| [DeepFace — Sefik Ilkin Serengil and contributors](https://github.com/serengil/deepface/tree/v0.0.102) | `0.0.102` | Local image comparison; MIT for the library. Model/weight licenses are separate. |
| [Dopplergeist — 1337isnot1337](https://github.com/1337isnot1337/DOPPLERGEIST) | `dopplergeist==0.1.2` | Audio geolocation from aircraft Doppler shifts and public ADS-B history (adsb.lol), installed with its plugin. **PolyForm Noncommercial 1.0.0: private, noncommercial use only**; commercial use such as investigations for clients needs the author's permission. Downloaded flight and map data keep their own terms. |
| [ONNX Runtime — Microsoft and contributors](https://github.com/microsoft/onnxruntime), [OpenCV](https://github.com/opencv/opencv), [NumPy](https://github.com/numpy/numpy) | `core/tools.py` (DeepFace recipe) | Isolated CPU inference dependencies; their upstream licenses/notices remain applicable. TensorFlow is not used by the ARGUS ONNX installer. |
| [Pillow](https://github.com/python-pillow/Pillow), [python-phonenumbers](https://github.com/daviddrysdale/python-phonenumbers) | `requirements.txt` | Image handling and number parsing; respective upstream/Pillow license and Apache-2.0 terms. |
| [Cryptography — Python Cryptographic Authority](https://github.com/pyca/cryptography) | `requirements.txt` | Installation-local encryption; upstream dual Apache-2.0/BSD terms. |
| [Material Design Icons — Pictogrammers](https://github.com/Templarian/MaterialDesign) | Bundled paths in `static/icons.js` | Icons and notices: [static/mdi-LICENSE.txt](static/mdi-LICENSE.txt), [Apache-2.0 text](static/licenses/Apache-2.0.txt). The ARGUS app's own code license does not relicense these icon paths. |
| [OpenVPN](https://github.com/OpenVPN/openvpn), [WireGuard tools](https://git.zx2c4.com/wireguard-tools/) | Debian packages in the `Dockerfile` | Optional gateway components; upstream GPL licenses and package notices apply. |
| [Python](https://www.python.org/), [Debian](https://www.debian.org/), [Chromium](https://www.chromium.org/), [ExifTool — Phil Harvey](https://exiftool.org/) | Dockerfile / base image | Runtime, browser and metadata extraction; respective upstream and Debian package copyright files. |
| [ESLint](https://github.com/eslint/eslint), [Prettier](https://github.com/prettier/prettier), [esbuild](https://github.com/evanw/esbuild) | `package-lock.json` | Development-only frontend tooling; MIT and transitive package notices. |

## Distribution boundaries

No third-party research-engine source tree, installed Python environment, downloaded model weights or research-tool binary is copied into this Git repository. The build downloads pinned releases/source where specified. Tool wrappers are ARGUS code; the wrapped projects retain their own ownership and terms. Distribution of a built container or a modified third-party tool must meet the corresponding license obligations, including applicable copyleft, attribution, noncommercial and source-provision requirements. The permissive license on ARGUS alone does not grant broader rights over those components.

DeepFace model weights are downloaded by upstream on a user's first relevant execution. ARGUS does not preload weights, instantiate models or run image comparisons during installation. Check the chosen model's own terms before redistributing weights or a cache.

Direct pins reduce drift; transitive Python packages, base images and Debian repositories are not a complete hermetic lock or full license/security bill of materials. Retain the packages' installed license/copyright files and the complete upstream checkouts/notices when redistributing a build. This beta source publication does not include a prebuilt image.

## Video and audio processing

- [FFmpeg](https://ffmpeg.org/) — Debian executable for probing, extraction and H.264/AAC video and audio trimming. Debian builds may include GPL components such as libx264; see `/usr/share/doc/ffmpeg/copyright` and upstream license/configuration. These terms apply independently of ARGUS MIT code.
- [OpenCV](https://opencv.org/) and NumPy — installed as the media tool for ARGUS CPU alignment and fusion.
- [Jamy-L/Handheld-Multi-Frame-Super-Resolution](https://github.com/Jamy-L/Handheld-Multi-Frame-Super-Resolution) was evaluated but is not bundled or executed by this CPU workflow.
- Canvas geometry follows [n8n behavior](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/edges/utils/getEdgeRenderData.ts) and Vue Flow: forward Bezier curves and rounded backwards detours. ARGUS geometry is implemented locally; no n8n source is bundled.

## Maps and online services

- Map previews load tiles from [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors, ODbL) through ARGUS and show the attribution. Follow the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- Place normalization uses [Photon by Komoot](https://photon.komoot.io/) and optionally a [Nominatim](https://nominatim.org/) endpoint you configure; both serve OpenStreetMap data under their own terms.
- Dopplergeist reads historical ADS-B flight data from [adsb.lol](https://adsb.lol/) (ODbL); downloaded data keeps its own terms.
- Username site lists come from [WhatsMyName](https://github.com/WebBreacher/WhatsMyName) (CC BY-SA 4.0) where a plugin uses it.

## React interface

React and React DOM 19.3.1 and Scheduler are maintained by Meta Platforms and contributors and distributed under MIT. Their notices are shipped in `static/react-LICENSE.txt`, `static/react-dom-LICENSE.txt` and `static/scheduler-LICENSE.txt`. The browser bundle is built locally and served by ARGUS; no CDN is required.
