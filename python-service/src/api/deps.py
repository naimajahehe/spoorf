"""Dependency injection providers and resolution helpers for NetCut Sentinel."""

import asyncio
import inspect
import sys
from functools import wraps
from typing import TYPE_CHECKING, Any, Optional

from fastapi import Request
from fastapi.params import Depends

if TYPE_CHECKING:
    RequestDep = Optional[Request]
else:
    RequestDep = Request


def auto_inject(func):
    """
    Decorator yang memungkinkan route handler FastAPI yang menggunakan
    `param: T = Depends(provider)` untuk dipanggil secara langsung di Python
    murni (misalnya dalam unit test) tanpa melempar AttributeError karena default
    Depends object.
    Mendukung fungsi synchronous (`def`) maupun asynchronous (`async def`).
    """
    sig = inspect.signature(func)

    if asyncio.iscoroutinefunction(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            bound = sig.bind_partial(*args, **kwargs)
            for param in sig.parameters.values():
                if param.name not in bound.arguments:
                    if isinstance(param.default, Depends):
                        dep_fn = param.default.dependency
                        if dep_fn is not None:
                            val = dep_fn()
                            if asyncio.iscoroutine(val):
                                val = await val
                            bound.arguments[param.name] = val
            return await func(*bound.args, **bound.kwargs)
        return async_wrapper
    else:
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            bound = sig.bind_partial(*args, **kwargs)
            for param in sig.parameters.values():
                if param.name not in bound.arguments:
                    if isinstance(param.default, Depends):
                        dep_fn = param.default.dependency
                        if dep_fn is not None:
                            bound.arguments[param.name] = dep_fn()
            return func(*bound.args, **bound.kwargs)
        return sync_wrapper


def get_server_attr(name: str, fallback: Any = None) -> Any:
    """
    Dinamis membaca atribut/mock dari modul `src.server` bila sedang di-patch oleh test runner.
    Mencegah jebakan Python namespace scoping di mana patch pada `src.server.<func>` diabaikan
    oleh modul router yang mengimpornya langsung.
    """
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, name):
        return getattr(srv, name)
    return fallback


def get_container(request: RequestDep = None):
    """Ambil EngineContainer dari app.state atau fallback ke container default."""
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "container"):
        container = request.app.state.container
        if container is not None:
            return container

    from ..container import get_default_container
    return get_default_container()


def get_spoofer(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "spoofer"):
        val = request.app.state.spoofer
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "spoofer"):
        return srv.spoofer
    return get_container(request).spoofer


def get_scanner(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "scanner"):
        val = request.app.state.scanner
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "scanner"):
        return srv.scanner
    return get_container(request).scanner


def get_redirect_manager(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "redirect_manager"):
        val = request.app.state.redirect_manager
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "redirect_manager"):
        return srv.redirect_manager
    return get_container(request).redirect_manager


def get_transparent_gateway(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "transparent_gateway"):
        val = request.app.state.transparent_gateway
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "transparent_gateway"):
        return srv.transparent_gateway
    return get_container(request).transparent_gateway


def get_connection_manager(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "connection_manager"):
        val = request.app.state.connection_manager
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "manager"):
        return srv.manager
    return get_container(request).connection_manager


def get_telemetry_sampler(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "telemetry_sampler"):
        val = request.app.state.telemetry_sampler
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "telemetry_sampler"):
        return srv.telemetry_sampler
    return get_container(request).telemetry_sampler


def get_cert_engine(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "cert_engine"):
        val = request.app.state.cert_engine
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "cert_engine"):
        return srv.cert_engine
    return get_container(request).cert_engine


def get_flow_manager(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "flow_manager"):
        val = request.app.state.flow_manager
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "flow_manager"):
        return srv.flow_manager
    return get_container(request).flow_manager


def get_bettercap_dns(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "bettercap_dns"):
        val = request.app.state.bettercap_dns
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "bettercap_dns"):
        return srv.bettercap_dns
    return get_container(request).bettercap_dns


def get_bettercap_dissector(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "bettercap_dissector"):
        val = request.app.state.bettercap_dissector
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "bettercap_dissector"):
        return srv.bettercap_dissector
    return get_container(request).bettercap_dissector


def get_bettercap_syn_scanner(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "bettercap_syn_scanner"):
        val = request.app.state.bettercap_syn_scanner
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "bettercap_syn_scanner"):
        return srv.bettercap_syn_scanner
    return get_container(request).bettercap_syn_scanner


def get_shield_engine(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "shield_engine"):
        val = request.app.state.shield_engine
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "shield_engine"):
        return srv.shield_engine
    return get_container(request).shield_engine


def get_gaming_engine(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "gaming_engine"):
        val = request.app.state.gaming_engine
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "gaming_engine"):
        return srv.gaming_engine
    return get_container(request).gaming_engine


def get_liveness_daemon(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "liveness_daemon"):
        val = request.app.state.liveness_daemon
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "liveness_daemon"):
        return srv.liveness_daemon
    return get_container(request).liveness_daemon


def get_executor(request: RequestDep = None):
    if request is not None and hasattr(request, "app") and hasattr(request.app.state, "executor"):
        val = request.app.state.executor
        if val is not None:
            return val
    srv = sys.modules.get("src.server")
    if srv is not None and hasattr(srv, "executor"):
        return srv.executor
    return get_container(request).executor
