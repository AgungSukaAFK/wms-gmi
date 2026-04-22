import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("==========================================");
console.log("🚀 MEMULAI PROSES IMPORT KESELURUHAN CSV");
console.log("==========================================\n");

try {
  console.log("▶️  BAGIAN 1: Meng-import Data Master & Header...");
  execSync("node run-import.mjs", { 
    cwd: __dirname, 
    stdio: "inherit" 
  });

  console.log("\n▶️  BAGIAN 2: Meng-import Data Detail Items...");
  execSync("node run-import-details.mjs", { 
    cwd: __dirname, 
    stdio: "inherit" 
  });

  console.log("\n==========================================");
  console.log("🎉 SELURUH PROSES IMPORT BERHASIL SELESAI!");
  console.log("==========================================");
} catch (error) {
  console.error("\n❌ PROSES IMPORT GAGAL/TERHENTI!");
  console.error(error.message);
  process.exit(1);
}
