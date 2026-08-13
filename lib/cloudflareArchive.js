import { auth } from "@/lib/firebase";

const archiveBaseUrl = (process.env.NEXT_PUBLIC_CLOUDFLARE_ARCHIVE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 20000;

export const hasCloudflareArchiveConfig = Boolean(archiveBaseUrl);

async function archiveRequest(path, options = {}) {
  if (!hasCloudflareArchiveConfig) {
    throw new Error("Cloudflare D1 archive is not configured.");
  }
  if (!auth?.currentUser) {
    throw new Error("Sign in before accessing the Cloudflare archive.");
  }

  const token = await auth.currentUser.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${archiveBaseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result?.error || `Cloudflare archive request failed (${response.status}).`);
    }

    return result;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Cloudflare D1 archive timed out. The Firebase save is still preserved.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function archiveRecord({
  recordType,
  recordKey,
  operationalDate,
  sourceUpdatedAt = "",
  payload,
}) {
  return archiveRequest("/v1/archive/record", {
    method: "PUT",
    body: JSON.stringify({
      recordType,
      recordKey,
      operationalDate,
      sourceUpdatedAt,
      payload,
    }),
  });
}

export async function archiveRecordBatch({
  records,
  coverageType = "",
  coveredDateKeys = [],
}) {
  return archiveRequest("/v1/archive/batch", {
    method: "POST",
    body: JSON.stringify({ records, coverageType, coveredDateKeys }),
  });
}

export async function loadArchivedRecord(recordType, recordKey) {
  const query = new URLSearchParams({ type: recordType, key: recordKey });
  const result = await archiveRequest(`/v1/archive/record?${query.toString()}`);
  return result.record ?? null;
}

export async function loadArchivedRange(recordType, startDateKey, endDateKey) {
  const query = new URLSearchParams({
    type: recordType,
    start: startDateKey,
    end: endDateKey,
  });
  const result = await archiveRequest(`/v1/archive/range?${query.toString()}`);
  return {
    records: Array.isArray(result.records) ? result.records : [],
    coveredDateKeys: Array.isArray(result.coveredDateKeys)
      ? result.coveredDateKeys
      : [],
  };
}

export async function loadArchivedRevisions(recordType, recordKey) {
  const query = new URLSearchParams({ type: recordType, key: recordKey });
  const result = await archiveRequest(`/v1/archive/revisions?${query.toString()}`);
  return Array.isArray(result.revisions) ? result.revisions : [];
}

export async function loadArchiveStatus() {
  return archiveRequest("/v1/status");
}
