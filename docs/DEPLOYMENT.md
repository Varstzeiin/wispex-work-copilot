# Panduan deploy Wispex Work Copilot

Aplikasi ini terdiri dari tiga bagian. Ketiganya harus jalan supaya bisa login dan menyimpan data.

| Bagian | Layanan | Fungsi |
|---|---|---|
| Frontend (tampilan) | **Vercel** | Halaman web yang dibuka di browser dan HP |
| Backend (FastAPI) | **Render** | Login, task, dokumen, assistant, semua logika |
| Database + file | **Supabase** | PostgreSQL untuk data, Storage untuk dokumen yang diupload |

Alurnya: browser → Vercel → (`/api/*` diteruskan) → Render → Supabase.

Kalau halaman login menampilkan *"The server is not reachable right now"*, berarti Vercel belum bisa
menghubungi backend (langkah 3 atau 4 belum selesai).

Semua layanan di bawah punya paket gratis. Kurang lebih butuh 30 menit.

---

## 1. Supabase: database dan penyimpanan dokumen

1. Buka https://supabase.com, buat akun, lalu **New project**.
   - *Database password*: buat yang kuat dan **simpan**, dipakai di langkah berikutnya.
   - *Region*: pilih **Southeast Asia (Singapore)** supaya dekat dengan Render Singapore.
2. Ambil connection string database:
   **Project Settings → Database → Connection string → Session pooler**.
   Bentuknya seperti ini (ganti `[YOUR-PASSWORD]` dengan password tadi):
   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
   Ini nanti jadi `DATABASE_URL`. Pakai **Session pooler**, bukan *Direct connection*
   (direct connection Supabase hanya IPv6, sedangkan Render butuh IPv4).
3. Buat bucket untuk dokumen: **Storage → New bucket** → nama `documents` → **matikan "Public bucket"**.
4. Ambil kunci untuk storage: **Project Settings → API**.
   - `Project URL` → jadi `SUPABASE_URL`
   - `service_role` key (bagian *Project API keys*, klik *Reveal*) → jadi `SUPABASE_SERVICE_ROLE_KEY`

   Kunci `service_role` itu rahasia penuh. Hanya diisi di Render, jangan pernah di Vercel atau di kode.

Tabel database **dibuat otomatis** oleh backend saat pertama kali jalan. Tidak perlu menjalankan SQL apa pun.

---

## 2. Buat secret aplikasi

Di laptop, dari folder `backend` (dengan venv aktif):

```bash
python -m app.scripts.generate_secrets
```

Hasilnya dua baris, `JWT_SECRET=...` dan `ENCRYPTION_KEY=...`. Simpan di tempat aman (misalnya password manager).
**Jangan ganti `ENCRYPTION_KEY` setelah dipakai**, karena dokumen yang sudah tersimpan jadi tidak bisa dibuka.

---

## 3. Render: backend

1. Buka https://render.com, login pakai GitHub.
2. **New → Blueprint** → pilih repository `wispex-work-copilot`. Render membaca file `render.yaml`.
3. Render meminta nilai untuk setiap variabel. Isi:

   | Variabel | Isi |
   |---|---|
   | `JWT_SECRET` | dari langkah 2 |
   | `ENCRYPTION_KEY` | dari langkah 2 |
   | `DATABASE_URL` | connection string Supabase (langkah 1.2) |
   | `FRONTEND_URL` | `https://wispex-work-copilot.vercel.app` |
   | `SUPABASE_URL` | dari langkah 1.4 |
   | `SUPABASE_SERVICE_ROLE_KEY` | dari langkah 1.4 |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | kosongkan dulu (lihat langkah 6) |
   | `AI_PROVIDER`, `AI_API_KEY` | kosongkan dulu (fitur AI opsional) |

4. Klik **Apply**. Build pertama sekitar 5 sampai 10 menit (termasuk mengunduh model pencarian semantik).
5. Setelah status **Live**, buka `https://<nama-service>.onrender.com/api/health/ready`. Harus muncul:
   ```json
   {"status": "ready", "database": {"kind": "postgresql", "ok": true}, "storage": "supabase", "warnings": []}
   ```
   Kalau `database.ok` bernilai `false`, cek lagi `DATABASE_URL` (biasanya password salah).
   Kalau `warnings` tidak kosong, baca isinya: itu pengaturan yang bisa membuat data hilang.

---

## 4. Vercel: sambungkan ke backend

1. Vercel → project `wispex-work-copilot` → **Settings → Environment Variables**.
2. Tambah `BACKEND_URL` = `https://<nama-service>.onrender.com` (tanpa `/` di akhir), untuk *Production* dan *Preview*.
3. **Deployments → titik tiga pada deployment terakhir → Redeploy**.
4. Pastikan **Settings → General → Root Directory** = `frontend`.

Buka https://wispex-work-copilot.vercel.app/login. Pesan *"server is not reachable"* harus sudah hilang.
Coba **Create account**, buat task, logout, lalu login lagi: data harus tetap ada.

---

## 5. Cek bahwa data benar-benar tersimpan

- Supabase → **Table Editor**: tabel `users` dan `tasks` berisi data yang baru kamu buat.
- Di Render, **Manual Deploy → Restart service**, lalu login lagi. Task masih ada.
  (Ini yang membedakan dengan SQLite: di Render, file SQLite hilang setiap restart.)

---

## 6. Opsional: Continue with Google

1. https://console.cloud.google.com → buat project → **APIs & Services → OAuth consent screen**
   (External, isi nama aplikasi dan email, scope cukup `openid`, `email`, `profile`).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. *Authorized redirect URIs*: `https://wispex-work-copilot.vercel.app/api/auth/google/callback`
4. Salin *Client ID* dan *Client secret* ke Render (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), lalu restart service.

Tombol **Continue with Google** muncul otomatis di halaman login setelah itu.

---

## Hal yang perlu diketahui

- **Render gratis tidur setelah 15 menit tanpa pengunjung.** Request pertama setelah itu butuh sekitar
  30 sampai 60 detik (server bangun dan memuat model). Kalau login pertama gagal, tunggu sebentar lalu coba lagi.
  Paket berbayar Render tidak tidur.
- **Supabase gratis di-pause setelah 7 hari tanpa aktivitas.** Aktifkan lagi dari dashboard Supabase kalau terjadi.
- **Backup**: Supabase gratis tidak punya backup otomatis harian. Untuk data penting, export berkala
  (Database → Backups, atau `pg_dump`) atau pakai paket berbayar.
- **Batas percobaan login** dihitung per alamat IP di server. Di belakang Vercel, semua pengguna bisa terlihat
  dari alamat yang sama, jadi batas 10 pendaftaran per menit berlaku bersama. Cukup untuk tim kecil.
- **Jangan upload dokumen perusahaan atau klien** kecuali kebijakan organisasi mengizinkan aplikasi ini (dan
  penyedia AI, kalau diaktifkan) memprosesnya.

## Mengecek kesehatan server kapan saja

`https://<nama-service>.onrender.com/api/health/ready` menampilkan status database, storage, pencarian
semantik, dan peringatan konfigurasi. Render juga memakai alamat ini sebagai health check, jadi deploy
dengan `DATABASE_URL` yang salah akan gagal di Render, bukan saat pengguna mencoba login.
