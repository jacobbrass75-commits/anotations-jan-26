import Database from "better-sqlite3";
import { dirname, resolve } from "path";
import { mkdirSync } from "fs";

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const [sourcePathArg, destinationPathArg] = process.argv.slice(2);

if (!sourcePathArg || !destinationPathArg) {
  console.error("Usage: node scripts/backup-sqlite.mjs <source-db> <destination-db>");
  process.exit(1);
}

const sourcePath = resolve(sourcePathArg);
const destinationPath = resolve(destinationPathArg);

mkdirSync(dirname(destinationPath), { recursive: true });

const sourceDb = new Database(sourcePath, { fileMustExist: true });
sourceDb.pragma("busy_timeout = 5000");
sourceDb.exec(`VACUUM INTO ${quoteSqlString(destinationPath)}`);
sourceDb.close();

const backupDb = new Database(destinationPath, { fileMustExist: true, readonly: true });
const integrity = backupDb.prepare("PRAGMA integrity_check").pluck().get();
backupDb.close();

if (integrity !== "ok") {
  console.error(`Backup integrity check failed: ${integrity}`);
  process.exit(1);
}

console.log(destinationPath);
