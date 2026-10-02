import fs from "node:fs";
import path from "node:path";
import process from "node:process";
const root = process.argv[2];
const directory = path.join(root, "build/credential-probe/ui");
if (process.argv[3] === "prune") {
  const output = path.join(root, "dist/ui");
  const files = new Set(["sidebar.html", "overlay.html"]);
  for (const html of [...files]) {
    const content = fs
      .readFileSync(path.join(output, html), "utf8")
      .replace(/<script type="module"/g, "<script");
    fs.writeFileSync(path.join(output, html), content);
    for (const match of content.matchAll(/(?:href|src)="([^"#]+)"/g))
      files.add(path.normalize(match[1]));
  }
  for (const entry of fs.readdirSync(output))
    if (!files.has(entry) && fs.statSync(path.join(output, entry)).isFile())
      fs.unlinkSync(path.join(output, entry));
} else {
  fs.mkdirSync(directory, { recursive: true });
  const html = fs
    .readFileSync(path.join(root, "ui/sidebar.html"), "utf8")
    .replace(
      /((?:src|href)=")([^"#]+)"/g,
      (_match, prefix, ref) =>
        `${prefix}${path.relative(directory, path.resolve(root, "ui", ref))}"`,
    )
    .replace(
      "</body>",
      '<script type="module" src="../../../tests/helpers/credential-host-probe.ts"></script></body>',
    );
  fs.writeFileSync(path.join(directory, "sidebar.html"), html);
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "subtandem-credential-probe",
      private: true,
      targets: {
        sidebar: {
          source: "sidebar.html",
          outputFormat: "global",
          distDir: "../../../dist/ui",
          publicUrl: "./",
          sourceMap: false,
          optimize: false,
        },
      },
    }),
  );
}
