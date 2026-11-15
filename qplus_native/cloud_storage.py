# -*- coding: utf-8 -*-
"""
ZYNTHEOR Cloud Object Storage Checkpoint Loader (Python Bridge)
Streams `.pt` model checkpoints directly into memory (`io.BytesIO`) from S3 / R2 /
Cloud Storage (via `boto3` when installed or presigned HTTPS/HTTP URL) without
any local disk weight fallbacks. Fails closed if connectivity is unavailable.
"""

import hashlib
import io
import ipaddress
import json
import os
import socket
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional, Tuple

MAGIC = b"ZYNTHEOR_QPLUS_PT"

_BLOCKED_METADATA_HOSTS = {
    "169.254.169.254",
    "169.254.170.2",
    "metadata.google.internal",
    "metadata.goog",
    "metadata",
    "fd00:ec2::254",
    "0.0.0.0",
}


def validate_cloud_url(url: str) -> Tuple[bool, Optional[str]]:
    """
    Validates an external cloud checkpoint URL against SSRF vectors:
    - Enforces http/https scheme
    - Rejects embedded userinfo credentials
    - Blocks cloud instance metadata endpoints (169.254.x.x, metadata.google.internal, fd00:ec2::254)
    - Blocks unspecified (0.0.0.0), multicast, and private RFC1918 LAN targets
    - Permits loopback (127.0.0.1 / ::1 / localhost) only for local dev/test harnesses unless disabled
    """
    if not url or not isinstance(url, str):
        return False, "FAIL_CLOSED: Empty or invalid cloud URL"
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        return False, f"FAIL_CLOSED: Unsupported cloud URL scheme '{parsed.scheme}'"
    if parsed.username or parsed.password:
        return False, "FAIL_CLOSED: Cloud URL must not embed credentials"
    host = (parsed.hostname or "").strip().lower()
    if not host:
        return False, "FAIL_CLOSED: Cloud URL missing hostname"
    if host in _BLOCKED_METADATA_HOSTS or host.endswith(".internal"):
        return False, f"FAIL_CLOSED: SSRF_BLOCKED — forbidden metadata/internal host '{host}'"

    allow_loopback = os.environ.get("ZYNTHEOR_ALLOW_LOOPBACK_CLOUD", "true").lower() != "false"

    def _check_ip(ip_obj: ipaddress._BaseAddress) -> Optional[str]:
        if ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_unspecified:
            return f"FAIL_CLOSED: SSRF_BLOCKED — forbidden link-local/unspecified IP '{ip_obj}'"
        if ip_obj.is_loopback:
            if not allow_loopback:
                return f"FAIL_CLOSED: SSRF_BLOCKED — loopback host '{ip_obj}' is disabled"
            return None
        if ip_obj.is_private or ip_obj.is_reserved:
            return f"FAIL_CLOSED: SSRF_BLOCKED — private/reserved IP '{ip_obj}' is blocked"
        return None

    try:
        ip_obj = ipaddress.ip_address(host)
        err = _check_ip(ip_obj)
        if err:
            return False, err
        return True, None
    except ValueError:
        pass

    if host == "localhost":
        if not allow_loopback:
            return False, "FAIL_CLOSED: SSRF_BLOCKED — localhost is disabled"
        return True, None

    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
        for info in infos:
            addr_str = info[4][0].split("%")[0]
            try:
                resolved_ip = ipaddress.ip_address(addr_str)
                err = _check_ip(resolved_ip)
                if err:
                    return False, err
            except ValueError:
                continue
    except socket.gaierror:
        # DNS resolution failures are handled cleanly during network probe as UNREACHABLE
        pass

    return True, None


class _SSRFRedirectBlocker(urllib.request.HTTPRedirectHandler):
    """Validates every HTTP 3xx redirect target against SSRF rules before following."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        hops = getattr(req, "_zyntheor_redirect_hops", 0)
        if hops >= 2:
            raise urllib.error.URLError("FAIL_CLOSED: SSRF_BLOCKED — too many HTTP redirects")

        abs_url = urllib.parse.urljoin(req.full_url, newurl)
        ok, err = validate_cloud_url(abs_url)
        if not ok:
            raise urllib.error.URLError(err or f"FAIL_CLOSED: SSRF_BLOCKED redirect to '{abs_url}'")

        orig_host = (urllib.parse.urlparse(req.full_url).hostname or "").strip().lower()
        new_host = (urllib.parse.urlparse(abs_url).hostname or "").strip().lower()
        orig_loopback = orig_host in ("localhost", "127.0.0.1", "::1")
        new_loopback = new_host in ("localhost", "127.0.0.1", "::1")
        if not orig_loopback and new_loopback:
            raise urllib.error.URLError(
                f"FAIL_CLOSED: SSRF_BLOCKED — external endpoint cannot redirect to loopback '{new_host}'"
            )

        next_req = super().redirect_request(req, fp, code, msg, headers, abs_url)
        if next_req is not None:
            setattr(next_req, "_zyntheor_redirect_hops", hops + 1)
        return next_req


_SAFE_URL_OPENER = urllib.request.build_opener(_SSRFRedirectBlocker())


def get_cloud_source_description(
    object_key: Optional[str] = None,
    presigned_url: Optional[str] = None,
) -> Optional[str]:
    url = presigned_url or os.environ.get("CHECKPOINT_PRESIGNED_URL")
    if url:
        return url
    bucket = os.environ.get("S3_BUCKET")
    if bucket:
        key = object_key or os.environ.get("S3_CHECKPOINT_KEY") or "checkpoints/model_checkpoint.pt"
        return f"s3://{bucket}/{key}"
    runtime_url = os.environ.get("CLOUD_RUNTIME_URL")
    if runtime_url:
        return runtime_url
    return None


def check_cloud_connectivity(
    timeout_s: float = 3.0,
    presigned_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Probes actual network reachability of the configured Cloud Object Storage / Cloud Runtime.
    Fails closed (`online: False`, `code: 'FAIL_CLOSED'`) when unconfigured or unreachable.
    """
    url = presigned_url or os.environ.get("CHECKPOINT_PRESIGNED_URL") or os.environ.get("ZYNTHEOR_CONNECTIVITY_PROBE_URL") or os.environ.get("CLOUD_RUNTIME_URL")
    bucket = os.environ.get("S3_BUCKET")
    key = os.environ.get("S3_CHECKPOINT_KEY") or "checkpoints/model_checkpoint.pt"
    t0 = time.perf_counter()

    if url:
        url_ok, url_err = validate_cloud_url(url)
        if not url_ok:
            return {
                "online": False,
                "status": "ONLINE_CONNECTIVITY_REQUIRED",
                "code": "FAIL_CLOSED",
                "error_code": "SSRF_BLOCKED" if "SSRF_BLOCKED" in (url_err or "") else "INVALID_URL",
                "runtime_state_hint": "FAILED",
                "reason": f"{url_err} (Online Connectivity Required)",
                "source_uri": url,
                "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
            }
        # Probe with HEAD first, then fallback to Range GET if endpoint disallows HEAD (405)
        for method, extra_headers in (("HEAD", {}), ("GET", {"Range": "bytes=0-31"})):
            try:
                req = urllib.request.Request(
                    url,
                    method=method,
                    headers={"User-Agent": "ZYNTHEOR-ConnectivityMonitor/1.0", **extra_headers},
                )
                with _SAFE_URL_OPENER.open(req, timeout=timeout_s) as resp:
                    status_code = getattr(resp, "status", 200) or 200
                    if 200 <= status_code < 400:
                        return {
                            "online": True,
                            "status": "ONLINE",
                            "code": None,
                            "error_code": None,
                            "runtime_state_hint": "READY",
                            "reason": "Cloud checkpoint / runtime endpoint reachable over network",
                            "source_uri": url,
                            "http_status": status_code,
                            "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                        }
            except urllib.error.HTTPError as http_err:
                if http_err.code == 405 and method == "HEAD":
                    continue
                is_not_found = http_err.code == 404
                return {
                    "online": False,
                    "status": "ONLINE_CONNECTIVITY_REQUIRED",
                    "code": "FAIL_CLOSED",
                    "error_code": "NOT_FOUND" if is_not_found else "HTTP_ERROR",
                    "runtime_state_hint": "NOT_FOUND" if is_not_found else "FAILED",
                    "reason": f"FAIL_CLOSED: Online Connectivity Required — cloud endpoint returned HTTP {http_err.code}",
                    "source_uri": url,
                    "http_status": http_err.code,
                    "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                }
            except Exception as exc:
                err_msg = str(exc)
                is_ssrf = "SSRF_BLOCKED" in err_msg
                return {
                    "online": False,
                    "status": "ONLINE_CONNECTIVITY_REQUIRED",
                    "code": "FAIL_CLOSED",
                    "error_code": "SSRF_BLOCKED" if is_ssrf else "UNREACHABLE",
                    "runtime_state_hint": "FAILED",
                    "reason": err_msg if is_ssrf else f"FAIL_CLOSED: Online Connectivity Required — cloud endpoint unreachable ({exc})",
                    "source_uri": url,
                    "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                }

    if bucket:
        source_uri = f"s3://{bucket}/{key}"
        try:
            import boto3  # type: ignore

            endpoint_url = os.environ.get("S3_ENDPOINT") or None
            if endpoint_url:
                ep_ok, ep_err = validate_cloud_url(endpoint_url)
                if not ep_ok:
                    return {
                        "online": False,
                        "status": "ONLINE_CONNECTIVITY_REQUIRED",
                        "code": "FAIL_CLOSED",
                        "error_code": "SSRF_BLOCKED",
                        "runtime_state_hint": "FAILED",
                        "reason": ep_err,
                        "source_uri": source_uri,
                        "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                    }
            region = os.environ.get("S3_REGION") or "auto"
            client = boto3.client(
                "s3",
                endpoint_url=endpoint_url,
                region_name=region,
                aws_access_key_id=os.environ.get("S3_ACCESS_KEY_ID"),
                aws_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY"),
            )
            head = client.head_object(Bucket=bucket, Key=key)
            return {
                "online": True,
                "status": "ONLINE",
                "code": None,
                "error_code": None,
                "runtime_state_hint": "READY",
                "reason": "S3/R2 Cloud Object Storage reachable",
                "source_uri": source_uri,
                "content_length": head.get("ContentLength", 0),
                "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
            }
        except Exception as exc:
            err_str = str(exc)
            is_missing = "404" in err_str or "NoSuchKey" in err_str or "Not Found" in err_str
            return {
                "online": False,
                "status": "ONLINE_CONNECTIVITY_REQUIRED",
                "code": "FAIL_CLOSED",
                "error_code": "NOT_FOUND" if is_missing else "UNREACHABLE",
                "runtime_state_hint": "NOT_FOUND" if is_missing else "FAILED",
                "reason": f"FAIL_CLOSED: Online Connectivity Required — S3/R2 unreachable ({exc})",
                "source_uri": source_uri,
                "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
            }

    return {
        "online": False,
        "status": "ONLINE_CONNECTIVITY_REQUIRED",
        "code": "FAIL_CLOSED",
        "error_code": "NOT_CONFIGURED",
        "runtime_state_hint": "NOT_CONFIGURED",
        "reason": "FAIL_CLOSED: Online Connectivity Required — no Cloud Object Storage (CHECKPOINT_PRESIGNED_URL / S3_BUCKET) or CLOUD_RUNTIME_URL configured.",
        "source_uri": None,
        "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
    }


def _fetch_bytes_via_s3(bucket: str, key: str) -> bytes:
    try:
        import boto3  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "FAIL_CLOSED: Online Connectivity Required — boto3 is not installed. Provide CHECKPOINT_PRESIGNED_URL or install boto3."
        ) from exc

    endpoint_url = os.environ.get("S3_ENDPOINT") or None
    if endpoint_url:
        ep_ok, ep_err = validate_cloud_url(endpoint_url)
        if not ep_ok:
            raise ValueError(ep_err or "FAIL_CLOSED: SSRF_BLOCKED")
    region = os.environ.get("S3_REGION") or "auto"
    client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        region_name=region,
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY"),
    )
    buf = io.BytesIO()
    client.download_fileobj(bucket, key, buf)
    return buf.getvalue()


def _fetch_bytes_via_https(url: str, timeout_s: float = 30.0) -> bytes:
    url_ok, url_err = validate_cloud_url(url)
    if not url_ok:
        raise ValueError(f"{url_err} — Online Connectivity Required")
    req = urllib.request.Request(url, headers={"User-Agent": "ZYNTHEOR-Cloud-Runtime/1.0"})
    try:
        with _SAFE_URL_OPENER.open(req, timeout=timeout_s) as resp:
            return resp.read()
    except urllib.error.HTTPError as http_err:
        if http_err.code == 404:
            raise RuntimeError(
                f"FAIL_CLOSED: CHECKPOINT_NOT_FOUND — Online Connectivity Required (HTTP 404 from {url})"
            ) from http_err
        raise RuntimeError(
            f"FAIL_CLOSED: Online Connectivity Required — failed downloading cloud checkpoint from {url}: HTTP {http_err.code}"
        ) from http_err
    except Exception as exc:
        raise RuntimeError(
            f"FAIL_CLOSED: Online Connectivity Required — failed downloading cloud checkpoint from {url}: {exc}"
        ) from exc


def parse_checkpoint_container(raw: bytes) -> Tuple[Dict[str, Any], bytes, str]:
    if len(raw) < len(MAGIC) + 4 or raw[: len(MAGIC)] != MAGIC:
        raise RuntimeError("FAIL_CLOSED: CORRUPTED_CHECKPOINT — Invalid magic header from cloud storage.")

    meta_len = struct.unpack_from(">I", raw, len(MAGIC))[0]
    meta_start = len(MAGIC) + 4
    meta_end = meta_start + meta_len
    if meta_end > len(raw):
        raise RuntimeError("FAIL_CLOSED: CORRUPTED_CHECKPOINT — Metadata header truncated.")

    meta = json.loads(raw[meta_start:meta_end].decode("utf-8"))
    payload = raw[meta_end:]
    if len(payload) % 4 != 0:
        raise RuntimeError("FAIL_CLOSED: CORRUPTED_CHECKPOINT — Float32 payload length is misaligned.")

    sha256 = hashlib.sha256(payload).hexdigest()
    expected_sha = meta.get("sha256") or meta.get("payload_sha256")
    if expected_sha and expected_sha != sha256:
        raise RuntimeError(
            f"FAIL_CLOSED: CORRUPTED_CHECKPOINT — SHA-256 mismatch ({sha256} != {expected_sha})."
        )

    return meta, payload, sha256


def load_checkpoint_container_from_cloud(
    object_key: Optional[str] = None,
    presigned_url: Optional[str] = None,
    timeout_s: float = 30.0,
) -> Tuple[Dict[str, Any], bytes, str, bytes, str]:
    """
    Downloads and validates a ZYNTHEOR `.pt` checkpoint directly from Cloud Object Storage
    into memory. Strictly online-only: zero local file fallbacks.
    Returns (metadata, payload_bytes, payload_sha256, raw_container_bytes, source_uri).
    """
    url = presigned_url or os.environ.get("CHECKPOINT_PRESIGNED_URL")
    if url:
        source_uri = url
        raw = _fetch_bytes_via_https(url, timeout_s=timeout_s)
    else:
        bucket = os.environ.get("S3_BUCKET")
        key = object_key or os.environ.get("S3_CHECKPOINT_KEY") or "checkpoints/model_checkpoint.pt"
        if not bucket:
            raise RuntimeError(
                "FAIL_CLOSED: Online Connectivity Required — neither CHECKPOINT_PRESIGNED_URL nor S3_BUCKET is configured."
            )
        source_uri = f"s3://{bucket}/{key}"
        try:
            raw = _fetch_bytes_via_s3(bucket, key)
        except Exception as exc:
            raise RuntimeError(
                f"FAIL_CLOSED: Online Connectivity Required — failed fetching {source_uri}: {exc}"
            ) from exc

    meta, payload, sha256 = parse_checkpoint_container(raw)
    return meta, payload, sha256, raw, source_uri


def load_checkpoint_bytes_from_cloud(
    object_key: Optional[str] = None,
    presigned_url: Optional[str] = None,
) -> Tuple[Dict[str, Any], bytes, str]:
    """Compatibility wrapper returning (metadata, payload_bytes, payload_sha256)."""
    meta, payload, sha256, _, _ = load_checkpoint_container_from_cloud(
        object_key=object_key, presigned_url=presigned_url
    )
    return meta, payload, sha256


def upload_checkpoint_bytes_to_cloud(
    raw: bytes,
    object_key: Optional[str] = None,
    presigned_put_url: Optional[str] = None,
    timeout_s: float = 30.0,
) -> Dict[str, Any]:
    """Uploads an in-memory `.pt` checkpoint container directly to Cloud Object Storage."""
    meta, _, sha256 = parse_checkpoint_container(raw)
    put_url = presigned_put_url or os.environ.get("CHECKPOINT_UPLOAD_URL")
    if put_url:
        if not put_url.startswith("https://") and not put_url.startswith("http://"):
            raise ValueError(f"FAIL_CLOSED: Unsupported upload URL scheme: {put_url}")
        req = urllib.request.Request(
            put_url,
            data=raw,
            method="PUT",
            headers={
                "User-Agent": "ZYNTHEOR-Cloud-Runtime/1.0",
                "Content-Type": "application/octet-stream",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                return {
                    "source_uri": put_url,
                    "http_status": getattr(resp, "status", 200),
                    "sha256": sha256,
                    "byte_size": len(raw),
                    "total_params": meta.get("total_params"),
                }
        except Exception as exc:
            raise RuntimeError(
                f"FAIL_CLOSED: Online Connectivity Required — cloud upload failed ({exc})"
            ) from exc

    bucket = os.environ.get("S3_BUCKET")
    key = object_key or os.environ.get("S3_CHECKPOINT_KEY") or "checkpoints/model_checkpoint.pt"
    if not bucket:
        raise RuntimeError(
            "FAIL_CLOSED: Online Connectivity Required — neither CHECKPOINT_UPLOAD_URL nor S3_BUCKET is configured for cloud upload."
        )
    try:
        import boto3  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "FAIL_CLOSED: Online Connectivity Required — boto3 is not installed for S3 upload."
        ) from exc

    endpoint_url = os.environ.get("S3_ENDPOINT") or None
    region = os.environ.get("S3_REGION") or "auto"
    client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        region_name=region,
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY"),
    )
    client.upload_fileobj(io.BytesIO(raw), bucket, key)
    return {
        "source_uri": f"s3://{bucket}/{key}",
        "sha256": sha256,
        "byte_size": len(raw),
        "total_params": meta.get("total_params"),
    }
