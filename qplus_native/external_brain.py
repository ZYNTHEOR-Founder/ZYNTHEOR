# -*- coding: utf-8 -*-
"""
ZYNTHEOR Sovereign Core: External Brain Interface (PURGED)
All external AI providers (external providers) have been permanently disabled.
"""
from typing import Any, Callable

class ExternalProviderDisabled(Exception):
    pass

def make_http_complete(provider: str, model: str, *args, **kwargs) -> Callable:
    raise ExternalProviderDisabled(
        f"Sovereign Core Protocol: External provider '{provider}' is disabled. "
        "ZYNTHEOR must use its native deterministic core."
    )

def get_external_brain(provider: str, *args, **kwargs) -> Any:
    raise ExternalProviderDisabled(
        f"Sovereign Core Protocol: External provider '{provider}' is disabled."
    )
