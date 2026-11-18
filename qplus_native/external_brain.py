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

# Dummy stub for backwards compatibility with old tests
class RealScaffoldAdapter:
    def __init__(self, *args, **kwargs):
        raise ExternalProviderDisabled("Sovereign Core: RealScaffoldAdapter is disabled.")

# Dummy stub for backwards compatibility with old tests
class RealScaffoldAdapter:
    def __init__(self, *args, **kwargs):
        raise ExternalProviderDisabled("Sovereign Core: RealScaffoldAdapter is disabled.")

# =====================================================================
# Compatibility Stubs for Legacy Tests
# These tests expect external functions, but we have purged them.
# =====================================================================

class RealScaffoldAdapter:
    def __init__(self, *args, **kwargs):
        raise ExternalProviderDisabled("Sovereign Core: External Scaffold is permanently disabled.")

def validate_brain_endpoint_url(url: str) -> bool:
    # In Sovereign Core, external endpoints are always invalid
    return False
