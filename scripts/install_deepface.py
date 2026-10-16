"""Install an isolated CPU runtime. Do not load models or compare images during builds."""

from pathlib import Path
import subprocess
import os

venv = Path("/opt/argus-tools/deepface-venv")
subprocess.run(["python", "-m", "venv", str(venv)], check=True)
subprocess.run(
    [
        str(venv / "bin/pip"),
        "install",
        "--no-cache-dir",
        "deepface==0.0.102",
        "onnxruntime==1.20.1",
        "numpy==1.26.4",
        "opencv-python==4.11.0.86",
        "opencv-contrib-python-headless==4.11.0.86",
    ],
    check=True,
)
# Imports only: no model creation, downloads of model weights, or inference.
subprocess.run(
    [
        str(venv / "bin/python"),
        "-c",
        "import onnxruntime; from deepface import DeepFace; "
        "from deepface.modules.modeling import get_model_class; "
        "[get_model_class('facial_recognition', name) for name in "
        "['SFace','VGG-Face','Facenet','Facenet512','OpenFace','DeepFace','DeepID','ArcFace','GhostFaceNet']]; "
        "[get_model_class('face_detector', name) for name in ['opencv','ssd','yunet','centerface']]; "
        "get_model_class('spoofing','Fasnet'); print('DeepFace ONNX imports OK; no models instantiated')",
    ],
    check=True,
    env={**os.environ, "DEEPFACE_BACKEND_ENGINE": "onnx"},
)
