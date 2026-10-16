"""Pin Instagram dependencies in their own environment, no external service."""
from pathlib import Path
import subprocess
root=Path('/opt/argus-tools/instagram-venv')
subprocess.run(['python','-m','venv',str(root)],check=True)
subprocess.run([str(root/'bin/pip'),'install','--no-cache-dir','instagrapi==3.0.25'],check=True)
