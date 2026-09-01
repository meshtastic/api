/**
 * Writes v1/_meta.json, the ONLY place wall-clock time enters the published output.
 *
 * Everything in the Worker bundle is a pure function of the tree so CI can build twice and diff.
 * That determinism is what makes `_meta` necessary: the watchdog needs something that moves on
 * every pipeline run, and it must not be a payload timestamp. deviceLinks.generatedAt looks like a
 * candidate and is a trap -- the msh.to catalog changes on a scale of days, so a freshness alarm
 * on it would fire within a day and then forever, turning the one alarm that catches a stalled
 * pipeline into permanent noise.
 *
 * This is written unconditionally on every deploy and every sync, whether or not content changed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const sha =
  process.env.GITHUB_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const meta = {
  deployedAt: new Date().toISOString(),
  sha,
  ref: process.env.GITHUB_REF_NAME ?? null,
  run: process.env.GITHUB_RUN_ID ?? null,
  source: process.env.META_SOURCE ?? "deploy",
};

mkdirSync("dist-meta", { recursive: true });
const body = JSON.stringify(meta, null, 2);
writeFileSync("dist-meta/_meta.json", body);
console.log(body);
