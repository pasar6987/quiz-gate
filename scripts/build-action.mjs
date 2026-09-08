import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import ncc from "@vercel/ncc";

const outputDirectory = resolve("dist/action");
await rm(outputDirectory, { recursive: true, force: true });

const bundle = await ncc(resolve("src/action/index.ts"), {
  minify: true,
  sourceMap: false,
});

await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "index.js"), bundle.code);
await Promise.all(
  Object.entries(bundle.assets).map(async ([name, asset]) => {
    const path = resolve(outputDirectory, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, asset.source);
  }),
);

const kilobytes = Math.ceil(
  (Buffer.byteLength(bundle.code) +
    Object.values(bundle.assets).reduce(
      (total, asset) => total + Buffer.byteLength(asset.source),
      0,
    )) /
    1024,
);
console.log(`Built Quiz Gate action (${kilobytes} KiB).`);
