"""
Unit Tests for NetworkTelemetrySampler counter-source consistency (Phase 6).
"""

import unittest
from unittest.mock import patch


class _Ctr:
    def __init__(self, recv, sent):
        self.bytes_recv = recv
        self.bytes_sent = sent


def _make_net_io(wifi=None, agg=(1000, 500)):
    """Bangun stub psutil.net_io_counters yang menangani pernic=True dan agregat."""
    def _fn(pernic=False):
        if pernic:
            return {'Wi-Fi': _Ctr(*wifi)} if wifi else {'Ethernet': _Ctr(0, 0)}
        return _Ctr(*agg)
    return _fn


class TestTelemetryCounters(unittest.TestCase):

    def test_get_nic_counters_prefers_wifi(self):
        """_get_nic_counters memilih adapter 'Wi-Fi' bila tersedia."""
        from src.core.telemetry import NetworkTelemetrySampler
        with patch('src.core.telemetry.psutil.net_io_counters', _make_net_io(wifi=(2000, 800), agg=(9, 9))):
            ctr = NetworkTelemetrySampler._get_nic_counters()
        self.assertEqual(ctr.bytes_recv, 2000)
        self.assertEqual(ctr.bytes_sent, 800)

    def test_get_nic_counters_falls_back_to_aggregate(self):
        """_get_nic_counters memakai agregat bila 'Wi-Fi' tidak ada."""
        from src.core.telemetry import NetworkTelemetrySampler
        with patch('src.core.telemetry.psutil.net_io_counters', _make_net_io(wifi=None, agg=(1234, 777))):
            ctr = NetworkTelemetrySampler._get_nic_counters()
        self.assertEqual(ctr.bytes_recv, 1234)
        self.assertEqual(ctr.bytes_sent, 777)

    def test_init_seeds_from_same_source_as_sample(self):
        """Seed init_counters berasal dari sumber yang sama (Wi-Fi), bukan agregat berbeda,
        sehingga delta sampel pertama tidak keliru (negatif ter-clamp 0)."""
        from src.core.telemetry import NetworkTelemetrySampler
        # Wi-Fi jauh lebih kecil dari agregat: bila seed dari agregat & sample dari Wi-Fi,
        # delta pertama akan negatif. Dengan sumber konsisten, seed == nilai Wi-Fi.
        with patch('src.core.telemetry.psutil.net_io_counters', _make_net_io(wifi=(1_000_000, 500_000), agg=(9_000_000, 8_000_000))):
            sampler = NetworkTelemetrySampler()  # __init__ memanggil init_counters()
        self.assertEqual(sampler.last_bytes_recv, 1_000_000)
        self.assertEqual(sampler.last_bytes_sent, 500_000)


if __name__ == '__main__':
    unittest.main()
