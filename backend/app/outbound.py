"""Logs every outbound call by host, so the server logs show which services the app talks to."""

import logging
import sys
from urllib.parse import urlsplit


class HostOnly(logging.Filter):
    """Keeps the host only: paths and queries can carry trip ids and push tokens."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args if isinstance(record.args, tuple) else ()
        if record.name == "httpx" and len(args) >= 2:
            record.msg, record.args = "outbound %s %s", (args[0], urlsplit(str(args[1])).hostname)
            return True
        if str(record.msg).startswith("Starting new HTTP") and len(args) >= 2:  # urllib3, used by webpush
            record.msg, record.args = "outbound %s", (args[1],)
            return True
        return False


_ready = False


def log_outbound() -> None:
    global _ready
    if _ready:
        return
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    handler.addFilter(HostOnly())
    for name, level in (("httpx", logging.INFO), ("urllib3.connectionpool", logging.DEBUG)):
        log = logging.getLogger(name)
        log.setLevel(level)
        log.addHandler(handler)
        log.propagate = False
    _ready = True
