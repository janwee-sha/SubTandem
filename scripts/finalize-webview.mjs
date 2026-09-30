import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Script } from "node:vm";

const root = process.argv[2];
for (const name of ["sidebar.html", "overlay.html"]) {
  const file = path.join(root, name);
  const content = fs.readFileSync(file, "utf8");
  for (const match of content.matchAll(/<script[^>]*\bsrc="([^"]+)"[^>]*>/g)) {
    const target = path.resolve(root, match[1]);
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("INVALID_WEBVIEW_ASSET");
    const source = fs.readFileSync(target, "utf8");
    new Script(source, { filename: target });
  }
  fs.writeFileSync(file, content.replace(/<script type="module"/g, "<script"));
}
