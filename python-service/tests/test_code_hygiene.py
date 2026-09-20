"""
Code Hygiene & AST Regression Test Suite
========================================
Memastikan tidak ada anti-pattern 'bare except:' di seluruh codebase `src/`.
Bare except menangkap BaseException (termasuk KeyboardInterrupt, SystemExit, dan asyncio.CancelledError),
yang dapat menelan sinyal interupsi sistem dan memicu zombie process.
"""

import ast
import os
import unittest
from pathlib import Path


class TestCodeHygiene(unittest.TestCase):

    def setUp(self):
        self.src_dir = Path(__file__).resolve().parent.parent / "src"

    def test_no_bare_except_handlers(self):
        """Seluruh handler except di src/ WAJIB menentukan tipe exception (minimal `except Exception:`)."""
        violations = []

        for root, _, files in os.walk(self.src_dir):
            for file in files:
                if file.endswith(".py"):
                    file_path = Path(root) / file
                    rel_path = file_path.relative_to(self.src_dir)
                    with open(file_path, "r", encoding="utf-8-sig") as f:
                        source = f.read()

                    try:
                        tree = ast.parse(source, filename=str(file_path))
                    except SyntaxError as err:
                        violations.append(f"SyntaxError in {rel_path}:{err.lineno}: {err.msg}")
                        continue

                    for node in ast.walk(tree):
                        if isinstance(node, ast.ExceptHandler):
                            # Jika node.type is None, berarti 'except:' (bare except)
                            if node.type is None:
                                violations.append(f"src/{rel_path}:{node.lineno} -> bare except: (use except Exception: or specific exception)")

        error_message = (
            f"\nFound {len(violations)} bare except statement(s) violating code hygiene:\n"
            + "\n".join(f"  - {v}" for v in violations)
            + "\n\nFix: Replace bare 'except:' with 'except Exception:' or a specific exception type."
        )
        self.assertEqual(violations, [], error_message)


if __name__ == "__main__":
    unittest.main()
