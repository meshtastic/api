import fs from 'fs';

const protoRoot = "src/generated";

const files = [
  "node_modules/.pnpm/@tinyhttp+app@2.0.25/node_modules/@tinyhttp/app/dist/onError.d.ts",
  "node_modules/.pnpm/@tinyhttp+res@2.0.19/node_modules/@tinyhttp/res/dist/index.d.ts",
];

files.forEach((file) => {
  let content = fs.readFileSync(file, "utf-8");

  content = content
    .split("\n")
    .map((s) =>
      s.replace(/^(..port .+? from ["']\..+?)(?<!js)(["'];)$/, "$1.js$2")
    )
    .join("\n");

  fs.writeFileSync(file, content, "utf-8");
});
