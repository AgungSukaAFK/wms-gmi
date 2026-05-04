<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## Project Runtime Context (WMS-GMI)

- Local development DB: Supabase local (folder `supabase/`).
- Production DB: Supabase self-hosted di VPS (bukan Supabase Cloud).
- Frontend production di Vercel harus diarahkan ke endpoint Supabase VPS.

### Mandatory DB Change Reporting

Saat menyelesaikan fitur, jika ada perubahan database:

1. Selalu buat migration SQL di `supabase/migrations/`.
2. Jelaskan SQL/migration apa yang harus dijalankan di Supabase VPS.
3. Sertakan query verifikasi pasca deploy DB.
4. Jika tidak ada perubahan DB, sebutkan secara eksplisit bahwa tidak ada SQL tambahan untuk VPS.
