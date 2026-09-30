import { redirect } from "next/navigation";

// /update-logs sudah digantikan /update-web (datanya dimigrasi lewat
// supabase/migrations/20260930110000_update_web.sql). Route ini dipertahankan
// supaya bookmark/link lama tetap jalan.
export default function UpdateLogsPage() {
  redirect("/update-web");
}
