#!/usr/bin/env python3
"""
Captive Portal HTTP Redirector Server
=====================================
Server HTTP ringan multi-threaded pada port 80 yang menangani probe Captive Portal
(Android, iOS, Windows) dan permintaan HTTP umum untuk dialihkan ke akun Instagram.
"""

import sys
import json
import html as htmllib
import threading
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from typing import Optional
from ...utils.logger import logger

# Default aman bila redirect_url tidak valid.
DEFAULT_REDIRECT_URL = "https://www.instagram.com/"


def sanitize_redirect_url(url: str, fallback: str = DEFAULT_REDIRECT_URL) -> str:
    """
    KEAMANAN (P2): Hanya izinkan URL absolut http/https. Menolak skema berbahaya
    (`javascript:`, `data:`, dll.) dan input tak valid → kembalikan fallback aman.
    Mencegah open-redirect & XSS via href/Location.
    """
    try:
        parsed = urllib.parse.urlparse((url or "").strip())
        if parsed.scheme in ("http", "https") and parsed.netloc:
            return url.strip()
    except Exception:
        pass
    return fallback


def js_string_literal(value: str) -> str:
    """
    KEAMANAN (P2): Hasilkan literal string JS yang aman DI DALAM blok <script> HTML.
    `json.dumps` saja tidak cukup karena tidak meng-escape `<`/`>` — sehingga substring
    `</script>` (bisa muncul di path/query URL https yang valid) akan menutup tag script
    dan memungkinkan injeksi. Escape `<`, `>`, `&` ke bentuk \\uXXXX untuk mencegahnya.
    """
    return (
        json.dumps(value)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        ex_type, _, _ = sys.exc_info()
        if ex_type in (ConnectionResetError, BrokenPipeError, TimeoutError):
            return
        super().handle_error(request, client_address)

class PortalRequestHandler(BaseHTTPRequestHandler):
    # Properti class yang disuntikkan oleh CaptivePortalServer
    redirect_url = "https://www.instagram.com/"
    instagram_username = ""

    def log_message(self, format, *args):
        logger.info(f"🌐 [Portal HTTP] {self.address_string()} - {format % args}")

    def _render_landing_html(self, target_url: str, username: str) -> bytes:
        # KEAMANAN (P2): sanitasi skema + escape semua nilai dinamis sebelum masuk HTML/JS.
        safe_url = sanitize_redirect_url(target_url)
        display_user = f"@{username}" if username else "Instagram"
        deep_link = f"instagram://user?username={urllib.parse.quote(username)}" if username else safe_url

        # Konteks atribut/teks HTML → html.escape (quote=True).
        esc_url = htmllib.escape(safe_url, quote=True)
        esc_deep = htmllib.escape(deep_link, quote=True)
        esc_user = htmllib.escape(display_user, quote=True)
        # Konteks string JavaScript DI DALAM <script> → literal ber-escape (termasuk < > &).
        js_deep = js_string_literal(deep_link)
        js_url = js_string_literal(safe_url)

        html = f"""<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="1; url={esc_url}">
    <script>
        // Mencoba membuka aplikasi Instagram secara langsung via deep link
        try {{
            window.location.href = {js_deep};
        }} catch (e) {{}}
        // Fallback otomatis ke halaman web browser
        setTimeout(function() {{
            window.location.replace({js_url});
        }}, 600);
    </script>
    <title>NetCut Sentinel - Redirecting to {esc_user}</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            background-color: #090a0c;
            color: #f4f4f5;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 1.5rem;
            text-align: center;
        }}
        .card {{
            background: #121316;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 1.25rem;
            padding: 2rem;
            max-width: 420px;
            width: 100%;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        }}
        .badge {{
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.25rem 0.75rem;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 9999px;
            font-size: 0.75rem;
            font-family: monospace;
            color: #a1a1aa;
            margin-bottom: 1.25rem;
        }}
        h1 {{
            font-size: 1.25rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            letter-spacing: -0.02em;
        }}
        p {{
            font-size: 0.875rem;
            color: #a1a1aa;
            line-height: 1.5;
            margin-bottom: 1.5rem;
        }}
        .btn-group {{
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }}
        .btn {{
            display: block;
            width: 100%;
            padding: 0.75rem 1rem;
            border-radius: 0.75rem;
            font-size: 0.875rem;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.15s ease;
        }}
        .btn-primary {{
            background: linear-gradient(135deg, #e1306c, #833ab4);
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(225, 48, 108, 0.3);
        }}
        .btn-primary:hover {{
            opacity: 0.92;
            transform: translateY(-1px);
        }}
        .btn-secondary {{
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #e4e4e7;
        }}
        .btn-secondary:hover {{
            background: rgba(255, 255, 255, 0.1);
        }}
        .footer {{
            margin-top: 1.5rem;
            font-size: 0.75rem;
            font-family: monospace;
            color: #71717a;
        }}
    </style>
</head>
<body>
    <div class="card">
        <div class="badge">
            <span>🛡️ NETCUT SENTINEL</span>
        </div>
        <h1>Dialihkan ke Instagram</h1>
        <p>Akses internet pada perangkat Anda saat ini sedang dialihkan ke akun <strong>{esc_user}</strong>.</p>

        <div class="btn-group">
            <a href="{esc_deep}" class="btn btn-primary">Buka di Aplikasi Instagram</a>
            <a href="{esc_url}" class="btn btn-secondary">Buka Lewat Browser Web</a>
        </div>

        <div class="footer">
            Sentinel Shield Network Access Control
        </div>
    </div>
</body>
</html>"""
        return html.encode("utf-8")

    def do_HEAD(self):
        self.close_connection = True
        try:
            self.send_response(302)
            self.send_header("Location", sanitize_redirect_url(self.redirect_url))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Connection", "close")
            self.end_headers()
        except (ConnectionResetError, BrokenPipeError, TimeoutError):
            pass
        except Exception as e:
            logger.debug(f"Portal HEAD notice: {e}")

    def do_GET(self):
        self.close_connection = True
        # Deteksi Captive Portal probe
        probe_paths = (
            "/generate_204",
            "/gen_204",
            "/hotspot-detect.html",
            "/connecttest.txt",
            "/ncsi.txt",
            "/success.txt",
        )

        body = self._render_landing_html(self.redirect_url, self.instagram_username)

        try:
            self.send_response(302)
            self.send_header("Location", sanitize_redirect_url(self.redirect_url))
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionResetError, BrokenPipeError, TimeoutError):
            pass
        except Exception as e:
            logger.debug(f"Portal GET notice: {e}")

class CaptivePortalServer:
    def __init__(self, port: int = 80, redirect_url: str = DEFAULT_REDIRECT_URL, instagram_username: str = ""):
        self.port = port
        self.redirect_url = sanitize_redirect_url(redirect_url)
        self.instagram_username = instagram_username

        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._lock = threading.Lock()

    def update_target(self, redirect_url: str, instagram_username: str = ""):
        with self._lock:
            safe_url = sanitize_redirect_url(redirect_url)
            self.redirect_url = safe_url
            self.instagram_username = instagram_username
            PortalRequestHandler.redirect_url = safe_url
            PortalRequestHandler.instagram_username = instagram_username

    def start(self):
        with self._lock:
            if self._running:
                return

            PortalRequestHandler.redirect_url = self.redirect_url
            PortalRequestHandler.instagram_username = self.instagram_username

            try:
                self._server = ThreadingHTTPServer(("0.0.0.0", self.port), PortalRequestHandler)
                self._running = True
                self._thread = threading.Thread(target=self._server.serve_forever, daemon=True, name="CaptivePortal-HTTP")
                self._thread.start()
                logger.info(f"🚀 [Captive Portal] HTTP Redirect Server berjalan di port {self.port} -> {self.redirect_url}")
            except Exception as e:
                logger.error(f"Gagal menjalankan Captive Portal di port {self.port}: {e}")
                self._running = False
                raise

    def stop(self):
        with self._lock:
            if not self._running or not self._server:
                return
            try:
                self._server.shutdown()
                self._server.server_close()
            except Exception as e:
                logger.debug(f"Notice closing Portal HTTP server: {e}")
            finally:
                self._running = False
                self._server = None
                self._thread = None
                logger.info("🛑 [Captive Portal] HTTP Redirect Server dihentikan.")
