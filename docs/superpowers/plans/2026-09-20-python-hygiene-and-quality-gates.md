# Python Service Hygiene & Quality Gates (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghilangkan seluruh 34 titik `bare except:` di `python-service/src/`, menambahkan regression test AST guard anti-bare-except, serta mengintegrasikan `pyproject.toml` (Ruff, Mypy, Pytest) sebagai quality gate standar enterprise backend.

**Architecture:** 
1. Refaktor defensif 34 `bare except:` ke `except Exception:` atau exception spesifik (`(socket.error, OSError)`, `(ipaddress.AddressValueError, ValueError)`, `(ValueError, TypeError)`) agar sinyal `KeyboardInterrupt`, `SystemExit`, dan pembatalan task tidak tertelan.
2. Penambahan test AST linter internal (`tests/test_code_hygiene.py`) yang memverifikasi bahwa tidak ada handler `except:` tanpa tipe di seluruh codebase `src/`.
3. Standarisasi konfigurasi PEP 518/621 via `pyproject.toml` dengan profil `ruff` (linter & formatter), `mypy` (gradual typing), dan `pytest` (runner backward-compatible).

**Tech Stack:** Python 3.11, FastAPI, Scapy 2.5.0, Ruff, Mypy, Pytest, Python AST.

**Spec / Governing Docs:**
- `AGENTS.md` (Core Invariants 1-7)
- `docs/specs/SPEC-007_AUTOMATED_TESTING_SUITE.md`
- `docs/TROUBLESHOOTING.md` (Pencegahan zombie process & abnormal shutdown)

## Global Constraints
- **Core Invariant 1 (Gateway Immunity)** & **Invariant 2 (Controller Self-Protection)**: Fungsi `is_valid_private_ip`, `is_valid_mac`, `get_self_mac`, dan `get_current_gateway` tidak boleh berubah kontrak return nilainya.
- **Core Invariant 3 (Lock Concurrency)**: Tidak boleh menambahkan operasi packet I/O di dalam `self._lock`.
- **Zero Breaking Change**: Seluruh 379 unit test Python dan 114 test Node.js harus tetap 100% lulus.
- **Packaging Safety**: Dependensi dev (Ruff, Mypy) tidak boleh merusak build PyInstaller `build_engine.py` / `spoorf-engine.spec`.

---

## Proposed Changes

### Component 1: Automated AST Hygiene Guard Test (TDD)

#### [NEW] [test_code_hygiene.py](file:///d:/spoorf/python-service/tests/test_code_hygiene.py)
- Membaca semua file `.py` di dalam `python-service/src/`.
- Mem-parse kode menggunakan modul standar `ast`.
- Menginspeksi seluruh node `ast.ExceptHandler`. Jika `node.type is None` (bare except), test gagal dan mencatat `file:line`.

---

### Component 2: Refactoring 34 Bare Excepts Across 13 Files

#### [MODIFY] [src/main.py](file:///d:/spoorf/python-service/src/main.py)
- Baris 10: `except:` &rarr; `except Exception:`

#### [MODIFY] [src/server.py](file:///d:/spoorf/python-service/src/server.py)
- Baris 250: `except:` &rarr; `except Exception:`
- Baris 266: `except:` &rarr; `except Exception:`
- Baris 292: `except:` &rarr; `except Exception:`

#### [MODIFY] [src/core/network.py](file:///d:/spoorf/python-service/src/core/network.py)
- Baris 45: `except:` &rarr; `except (ipaddress.AddressValueError, ValueError):`
- Baris 91: `except:` &rarr; `except Exception:`
- Baris 127: `except:` &rarr; `except Exception:`
- Baris 146: `except:` &rarr; `except Exception:`
- Baris 469: `except:` &rarr; `except Exception:`

#### [MODIFY] [src/core/telemetry.py](file:///d:/spoorf/python-service/src/core/telemetry.py)
- Baris 40: `except:` &rarr; `except Exception:`
- Baris 60: `except:` &rarr; `except Exception:`
- Baris 95: `except:` &rarr; `except Exception:`
- Baris 111: `except:` &rarr; `except Exception:`

#### [MODIFY] [src/core/fingerprint/vendors.py](file:///d:/spoorf/python-service/src/core/fingerprint/vendors.py)
- Baris 77: `except:` &rarr; `except (IndexError, AttributeError, ValueError):`

#### [MODIFY] [src/core/scanner.py](file:///d:/spoorf/python-service/src/core/scanner.py)
- Baris 266: `except:` &rarr; `except (socket.error, OSError):`

#### [MODIFY] [src/core/discovery/dhcp.py](file:///d:/spoorf/python-service/src/core/discovery/dhcp.py)
- Baris 496: `except:` &rarr; `except Exception:`
- Baris 588: `except:` &rarr; `except Exception:`
- Baris 607: `except:` &rarr; `except Exception:`
- Baris 764: `except:` &rarr; `except Exception:`

#### [MODIFY] [src/core/discovery/multicast.py](file:///d:/spoorf/python-service/src/core/discovery/multicast.py)
- Baris 374: `except:` &rarr; `except Exception:`
- Baris 376: `except:` &rarr; `except Exception:`
- Baris 428: `except:` &rarr; `except Exception:`
- Baris 430: `except:` &rarr; `except Exception:`

#### [MODIFY] [src/core/diagnostics.py](file:///d:/spoorf/python-service/src/core/diagnostics.py)
- Baris 190: `except:` &rarr; `except (socket.error, OSError):`
- Baris 198: `except:` &rarr; `except (socket.error, OSError):`

#### [MODIFY] [src/core/discovery/arp.py](file:///d:/spoorf/python-service/src/core/discovery/arp.py)
- Baris 127: `except:` &rarr; `except Exception:`
- Baris 204: `except:` &rarr; `except Exception:`

#### [MODIFY] [src/core/discovery/ipv6_ndp.py](file:///d:/spoorf/python-service/src/core/discovery/ipv6_ndp.py)
- Baris 57: `except:` &rarr; `except (ipaddress.AddressValueError, ValueError):`

#### [MODIFY] [src/core/fingerprint/probe.py](file:///d:/spoorf/python-service/src/core/fingerprint/probe.py)
- Baris 60: `except:` &rarr; `except (socket.error, OSError):`
- Baris 96: `except:` &rarr; `except (socket.error, OSError):`
- Baris 116: `except:` &rarr; `except (socket.error, OSError):`
- Baris 132: `except:` &rarr; `except (ValueError, TypeError):`
- Baris 147: `except:` &rarr; `except Exception:`

#### [MODIFY] [src/core/fingerprint/netbios.py](file:///d:/spoorf/python-service/src/core/fingerprint/netbios.py)
- Baris 71: `except:` &rarr; `except Exception:`

---

### Component 3: Tooling & Quality Gates Setup

#### [NEW] [pyproject.toml](file:///d:/spoorf/python-service/pyproject.toml)
- Format standar PEP 518/621.
- Konfigurasi Ruff: line-length 120, rules `E`, `W`, `F`, `I`, `UP`, `B` (Bugbear, mendeteksi B001 bare except otomatis), mengabaikan `B008` untuk FastAPI.
- Konfigurasi Mypy: target Python 3.11, gradual mode, ignore missing imports untuk `scapy.*` dan `netifaces.*`.
- Konfigurasi Pytest: testpaths `tests`, file pattern `test_*.py`.
- Optional dependencies: `[project.optional-dependencies] dev = ["ruff>=0.3.0", "mypy>=1.9.0", "pytest>=7.0.0"]`.

#### [NEW] [requirements-dev.txt](file:///d:/spoorf/python-service/requirements-dev.txt)
- Berisi dependensi dev: `ruff>=0.3.0`, `mypy>=1.9.0`, `pytest>=7.0.0`.

---

## Tasks Breakdown

### Task 1: Write Failing AST Code Hygiene Test (TDD)
**Files:**
- Create: `python-service/tests/test_code_hygiene.py`

- [ ] **Step 1: Buat file test AST yang mencari bare except di `src/`**
- [ ] **Step 2: Jalankan test dan verifikasi test GAGAL dengan mendeteksi 34 bare excepts**
  Command: `.\venv\Scripts\python.exe -m unittest tests/test_code_hygiene.py`
  Expected: FAIL (menemukan 34 pelanggaran `node.type is None`)

### Task 2: Refactor 34 Bare Excepts di 13 File
**Files:**
- Modify: `src/main.py`
- Modify: `src/server.py`
- Modify: `src/core/network.py`
- Modify: `src/core/telemetry.py`
- Modify: `src/core/fingerprint/vendors.py`
- Modify: `src/core/scanner.py`
- Modify: `src/core/discovery/dhcp.py`
- Modify: `src/core/discovery/multicast.py`
- Modify: `src/core/diagnostics.py`
- Modify: `src/core/discovery/arp.py`
- Modify: `src/core/discovery/ipv6_ndp.py`
- Modify: `src/core/fingerprint/probe.py`
- Modify: `src/core/fingerprint/netbios.py`

- [ ] **Step 1: Refactor Group 1 (Network, ARP, IPv6 NDP)**
- [ ] **Step 2: Refactor Group 2 (Server Watchdog & Main)**
- [ ] **Step 3: Refactor Group 3 (Telemetry & Diagnostics)**
- [ ] **Step 4: Refactor Group 4 (DHCP & Multicast)**
- [ ] **Step 5: Refactor Group 5 (Probe, Vendors, NetBIOS, Scanner)**
- [ ] **Step 6: Jalankan test AST hygiene dan verifikasi LULUS (0 pelanggaran)**
  Command: `.\venv\Scripts\python.exe -m unittest tests/test_code_hygiene.py`
  Expected: PASS (0 bare excepts found across all files)

### Task 3: Create `pyproject.toml` and `requirements-dev.txt`
**Files:**
- Create: `python-service/pyproject.toml`
- Create: `python-service/requirements-dev.txt`

- [ ] **Step 1: Tulis file `pyproject.toml` dengan konfigurasi ruff, mypy, pytest**
- [ ] **Step 2: Tulis file `requirements-dev.txt`**
- [ ] **Step 3: Verifikasi sintaks TOML valid menggunakan modul `tomllib` Python 3.11**

### Task 4: Full Test Suite Verification (SPEC-007)
- [ ] **Step 1: Jalankan seluruh 380 Python unit tests**
  Command: `.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`
  Expected: 380 / 380 tests PASS (OK)
- [ ] **Step 2: Jalankan seluruh 114 Node.js tests**
  Command: `cd d:/spoorf/backend-node; npm test`
  Expected: 114 / 114 tests PASS (100% green)

### Task 5: Documentation & Git Commit
**Files:**
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Dokumentasikan perbaikan P1 pada `CHANGELOG.md` dan `AGENTS.md`**
- [ ] **Step 2: Buat git commit yang bersih**

---

## Verification Plan

### Automated Tests
```powershell
# 1. Verifikasi Hygiene AST Guard (Harus 0 bare except)
cd d:/spoorf/python-service
.\venv\Scripts\python.exe -m unittest tests/test_code_hygiene.py

# 2. Verifikasi seluruh Python test suite (380 tests)
.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v

# 3. Verifikasi Node.js backend suite (114 tests)
cd d:/spoorf/backend-node
npm test
```
