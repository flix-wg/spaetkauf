import logging

from app.outbound import HostOnly


def test_outbound_log_keeps_host_only():
    def record(name, msg, args):
        return logging.LogRecord(name, logging.INFO, __file__, 1, msg, args, None)

    r = record("httpx", "HTTP Request: %s %s", ("GET", "https://api.transitous.org/api/v1/plan?fromPlace=x"))
    assert HostOnly().filter(r) and r.getMessage() == "outbound GET api.transitous.org"
    r = record("urllib3.connectionpool", "Starting new HTTPS connection (%d): %s:%s", (1, "fcm.googleapis.com", 443))
    assert HostOnly().filter(r) and r.getMessage() == "outbound fcm.googleapis.com"
    assert not HostOnly().filter(record("urllib3.connectionpool", "%s %s", ("POST", "/fcm/send/secret-token")))
