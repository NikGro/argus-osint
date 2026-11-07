# DeepFace plugin

Install **Compare images with DeepFace** from the plugin library; ARGUS downloads DeepFace and its ONNX runtime into the data volume. Comparisons have no overall time limit and use all processor cores available to the container. Manual cancellation, comparison-count limits, output limits and image-size safeguards remain active.

Connect exactly two uploaded or successfully cached image nodes to **Compare images with DeepFace**. The plugin processes local files; the application caches supported remote image inputs before execution. Run the tool explicitly to perform a comparison.

The detail view exposes model, detector, distance metric, normalization, alignment, detection enforcement, face-area expansion, optional custom threshold, and anti-spoofing. **Process images over 40 MP as a reduced working copy** is off by default. If disabled and an input exceeds 40 MP, a dialog asks whether to enable the working copy before inference. When enabled, oversized input is decoded/resized into an EXIF-oriented RGB working copy of at most 40 million pixels. The original uploaded file is never overwritten. Image decoder limits still apply to invalid or exceptionally large files.

**Return images with detection overlays** is on by default. Alongside Match/No match, distance, threshold and available confidence scores, it adds two separately stored image nodes. The JPEG previews show detected boxes, the pair selected for comparison, available detector landmarks, and comparison labels. Only landmarks actually returned by the detector are drawn: OpenCV generally exposes eyes; other supported detectors may provide different detail. With detection skipped, no face boxes are fabricated. The previews are limited to 1600 pixels per side and are not the original files or the images used for inference. Dimensions and resizing are recorded in provenance.

Execution failures create a connected error node and a failed run record. Cancellation remains cancellation. Overlay-generation or storage problems retain available scores and are surfaced as partial-result warnings/error nodes.

DeepFace 0.0.102 runs in its own Python environment under `DATA_DIR/tools/deepface` with the ONNX backend. The installation imports the package without instantiating models or running inference. Model files may be downloaded by upstream on the first explicit execution. Model-specific licenses apply separately; see [THIRD_PARTY.md](../THIRD_PARTY.md).
