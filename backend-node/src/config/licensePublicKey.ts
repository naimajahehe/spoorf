/**
 * Public key RS256 Spoorf Cloud untuk verifikasi token lisensi secara offline (SPEC-008).
 *
 * Public key tidak rahasia dan aman di-commit. Sebelum rilis production, pastikan nilai ini
 * sama dengan `backend/keys/license-public.pem` milik server cloud production; token yang
 * ditandatangani private key lain akan ditolak dan klien jatuh ke tier Free.
 */
export const LICENSE_TOKEN_ISSUER = 'https://api.spoorf.app';

export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0r0FJmn5iLCP29374cwQ
eST/sENIOQ7Y7sWG9greBrE8X3IrSkrgZQZX51L4RobgxaFDRj35M/HhF+zl93W6
yOnNZjbb+kmVmm6n0QmwcNxbEwlf20Iufm7cLzhx5k6/+wcK0n7tEx37W9QkDkjR
JHxTfjNISQ9ZI8aTeYv2mrBvFtD/n2fFOA3pb9JW2wYYs3znDA8gOudFMLrv/o3q
flhvrFgDNtTstMOZhG6ir1uA9xJj6YBbZQLMpFaRRRabXiY8Up6q4IE7VHmCq3Ap
z+FODgGa91eXX4Qzp+77PuSroy4uCSHSuS4OflicA4vUzso7t+PnpVWDdDCYzGeU
1QIDAQAB
-----END PUBLIC KEY-----
`;
