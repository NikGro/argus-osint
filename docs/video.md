# Video tools (alpha 2)

Upload a video through the Video data node or drag a file into a project (maximum 128 MB). Enable **Glance: Video player** for an embedded player; **Open video** opens the stored file in a new tab. Playback depends on browser codec support; MP4/H.264/AAC and WebM are preferred. Other recognized video formats remain usable as tool inputs and downloadable files. Media is streamed with byte-range support for seeking.

**Trim video** takes one video, a start and an end in seconds, and creates a new MP4/H.264/AAC copy. It decodes/re-encodes for time-accurate cuts instead of keyframe-only copying. Maximum clip duration: 600 seconds. The original is retained.

**Fuse video frames into an image** accepts one video and 0.2–3 seconds from a chosen start. It samples 2–32 lossless PNG frames into a temporary directory, limited to 1280×720 without enlarging smaller input. The CPU worker chooses the sharpest reference, estimates Euclidean subpixel alignment with OpenCV ECC, rejects unreliable frames, and fuses aligned images with sharpness and per-pixel robust weights. Output: a new PNG image node with source parameters, frame counts and alignment scores. Rejected frames produce a partial-result warning/error node. With fewer than two reliable frames the tool fails explicitly. Temporary frames are removed on exit.

Scale 2 uses bicubic enlargement after fusion; it is **not additional recovered resolution**. This is non-generative fusion, not a guarantee of sharper or accurate recovered detail. Moving subjects, compression, rolling shutter and poor texture can limit results.

The CPU implementation uses FFmpeg and OpenCV, **not Jamy-L MFSR**. The examined Jamy-L implementation expects RAW/DNG and NVIDIA CUDA. CPU fusion was selected for the Synology instead. The existing isolated OpenCV/NumPy runtime is reused; no DeepFace model or face comparison is imported or executed.

## Graphical time and area selection

Connect a Video node to Trim video. Its details show the source player, start/end sliders, buttons for marking the current playhead, and an optional draggable crop rectangle. Both sliders span the complete source; the selected clip remains limited to 600 seconds. Crop coordinates are normalized to the displayed, auto-rotated source; the backend validates the rectangle and uses even pixel boundaries for H.264. Output is a new MP4, with optional audio retained. The original is unchanged.

Video nodes expose a canvas Glance checkbox and an Open in new tab action in their details. Media processing uses its own CPU environment (`media-venv`), independently of DeepFace.

## Photo cropping

Connect one Image node to Photo crop. Move or resize the rectangle, or use the keyboard-accessible position/size sliders. Output is a separate lossless PNG after EXIF orientation correction. The input is unchanged. Inputs are limited to 40 MP; generated artifacts are limited to 128 MB.

## Project files

New uploads and tool artifacts live in `/data/files/projects/<project-id>/<file-id>`. Downloaded remote images are attached there when the graph is saved; their original URL remains in the node. Stable file IDs allow references and history to keep working. Shared files use hard links where supported. Legacy/cache staging files may also remain in `/data/files/`; unreferenced artifacts use the existing conservative garbage-collection lease.
