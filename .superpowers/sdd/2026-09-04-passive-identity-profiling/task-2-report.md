# Task 2 Report: Explainable Evidence-Fusion Classifier

## Status

Complete. Commit: `c3679e5` (`feat(profile): add explainable evidence fusion`).

## Implementation

- Added immutable `ProfileEvidence` records and exported evidence/status types.
- Added reviewed vendor canonicalization, component-only vendor handling, and centralized device-category rules.
- Added independent-group candidate scoring for vendor, device type, and hostname.
- Added conservative conflict handling, local-admin MAC suppression, broad-vendor disambiguation, and generic HTTP/HTTPS exclusion.
- Added `assess_device_profile()` and `synthesize_profile_assessment()`.
- Preserved the exact parameters and tuple return contract of `synthesize_ensemble_profile()`.
- Added structured profile fields to normal and controller scanner records without renaming existing keys.
- Added a 41-case synthetic benchmark with a true development/holdout split and explicit provenance labels.

## TDD Evidence

### RED 1: classifier API absent

Command:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest tests.test_unit_fingerprint.TestCoreFingerprint -v
```

Observed result:

```text
ImportError: cannot import name 'assess_device_profile' from 'src.core.fingerprint'
Ran 1 test in 0.017s
FAILED (errors=1)
```

This failed for the expected reason: the new classifier API and structured evidence did not exist.

### RED 2: one hostname was incorrectly promoted to high confidence

Command:

```powershell
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest tests.test_unit_fingerprint.TestCoreFingerprint.test_profile_assessment_does_not_promote_single_mdns_hostname_to_high -v
```

Observed result:

```text
AssertionError: 'high' == 'high'
Ran 1 test in 0.001s
FAILED (failures=1)
```

Root cause: an mDNS hostname without manufacturer/model data incorrectly received the 60-point manufacturer/model contribution. The fix limits that contribution to actual manufacturer/model fields; hostname pattern evidence remains separate and cannot create unsupported high confidence.

### RED 3: explicit unknown manufacturer was discarded

Command:

```powershell
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest tests.test_unit_fingerprint.TestCoreFingerprint.test_vendor_canonicalization_preserves_unmapped_explicit_manufacturer -v
```

Observed result:

```text
AssertionError: 'Unknown' != 'Example Networks Incorporated'
Ran 1 test in 0.001s
FAILED (failures=1)
```

Root cause: canonicalization treated the allowlist as a denylist. The fix preserves explicit unrecognized manufacturer names while only extracting vendors from free-form hostname/model text through reviewed aliases and patterns.

### GREEN: focused classifier and benchmark

Command:

```powershell
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_unit_fingerprint `
  tests.test_profile_benchmark -v
```

Result:

```text
Ran 35 tests in 0.298s
OK
development: precision=1.000 coverage=0.952 unknown=0.048 (1/21)
holdout: precision=1.000 coverage=0.889 unknown=0.111 (2/18)
```

## Benchmark

- Cases: 41
- Provenance: 41 synthetic fixtures; 0 authorized test-device captures
- Excluded from coverage: 1 gateway and 1 controller fixture
- Eligible denominator: 39, including all three ambiguous/unknown fixtures
- Development:
  - precision: `1.000` (`20/20` emitted high profiles correct)
  - coverage: `0.952` (`20/21`)
  - unknown rate: `0.048` (`1/21`)
- Holdout:
  - precision: `1.000` (`16/16` emitted high profiles correct)
  - coverage: `0.889` (`16/18`)
  - unknown rate: `0.111` (`2/18`)
- Aggregate:
  - precision: `1.000` (`36/36`)
  - coverage: `0.923` (`36/39`)
  - unknown rate: `0.077` (`3/39`)

Unknown cases remained in the eligible denominator. The fixture metadata and every row identify whether ground truth is synthetic or from an authorized test device.

## Additional Test Results

- Scanner/discovery integration:

  ```text
  Ran 31 tests in 2.077s
  OK
  ```

- IPv6/scanner integration:

  ```text
  Ran 9 tests in 0.826s
  OK
  ```

- Full Python suite:

  ```text
  Ran 251 tests in 10.187s
  OK
  ```

- Full Node suite:

  ```text
  TEST RESULTS: 34 PASSED | 0 FAILED | 0.31s
  ```

- `git diff --cached --check`: passed.

## Files

- `python-service/src/core/fingerprint/evidence.py`
- `python-service/src/core/fingerprint/profile_rules.py`
- `python-service/src/core/fingerprint/ensemble.py`
- `python-service/src/core/fingerprint/__init__.py`
- `python-service/src/core/scanner.py`
- `python-service/tests/test_unit_fingerprint.py`
- `python-service/tests/test_profile_benchmark.py`
- `python-service/tests/fixtures/profile_benchmark.json`

## Self-Review

- Confirmed each candidate receives at most one contribution per evidence group.
- Confirmed high confidence requires the specified score thresholds plus multiple groups or explicit identity.
- Confirmed locally administered MACs never use OUI identity.
- Confirmed Intel, Realtek, MediaTek, Foxconn, Qualcomm, AzureWave, and Lite-On remain component evidence unless independently identified.
- Confirmed Samsung/Apple OUI-only records remain unidentified, while model/hostname/service evidence disambiguates phone, PC, and TV categories.
- Confirmed ports/services `80`, `443`, `HTTP`, and `HTTPS` do not determine device category.
- Confirmed raw observed manufacturer/model values are retained in `profile_evidence`.
- Confirmed `synthesize_ensemble_profile()` retains its original parameter list and four-string tuple.
- Confirmed scanner records retain existing keys and add all structured profile keys.
- Confirmed no network calls, external services, or packet transmission were added.
- Confirmed untracked `frontend-react/src/lib/theme.ts` was neither modified nor staged.

## Concerns

- The benchmark currently contains synthetic fixtures only. Its precision is a deterministic regression signal, not a claim of real-world field precision; authorized test-device captures should be added in later data-collection work.
- Full Python tests emit existing Scapy/Wireshark manufacturer-database and TripleDES deprecation warnings; they do not affect test results.

## Fix Round 1

### Changes

- Randomized/local-admin MAC profiles now force vendor, device type, and status
  to `Unknown`/`unknown` unless mDNS or SSDP supplies manufacturer and model.
- Manufacturer-only observations can identify a vendor at medium status but no
  longer infer a product category from a broad vendor token.
- DHCP, mDNS, and SSDP values are no longer rescored as an independent
  `identity_pattern` group after already contributing to their source group.
- Hostname patterns remain usable only when that source has not already
  supplied manufacturer/model identity; this also preserves abstention for
  conflicting explicit identities.
- Synthetic randomized benchmark cases backed only by DHCP/DHCPv6 were
  recalibrated to expect no high-confidence profile.

### RED

Command:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_unit_fingerprint.TestCoreFingerprint.test_profile_assessment_keeps_randomized_windows_signals_unknown `
  tests.test_unit_fingerprint.TestCoreFingerprint.test_profile_assessment_keeps_manufacturer_only_samsung_at_medium `
  tests.test_unit_fingerprint.TestCoreFingerprint.test_profile_assessment_does_not_count_one_dhcp_field_twice `
  tests.test_unit_fingerprint.TestCoreFingerprint.test_profile_assessment_accepts_explicit_samsung_phone_on_randomized_mac -v
```

Observed output:

```text
test_profile_assessment_keeps_randomized_windows_signals_unknown ... FAIL
test_profile_assessment_keeps_manufacturer_only_samsung_at_medium ... FAIL
test_profile_assessment_does_not_count_one_dhcp_field_twice ... FAIL
test_profile_assessment_accepts_explicit_samsung_phone_on_randomized_mac ... ok

FAIL: test_profile_assessment_keeps_randomized_windows_signals_unknown
AssertionError: 'Microsoft' != 'Unknown'

FAIL: test_profile_assessment_keeps_manufacturer_only_samsung_at_medium
AssertionError: 'Smartphone / Tablet' != 'Unknown'

FAIL: test_profile_assessment_does_not_count_one_dhcp_field_twice
AssertionError: 80 != 45

Ran 4 tests in 0.009s
FAILED (failures=3)
```

### GREEN: focused classifier and benchmark

Command:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest `
  tests.test_unit_fingerprint `
  tests.test_profile_benchmark -v
```

Observed output:

```text
Ran 39 tests in 0.155s
OK
development: precision=1.000 coverage=0.857 unknown=0.143 (3/21)
holdout: precision=1.000 coverage=0.889 unknown=0.111 (2/18)
```

### GREEN: full Python suite

Command:

```powershell
Set-Location python-service
& 'D:\spoorf\python-service\venv\Scripts\python.exe' -m unittest discover `
  -s tests -p "test_*.py" -q
```

Observed output:

```text
Ran 255 tests in 9.898s
OK
development: precision=1.000 coverage=0.857 unknown=0.143 (3/21)
holdout: precision=1.000 coverage=0.889 unknown=0.111 (2/18)
```

### Concerns

- Benchmark observations remain synthetic fixtures only; the metrics are
  regression measurements and are not claims of field accuracy.
- The full suite still emits the pre-existing Scapy/Wireshark manufacturer
  database and TripleDES deprecation warnings.
