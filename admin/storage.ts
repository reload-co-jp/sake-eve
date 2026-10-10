import { readFileSync } from "node:fs"
import { join } from "node:path"
import { writeJson } from "../collector/store.ts"
import type { AuditEntry } from "./api.ts"

const read = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (e) {
    // Only a missing file falls back; a corrupt log must not be silently overwritten.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback
    throw e
  }
}

/** Review files written by the collector and the admin UI. */
export const loadReview = (dataDir: string) => ({
  duplicates: read(join(dataDir, "review", "duplicate-candidates.json"), []),
  collectLog: read(join(dataDir, "review", "collect-log.json"), []),
  audit: read<AuditEntry[]>(join(dataDir, "review", "audit-log.json"), []),
})

/** Who changed what and why; kept in the repo so approvals are reviewable in PRs. */
export const appendAudit = (
  dataDir: string,
  entry: AuditEntry,
  keep = 2000
) => {
  const path = join(dataDir, "review", "audit-log.json")
  writeJson(path, [...read<AuditEntry[]>(path, []), entry].slice(-keep))
}
