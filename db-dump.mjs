import mysql from "mysql2/promise";
import fs from "fs";
import "dotenv/config";

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [tables] = await conn.query("SHOW TABLES");
const names = tables.map((r) => Object.values(r)[0]);
let sql = "SET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n";
for (const t of names) {
  const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${t}\``);
  const colNames = cols.map((c) => `\`${c.Field}\``).join(", ");
  sql += `TRUNCATE TABLE \`${t}\`;\n`;
  for (const r of rows) {
    const vals = Object.values(r)
      .map((v) => {
        if (v === null || v === undefined) return "NULL";
        if (v instanceof Date) return conn.escape(v.toISOString().slice(0, 19).replace("T", " "));
        if (typeof v === "object") return conn.escape(JSON.stringify(v));
        return conn.escape(v);
      })
      .join(", ");
    sql += `INSERT INTO \`${t}\` (${colNames}) VALUES (${vals});\n`;
  }
  sql += "\n";
}
sql += "SET FOREIGN_KEY_CHECKS=1;\n";
fs.writeFileSync("/tmp/dump.sql", sql);
console.log("dumped tables:", names.join(", "));
console.log("size:", (fs.statSync("/tmp/dump.sql").size / 1024).toFixed(1), "KB");
await conn.end();
