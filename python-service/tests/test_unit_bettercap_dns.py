"""
Unit test: BettercapDNSEngine — fitur port dari bettercap dns.spoof
(hosts-file, spoof-all, TTL, pencocokan subdomain & wildcard).
"""
import os
import tempfile
import unittest

from src.core.bettercap.dns_spoofer import BettercapDNSEngine


class TestBettercapDNSEngine(unittest.TestCase):
    def setUp(self):
        self.engine = BettercapDNSEngine()

    # ---- Pencocokan wildcard/exact (regresi) ----
    def test_wildcard_and_exact_match(self):
        self.engine.add_rule("*.example.com", "1.1.1.1")
        self.assertIsNotNone(self.engine.match_domain("www.example.com"))
        self.assertIsNotNone(self.engine.match_domain("example.com"))
        # Rule manual non-wildcard = exact saja (perilaku lama tak berubah)
        r = self.engine.add_rule("only.test", "2.2.2.2")
        self.assertEqual(self.engine.match_domain("only.test").id, r.id)
        self.assertIsNone(self.engine.match_domain("sub.only.test"))

    # ---- hosts-file: konten inline ----
    def test_load_hosts_content(self):
        content = """
        # komentar diabaikan
        1.2.3.4 example.com

        foo.local
        """
        loaded = self.engine.load_hosts_content(content, default_address="9.9.9.9")
        self.assertEqual(loaded, 2)
        # 'IP domain' -> address IP, dan cocok subdomain (perilaku bettercap)
        m1 = self.engine.match_domain("www.example.com")
        self.assertIsNotNone(m1)
        self.assertEqual(m1.target_ip, "1.2.3.4")
        self.assertIsNotNone(self.engine.match_domain("example.com"))
        # token tunggal -> default_address
        m2 = self.engine.match_domain("foo.local")
        self.assertIsNotNone(m2)
        self.assertEqual(m2.target_ip, "9.9.9.9")

    # ---- hosts-file: dari file ----
    def test_load_hosts_file(self):
        with tempfile.NamedTemporaryFile("w", suffix=".hosts", delete=False, encoding="utf-8") as f:
            f.write("10.0.0.5 corp.internal\n# c\n\nbare.domain\n")
            path = f.name
        try:
            loaded = self.engine.load_hosts_file(path, default_address="8.8.8.8")
            self.assertEqual(loaded, 2)
            self.assertEqual(self.engine.match_domain("api.corp.internal").target_ip, "10.0.0.5")
            self.assertEqual(self.engine.match_domain("bare.domain").target_ip, "8.8.8.8")
        finally:
            os.unlink(path)

    def test_load_hosts_file_missing(self):
        self.assertEqual(self.engine.load_hosts_file("D:/tidak/ada.hosts"), 0)

    # ---- mode blokir (action='sinkhole') ----
    def test_load_blocklist_sinkhole(self):
        loaded = self.engine.load_hosts_content("tiktok.com\nfacebook.com", action="sinkhole")
        self.assertEqual(loaded, 2)
        # domain tanpa IP tetap termuat (sinkhole tak butuh IP) & jadi aksi sinkhole
        m = self.engine.match_domain("www.tiktok.com")
        self.assertIsNotNone(m)
        self.assertEqual(m.action, "sinkhole")

    # ---- spoof-all (catch-all) ----
    def test_spoof_all_fallback(self):
        # Default OFF -> domain tak dikenal tak cocok
        self.assertIsNone(self.engine.match_domain("random-unknown-xyz.net"))
        self.assertIsNone(self.engine._make_spoof_all_rule("192.168.0.1"))
        # ON -> rule sintetis mengarahkan ke address
        self.engine.set_spoof_all(True, "192.168.0.99")
        r = self.engine._make_spoof_all_rule("192.168.0.1")
        self.assertIsNotNone(r)
        self.assertEqual(r.target_ip, "192.168.0.99")
        # OFF lagi
        self.engine.set_spoof_all(False)
        self.assertIsNone(self.engine._make_spoof_all_rule("192.168.0.1"))
        # Engine BARU (belum pernah set address) -> fallback ke default_redirect_ip
        fresh = BettercapDNSEngine()
        fresh.set_spoof_all(True)  # tanpa address
        self.assertEqual(fresh._make_spoof_all_rule("192.168.0.1").target_ip, "192.168.0.1")

    # ---- TTL ----
    def test_default_ttl_clamp(self):
        self.assertEqual(self.engine.default_ttl, 10)
        self.assertEqual(self.engine.set_default_ttl(120), 120)
        self.assertEqual(self.engine.set_default_ttl(0), 1)          # clamp bawah
        self.assertEqual(self.engine.set_default_ttl(999999), 86400)  # clamp atas


if __name__ == "__main__":
    unittest.main()
