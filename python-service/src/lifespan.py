"""Lifespan Context Manager for NetCut Sentinel FastAPI Microservice."""

import asyncio
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI

from .container import EngineContainer, get_default_container
from .utils.logger import logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Modern Starlette/FastAPI Lifespan Manager.
    Menggantikan deprecated @app.on_event("startup") dan @app.on_event("shutdown").
    Menjamin startup atomik dan deterministic 8-stage teardown.
    """
    # =========================================================================
    # STARTUP PHASE
    # =========================================================================
    loop = asyncio.get_running_loop()
    stop_event = threading.Event()

    # Inisialisasi container atau gunakan default jika sudah ada
    container = get_default_container()
    container.loop = loop
    container.stop_event = stop_event
    container.connection_manager.set_loop(loop)

    # Simpan di app.state untuk dependency injection via Depends()
    app.state.container = container
    app.state.spoofer = container.spoofer
    app.state.scanner = container.scanner
    app.state.redirect_manager = container.redirect_manager
    app.state.transparent_gateway = container.transparent_gateway
    app.state.connection_manager = container.connection_manager
    app.state.telemetry_sampler = container.telemetry_sampler
    app.state.cert_engine = container.cert_engine
    app.state.flow_manager = container.flow_manager
    app.state.bettercap_dns = container.bettercap_dns
    app.state.bettercap_dissector = container.bettercap_dissector
    app.state.bettercap_syn_scanner = container.bettercap_syn_scanner
    app.state.shield_engine = container.shield_engine
    app.state.gaming_engine = container.gaming_engine
    app.state.liveness_daemon = container.liveness_daemon
    app.state.executor = container.executor

    # Wire callbacks
    container.shield_engine.set_event_callback(
        lambda evt: container.connection_manager.broadcast(evt)
    )
    container.gaming_engine.set_event_callback(
        lambda name, data: container.connection_manager.broadcast({"event": name, "data": data})
    )

    # Mulai Background Daemons
    container.liveness_daemon.start()
    container.scanner.start_dhcp_sniffer(callback=container.on_dhcp_detected)

    # Jalankan Watchdog Thread dengan stop_event
    watchdog_thread = threading.Thread(
        target=container.run_watchdog_loop,
        daemon=True,
        name="watchdog-thread"
    )
    watchdog_thread.start()

    logger.info("🚀 NetCut Sentinel Modular FastAPI Engine READY on http://127.0.0.1:8001")
    logger.info("📖 Governed by: docs/specs/SPEC-001, SPEC-002, SPEC-003, SPEC-005")
    logger.info("📖 Event Taxonomy: docs/EVENT_TAXONOMY.md | Runbook: docs/TROUBLESHOOTING.md")

    try:
        yield
    finally:
        # =========================================================================
        # SHUTDOWN PHASE (Deterministic Teardown)
        # =========================================================================
        logger.info("🛑 Shutting down FastAPI microservice, cleaning all ARP spoof sessions...")
        stop_event.set()
        container.teardown()
