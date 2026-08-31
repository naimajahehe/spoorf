# Berkas Prasyarat Installer

Letakkan dua berkas berikut di folder ini **sebelum** menjalankan `npm run build:exe`.
Installer (`build/installer.nsh`) akan otomatis mendeteksi & memasangnya di komputer
pengguna hanya bila belum terpasang. Jika salah satu berkas belum ada di sini, build
tetap berhasil tetapi langkah pemasangan prasyarat itu dilewati (lihat guard
`!if /FileExists` di `installer.nsh`).

| Berkas (nama persis) | Sumber resmi | Cara pasang oleh installer |
| --- | --- | --- |
| `npcap.exe` | https://npcap.com/#download — unduh `npcap-<versi>.exe`, lalu **rename menjadi `npcap.exe`** | Interaktif (pengguna klik-lanjut di UI Npcap) |
| `vc_redist.x64.exe` | https://aka.ms/vs/17/release/vc_redist.x64.exe | Senyap (`/install /quiet /norestart`) |

## Catatan lisensi (penting)
- **Npcap** dijalankan secara **interaktif** agar patuh pada lisensi gratis Npcap.
  Pemasangan **senyap/otomatis-penuh** Npcap hanya sah bila Anda memiliki
  **lisensi Npcap OEM** (berbayar). Jangan mengubah `installer.nsh` menjadi silent
  tanpa lisensi OEM.

## Catatan repositori
Kedua berkas ini berukuran besar dan merupakan biner pihak ketiga — sebaiknya
tidak di-commit ke version control. Bila nanti repo memakai git, tambahkan ke
`.gitignore`:

```
desktop-electron/build/prerequisites/*.exe
```
