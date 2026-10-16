# Third-party projects and notices

The original ARGUS application code is MIT licensed; see [LICENSE](LICENSE). That license does **not** replace the licenses of research engines, datasets, libraries, icons, model weights or operating-system packages. This repository publishes application source and build recipes, not a prebuilt third-party tool/model distribution. A built image contains separately licensed components and cannot be described as MIT-only.

The following projects make ARGUS possible. Repository ownership and links identify upstream maintainers; no endorsement or partnership is implied. The executable version record is the Dockerfile, requirements files, installation scripts and package lock.

| Component / upstream credit | Version or pin | Role and license notes |
| --- | --- | --- |
| [Consensus OSINT — OSINT Experts Society](https://github.com/OSINT-Experts-Society/Consensus-OSINT/tree/d8545a7ebf39bf40ce11b5ee7c6f1c2ebb9c5697) | v0.4.10 / `d8545a7ebf39bf40ce11b5ee7c6f1c2ebb9c5697` | Research aggregation; GPL-3.0-or-later. Its own third-party notices and vendored license files are retained in `/opt/argus-tools/consensus`. |
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
| [ONNX Runtime — Microsoft and contributors](https://github.com/microsoft/onnxruntime), [OpenCV](https://github.com/opencv/opencv), [NumPy](https://github.com/numpy/numpy) | `scripts/install_deepface.py` | Isolated CPU inference dependencies; their upstream licenses/notices remain applicable. TensorFlow is not used by the ARGUS ONNX installer. |
| [Pillow](https://github.com/python-pillow/Pillow), [python-phonenumbers](https://github.com/daviddrysdale/python-phonenumbers) | `requirements.txt` | Image handling and number parsing; respective upstream/Pillow license and Apache-2.0 terms. |
| [Cryptography — Python Cryptographic Authority](https://github.com/pyca/cryptography) | `requirements-core.txt` | Installation-local encryption; upstream dual Apache-2.0/BSD terms. |
| [Material Design Icons — Pictogrammers](https://github.com/Templarian/MaterialDesign) | Bundled paths in `static/icons.js` | Icons and notices: [static/mdi-LICENSE.txt](static/mdi-LICENSE.txt), [Apache-2.0 text](static/licenses/Apache-2.0.txt). The ARGUS app's own code license does not relicense these icon paths. |
| [OpenVPN](https://github.com/OpenVPN/openvpn), [WireGuard tools](https://git.zx2c4.com/wireguard-tools/) | Debian packages in `deploy/Dockerfile.vpn` | Optional gateway components; upstream GPL licenses and package notices apply. |
| [Python](https://www.python.org/), [Debian](https://www.debian.org/), [Chromium](https://www.chromium.org/), [ExifTool — Phil Harvey](https://exiftool.org/) | Dockerfile / base image | Runtime, browser and metadata extraction; respective upstream and Debian package copyright files. |
| [ESLint](https://github.com/eslint/eslint), [Prettier](https://github.com/prettier/prettier), [esbuild](https://github.com/evanw/esbuild) | `package-lock.json` | Development-only frontend tooling; MIT and transitive package notices. |

## Distribution boundaries

No third-party research-engine source tree, installed Python environment, downloaded model weights or research-tool binary is copied into this Git repository. The build downloads pinned releases/source where specified. Tool wrappers are ARGUS code; the wrapped projects retain their own ownership and terms. Distribution of a built container or a modified third-party tool must meet the corresponding license obligations, including applicable copyleft, attribution, noncommercial and source-provision requirements. The permissive license on ARGUS alone does not grant broader rights over those components.

DeepFace model weights are downloaded by upstream on a user's first relevant execution. ARGUS does not preload weights, instantiate models or run image comparisons during installation. Check the chosen model's own terms before redistributing weights or a cache.

Direct pins reduce drift; transitive Python packages, base images and Debian repositories are not a complete hermetic lock or full license/security bill of materials. Retain the packages' installed license/copyright files and the complete upstream checkouts/notices when redistributing a build. This alpha source publication does not include a prebuilt image.
