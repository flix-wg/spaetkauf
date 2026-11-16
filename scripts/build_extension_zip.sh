#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm --prefix extension run build
mkdir -p frontend/dist
rm -f frontend/dist/kurt-extension.zip
if command -v zip >/dev/null; then
  (cd extension && zip -qr ../frontend/dist/kurt-extension.zip manifest.json icons src dist _locales)
else
  python3 - <<'PYTHON'
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
root = Path('extension')
with ZipFile('frontend/dist/kurt-extension.zip', 'w', ZIP_DEFLATED) as archive:
    for name in ('manifest.json', 'icons', 'src', 'dist', '_locales'):
        path = root / name
        for file in ([path] if path.is_file() else sorted(path.rglob('*'))):
            if file.is_file():
                archive.write(file, file.relative_to(root))
PYTHON
fi
