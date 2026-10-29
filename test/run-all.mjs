// test/run-all.mjs — har test file ko alag process me chalata hai.
// Pehle package.json me bash `for` loop tha, jo Windows pe chalta hi nahi
// (npm scripts cmd.exe me run hote hain). Yeh Node se karta hai, isliye
// har OS pe same chalta hai.
//
//   node test/run-all.mjs

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();

let failed = 0;
for (const file of files) {
  console.log(`\n=== ${file}`);
  const res = spawnSync(process.execPath, [path.join(dir, file)], { stdio: "inherit" });
  if (res.status !== 0) failed++;
}

console.log(
  failed === 0
    ? `\nAll ${files.length} test files passed.`
    : `\n${failed} of ${files.length} test files FAILED.`
);
process.exit(failed === 0 ? 0 : 1);
