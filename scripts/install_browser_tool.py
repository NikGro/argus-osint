"""Bundle a pinned FlareSolverr engine as an on-demand CLI, no HTTP service."""
import io
from pathlib import Path
import subprocess
import tarfile
import urllib.request
SHA='76dc4049becf8fcb26b7ebd6a7ef266d508a5909'
root=Path('/opt/argus-tools');root.mkdir(exist_ok=True,parents=True)
with urllib.request.urlopen('https://codeload.github.com/FlareSolverr/FlareSolverr/tar.gz/'+SHA,timeout=60) as response:data=response.read()
archive=tarfile.open(fileobj=io.BytesIO(data));archive.extractall(root,filter='data')
folder=root/('FlareSolverr-'+SHA)
if not folder.exists():folder=next(p for p in root.iterdir() if p.name.lower()=='flaresolverr-'+SHA)
folder.rename(root/'flaresolverr')
venv=root/'flaresolverr-venv'
subprocess.run(['python','-m','venv',str(venv)],check=True)
subprocess.run([str(venv/'bin/pip'),'install','--no-cache-dir','setuptools','-r',str(root/'flaresolverr/requirements.txt')],check=True)
(root/'flaresolverr/ARGUS_PIN').write_text(SHA+'\n')
