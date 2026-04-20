import { redirect } from "next/navigation";
import { SearchX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NotFoundActions } from "@/components/not-found-actions";

export default async function NotFound() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <section className="mx-auto flex min-h-[80vh] w-full max-w-3xl items-center justify-center">
        <div className="w-full rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <SearchX className="h-7 w-7" />
          </div>

          <p className="text-center text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Error 404
          </p>
          <h1 className="mt-2 text-center text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
            Halaman Tidak Ditemukan
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-center text-sm text-slate-600 sm:text-base">
            URL yang kamu buka tidak tersedia atau sudah dipindahkan. Gunakan
            tombol di bawah untuk kembali ke alur kerja utama.
          </p>

          <NotFoundActions />
        </div>
      </section>
    </main>
  );
}
