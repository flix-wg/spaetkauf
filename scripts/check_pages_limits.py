"""Fail when a static build breaks the Cloudflare Pages Free limits: 20,000 files, 25 MiB per file.

python3 -I scripts/check_pages_limits.py frontend/dist
"""

import sys
from pathlib import Path

MAX_FILES = 20_000
MAX_BYTES = 25 * 1024 * 1024

files = [p for p in Path(sys.argv[1]).rglob("*") if p.is_file()]
oversized = [f"{p} ({p.stat().st_size / 2**20:.1f} MiB)" for p in files if p.stat().st_size > MAX_BYTES]
total = sum(p.stat().st_size for p in files)
print(f"{len(files)} files, {total / 1e6:.1f} MB")
if oversized:
    sys.exit("Files over 25 MiB: " + ", ".join(oversized))
if len(files) > MAX_FILES:
    sys.exit(f"{len(files)} files, over the Pages limit of {MAX_FILES}")
