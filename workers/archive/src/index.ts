const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MAX_BODY_BYTES = 1_500_000;
const MAX_RECORD_BYTES = 250_000;
const MAX_BATCH_RECORDS = 120;
const MAX_RANGE_DAYS = 120;
const ALLOWED_RECORD_TYPES = new Set([
  "night-duty",
  "in-house",
  "room-property-status",
]);
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type FirebaseClaims = {
  aud: string;
  iss: string;
  sub: string;
  exp: number;
  iat: number;
  auth_time: number;
};

type FirebaseJwk = JsonWebKey & { kid: string };

type StaffProfile = {
  uid: string;
  fullName: string;
  approvalStatus: string;
  employmentStatus: string;
  departmentKey: string;
  jobLevel: string;
  isSuperAdmin: boolean;
};

type ArchiveInput = {
  recordType: string;
  recordKey: string;
  operationalDate: string;
  sourceUpdatedAt: string;
  payload: Record<string, unknown>;
};

type AuthorizedRequest = {
  token: string;
  claims: FirebaseClaims;
  profile: StaffProfile;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getCorsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("Origin");
  const allowedOrigins = new Set(
    env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
  );
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });

  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  return headers;
}

function assertAllowedOrigin(request: Request, env: Env): void {
  const origin = request.headers.get("Origin");
  if (!origin) return;

  const allowed = env.ALLOWED_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(origin);

  if (!allowed) throw new HttpError(403, "This website origin is not allowed.");
}

function jsonResponse(
  request: Request,
  env: Env,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: getCorsHeaders(request, env),
  });
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function parseJwtSegment<T>(value: string): T {
  const decoded = new TextDecoder().decode(decodeBase64Url(value));
  return JSON.parse(decoded) as T;
}

async function loadFirebaseJwks(): Promise<FirebaseJwk[]> {
  const response = await fetch(FIREBASE_JWKS_URL, {
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });

  if (!response.ok) throw new HttpError(503, "Authentication keys are unavailable.");
  const body: unknown = await response.json();

  if (
    !body ||
    typeof body !== "object" ||
    !("keys" in body) ||
    !Array.isArray(body.keys)
  ) {
    throw new HttpError(503, "Authentication keys are invalid.");
  }

  return body.keys.filter((key): key is FirebaseJwk => Boolean(
    key && typeof key === "object" && "kid" in key && typeof key.kid === "string",
  ));
}

async function verifyFirebaseToken(token: string, projectId: string): Promise<FirebaseClaims> {
  if (token.length > 10000) throw new HttpError(401, "Invalid authentication token.");
  const segments = token.split(".");
  if (segments.length !== 3) throw new HttpError(401, "Invalid authentication token.");

  let header: { alg?: string; kid?: string };
  let claims: FirebaseClaims;

  try {
    header = parseJwtSegment<{ alg?: string; kid?: string }>(segments[0]);
    claims = parseJwtSegment<FirebaseClaims>(segments[1]);
  } catch {
    throw new HttpError(401, "Invalid authentication token.");
  }

  if (header.alg !== "RS256" || !header.kid) {
    throw new HttpError(401, "Invalid authentication token.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    claims.aud !== projectId ||
    claims.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof claims.sub !== "string" ||
    claims.sub.length < 1 ||
    claims.sub.length > 128 ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now - 60 ||
    !Number.isFinite(claims.iat) ||
    claims.iat > now + 60 ||
    !Number.isFinite(claims.auth_time) ||
    claims.auth_time > now + 60
  ) {
    throw new HttpError(401, "Expired or invalid authentication token.");
  }

  const keys = await loadFirebaseJwks();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new HttpError(401, "Authentication key was not found.");

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    decodeBase64Url(segments[2]),
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );

  if (!verified) throw new HttpError(401, "Invalid authentication token.");
  return claims;
}

function getFirestoreString(fields: Record<string, unknown>, key: string): string {
  const field = fields[key];
  if (!field || typeof field !== "object" || !("stringValue" in field)) return "";
  return typeof field.stringValue === "string" ? field.stringValue : "";
}

function getFirestoreBoolean(fields: Record<string, unknown>, key: string): boolean {
  const field = fields[key];
  return Boolean(
    field && typeof field === "object" &&
    "booleanValue" in field && field.booleanValue === true,
  );
}

async function loadStaffProfile(
  token: string,
  claims: FirebaseClaims,
  projectId: string,
): Promise<StaffProfile> {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/(default)/documents/users/${encodeURIComponent(claims.sub)}`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 404) throw new HttpError(403, "Staff profile was not found.");
  if (!response.ok) throw new HttpError(403, "Staff profile could not be authorized.");

  const document: unknown = await response.json();
  if (
    !document ||
    typeof document !== "object" ||
    !("fields" in document) ||
    !document.fields ||
    typeof document.fields !== "object"
  ) {
    throw new HttpError(403, "Staff profile is invalid.");
  }
  const fields = document.fields as Record<string, unknown>;

  return {
    uid: claims.sub,
    fullName: getFirestoreString(fields, "fullName"),
    approvalStatus: getFirestoreString(fields, "approvalStatus"),
    employmentStatus: getFirestoreString(fields, "employmentStatus"),
    departmentKey: getFirestoreString(fields, "departmentKey"),
    jobLevel: getFirestoreString(fields, "jobLevel"),
    isSuperAdmin: getFirestoreBoolean(fields, "isSuperAdmin"),
  };
}

function isLead(profile: StaffProfile): boolean {
  return profile.jobLevel === "manager" || profile.jobLevel === "supervisor";
}

function assertApprovedLead(profile: StaffProfile): void {
  if (
    profile.approvalStatus !== "approved" ||
    profile.employmentStatus !== "active" ||
    (!profile.isSuperAdmin && !isLead(profile))
  ) {
    throw new HttpError(403, "Manager or supervisor access is required.");
  }
}

function assertCanWrite(profile: StaffProfile, recordType: string): void {
  assertApprovedLead(profile);
  if (profile.isSuperAdmin) return;

  const requiredDepartment = {
    "night-duty": "night_duty",
    "in-house": "front_office",
    "room-property-status": "housekeeping",
  }[recordType];

  if (!requiredDepartment || profile.departmentKey !== requiredDepartment) {
    throw new HttpError(403, "This department cannot archive that report type.");
  }
}

async function authorize(request: Request, env: Env): Promise<AuthorizedRequest> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "Sign in before accessing the archive.");
  }

  const token = authorization.slice(7).trim();
  const claims = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
  const profile = await loadStaffProfile(token, claims, env.FIREBASE_PROJECT_ID);
  assertApprovedLead(profile);
  return { token, claims, profile };
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.body) throw new HttpError(400, "A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "The archive request is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "The request body must be valid JSON.");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeArchiveInput(value: unknown): ArchiveInput {
  if (!isPlainObject(value)) throw new HttpError(400, "Invalid archive record.");

  const recordType = typeof value.recordType === "string" ? value.recordType : "";
  const recordKey = typeof value.recordKey === "string" ? value.recordKey.trim() : "";
  const operationalDate = typeof value.operationalDate === "string"
    ? value.operationalDate
    : "";
  const sourceUpdatedAt = typeof value.sourceUpdatedAt === "string"
    ? value.sourceUpdatedAt.slice(0, 40)
    : "";
  const payload = value.payload;

  if (!ALLOWED_RECORD_TYPES.has(recordType)) {
    throw new HttpError(400, "Unsupported archive record type.");
  }
  if (!DATE_KEY_PATTERN.test(operationalDate)) {
    throw new HttpError(400, "A valid operational date is required.");
  }
  if (!isPlainObject(payload)) throw new HttpError(400, "Archive payload must be an object.");

  if (
    (recordType === "night-duty" || recordType === "in-house") &&
    (recordKey !== operationalDate || payload.operationalDateKey !== operationalDate)
  ) {
    throw new HttpError(400, "The report key must match its operational date.");
  }
  if (
    recordType === "room-property-status" &&
    (recordKey.length < 1 || recordKey.length > 30 || payload.roomNumber !== recordKey)
  ) {
    throw new HttpError(400, "The room report key is invalid.");
  }

  const payloadJson = JSON.stringify(payload);
  if (new TextEncoder().encode(payloadJson).byteLength > MAX_RECORD_BYTES) {
    throw new HttpError(413, "The archived report is too large.");
  }

  return { recordType, recordKey, operationalDate, sourceUpdatedAt, payload };
}

async function buildArchiveValues(input: ArchiveInput, profile: StaffProfile) {
  const payloadJson = JSON.stringify(input.payload);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payloadJson),
  );
  const contentHash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  return {
    ...input,
    payloadJson,
    contentHash,
    archivedAt: new Date().toISOString(),
    updatedByUid: profile.uid,
    updatedByName: profile.fullName,
  };
}

function buildArchiveStatements(
  env: Env,
  values: Awaited<ReturnType<typeof buildArchiveValues>>,
): D1PreparedStatement[] {
  const bindings = [
    values.recordType,
    values.recordKey,
    values.operationalDate,
    values.payloadJson,
    values.contentHash,
    values.sourceUpdatedAt,
    values.archivedAt,
    values.updatedByUid,
    values.updatedByName,
  ] as const;

  return [
    env.ARCHIVE_DB.prepare(`
      INSERT INTO archive_revisions (
        record_type, record_key, operational_date, payload_json, content_hash,
        source_updated_at, archived_at, updated_by_uid, updated_by_name
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE COALESCE((
        SELECT content_hash FROM archive_records
        WHERE record_type = ? AND record_key = ?
      ), '') <> ?
    `).bind(...bindings, values.recordType, values.recordKey, values.contentHash),
    env.ARCHIVE_DB.prepare(`
      INSERT INTO archive_records (
        record_type, record_key, operational_date, payload_json, content_hash,
        source_updated_at, archived_at, updated_by_uid, updated_by_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_type, record_key) DO UPDATE SET
        operational_date = excluded.operational_date,
        payload_json = excluded.payload_json,
        content_hash = excluded.content_hash,
        source_updated_at = excluded.source_updated_at,
        archived_at = excluded.archived_at,
        updated_by_uid = excluded.updated_by_uid,
        updated_by_name = excluded.updated_by_name
    `).bind(...bindings),
    env.ARCHIVE_DB.prepare(`
      INSERT INTO archive_coverage (
        record_type, operational_date, checked_at, checked_by_uid
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(record_type, operational_date) DO UPDATE SET
        checked_at = excluded.checked_at,
        checked_by_uid = excluded.checked_by_uid
    `).bind(
      values.recordType,
      values.operationalDate,
      values.archivedAt,
      values.updatedByUid,
    ),
  ];
}

function parseDateKey(value: string | null, label: string): string {
  if (!value || !DATE_KEY_PATTERN.test(value)) {
    throw new HttpError(400, `A valid ${label} date is required.`);
  }
  return value;
}

function getRangeDayCount(start: string, end: string): number {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) {
    throw new HttpError(400, "The archive date range is invalid.");
  }
  const days = Math.floor((endTime - startTime) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) throw new HttpError(400, "Choose 120 days or fewer.");
  return days;
}

function parseStoredPayload(payloadJson: string): Record<string, unknown> | null {
  try {
    const payload: unknown = JSON.parse(payloadJson);
    return isPlainObject(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function handlePutRecord(
  request: Request,
  env: Env,
  authorized: AuthorizedRequest,
): Promise<Response> {
  const input = normalizeArchiveInput(await readJsonBody(request));
  assertCanWrite(authorized.profile, input.recordType);
  const values = await buildArchiveValues(input, authorized.profile);
  await env.ARCHIVE_DB.batch(buildArchiveStatements(env, values));
  return jsonResponse(request, env, { ok: true, archivedAt: values.archivedAt });
}

async function handleBatch(
  request: Request,
  env: Env,
  authorized: AuthorizedRequest,
): Promise<Response> {
  const body = await readJsonBody(request);
  if (!isPlainObject(body) || !Array.isArray(body.records)) {
    throw new HttpError(400, "A records array is required.");
  }
  if (body.records.length > MAX_BATCH_RECORDS) {
    throw new HttpError(400, `A batch can contain at most ${MAX_BATCH_RECORDS} records.`);
  }

  const inputs = body.records.map(normalizeArchiveInput);
  inputs.forEach((input) => assertCanWrite(authorized.profile, input.recordType));
  const values = await Promise.all(
    inputs.map((input) => buildArchiveValues(input, authorized.profile)),
  );
  const statements = values.flatMap((entry) => buildArchiveStatements(env, entry));

  const coverageType = typeof body.coverageType === "string" ? body.coverageType : "";
  const coveredDateKeys = Array.isArray(body.coveredDateKeys)
    ? body.coveredDateKeys.filter(
      (dateKey): dateKey is string => typeof dateKey === "string" && DATE_KEY_PATTERN.test(dateKey),
    ).slice(0, MAX_RANGE_DAYS)
    : [];

  if (coverageType) {
    if (!ALLOWED_RECORD_TYPES.has(coverageType)) {
      throw new HttpError(400, "Unsupported coverage record type.");
    }
    assertCanWrite(authorized.profile, coverageType);
    const checkedAt = new Date().toISOString();
    coveredDateKeys.forEach((dateKey) => {
      statements.push(env.ARCHIVE_DB.prepare(`
        INSERT INTO archive_coverage (
          record_type, operational_date, checked_at, checked_by_uid
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(record_type, operational_date) DO UPDATE SET
          checked_at = excluded.checked_at,
          checked_by_uid = excluded.checked_by_uid
      `).bind(coverageType, dateKey, checkedAt, authorized.profile.uid));
    });
  }

  if (statements.length > 0) await env.ARCHIVE_DB.batch(statements);
  return jsonResponse(request, env, {
    ok: true,
    archivedRecords: values.length,
    coveredDates: coveredDateKeys.length,
  });
}

async function handleGetRecord(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const recordType = url.searchParams.get("type") ?? "";
  const recordKey = url.searchParams.get("key")?.trim() ?? "";
  if (!ALLOWED_RECORD_TYPES.has(recordType) || !recordKey || recordKey.length > 80) {
    throw new HttpError(400, "A valid record type and key are required.");
  }

  const row = await env.ARCHIVE_DB.prepare(`
    SELECT record_key, operational_date, payload_json, source_updated_at, archived_at
    FROM archive_records
    WHERE record_type = ? AND record_key = ?
  `).bind(recordType, recordKey).first<{
    record_key: string;
    operational_date: string;
    payload_json: string;
    source_updated_at: string;
    archived_at: string;
  }>();

  return jsonResponse(request, env, {
    ok: true,
    record: row ? {
      recordKey: row.record_key,
      operationalDate: row.operational_date,
      payload: parseStoredPayload(row.payload_json),
      sourceUpdatedAt: row.source_updated_at,
      archivedAt: row.archived_at,
    } : null,
  });
}

async function handleGetRange(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const recordType = url.searchParams.get("type") ?? "";
  if (!ALLOWED_RECORD_TYPES.has(recordType)) {
    throw new HttpError(400, "A valid record type is required.");
  }
  const start = parseDateKey(url.searchParams.get("start"), "start");
  const end = parseDateKey(url.searchParams.get("end"), "end");
  getRangeDayCount(start, end);

  const [recordsResult, coverageResult] = await env.ARCHIVE_DB.batch([
    env.ARCHIVE_DB.prepare(`
      SELECT record_key, operational_date, payload_json, source_updated_at, archived_at
      FROM archive_records
      WHERE record_type = ? AND operational_date >= ? AND operational_date <= ?
      ORDER BY operational_date ASC
      LIMIT ?
    `).bind(recordType, start, end, MAX_RANGE_DAYS),
    env.ARCHIVE_DB.prepare(`
      SELECT operational_date
      FROM archive_coverage
      WHERE record_type = ? AND operational_date >= ? AND operational_date <= ?
      ORDER BY operational_date ASC
      LIMIT ?
    `).bind(recordType, start, end, MAX_RANGE_DAYS),
  ]);
  const recordRows = recordsResult.results as Array<{
    record_key: string;
    operational_date: string;
    payload_json: string;
    source_updated_at: string;
    archived_at: string;
  }>;
  const coverageRows = coverageResult.results as Array<{ operational_date: string }>;

  return jsonResponse(request, env, {
    ok: true,
    records: recordRows.map((row) => ({
      recordKey: row.record_key,
      operationalDate: row.operational_date,
      payload: parseStoredPayload(row.payload_json),
      sourceUpdatedAt: row.source_updated_at,
      archivedAt: row.archived_at,
    })).filter((row) => row.payload),
    coveredDateKeys: coverageRows.map((row) => row.operational_date),
  });
}

async function handleGetRevisions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const recordType = url.searchParams.get("type") ?? "";
  const recordKey = url.searchParams.get("key")?.trim() ?? "";
  if (!ALLOWED_RECORD_TYPES.has(recordType) || !recordKey || recordKey.length > 80) {
    throw new HttpError(400, "A valid record type and key are required.");
  }

  const result = await env.ARCHIVE_DB.prepare(`
    SELECT revision_id, operational_date, payload_json, source_updated_at,
      archived_at, updated_by_name
    FROM archive_revisions
    WHERE record_type = ? AND record_key = ?
    ORDER BY revision_id DESC
    LIMIT 25
  `).bind(recordType, recordKey).all<{
    revision_id: number;
    operational_date: string;
    payload_json: string;
    source_updated_at: string;
    archived_at: string;
    updated_by_name: string;
  }>();

  return jsonResponse(request, env, {
    ok: true,
    revisions: result.results.map((row) => ({
      revisionId: row.revision_id,
      operationalDate: row.operational_date,
      payload: parseStoredPayload(row.payload_json),
      sourceUpdatedAt: row.source_updated_at,
      archivedAt: row.archived_at,
      updatedByName: row.updated_by_name,
    })).filter((row) => row.payload),
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  assertAllowedOrigin(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
  }

  const authorized = await authorize(request, env);
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/v1/status") {
    const row = await env.ARCHIVE_DB.prepare(
      "SELECT COUNT(*) AS record_count FROM archive_records",
    ).first<{ record_count: number }>();
    return jsonResponse(request, env, {
      ok: true,
      service: "sunshine-hotel-archive",
      storedRecords: Number(row?.record_count) || 0,
      user: authorized.profile.fullName,
    });
  }
  if (request.method === "PUT" && url.pathname === "/v1/archive/record") {
    return handlePutRecord(request, env, authorized);
  }
  if (request.method === "POST" && url.pathname === "/v1/archive/batch") {
    return handleBatch(request, env, authorized);
  }
  if (request.method === "GET" && url.pathname === "/v1/archive/record") {
    return handleGetRecord(request, env);
  }
  if (request.method === "GET" && url.pathname === "/v1/archive/range") {
    return handleGetRange(request, env);
  }
  if (request.method === "GET" && url.pathname === "/v1/archive/revisions") {
    return handleGetRevisions(request, env);
  }

  throw new HttpError(404, "Archive endpoint not found.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError
        ? error.message
        : "The archive service encountered an unexpected error.";
      console.error(JSON.stringify({
        message: "archive_request_failed",
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        error: error instanceof Error ? error.message : String(error),
      }));
      return jsonResponse(request, env, { ok: false, error: message }, status);
    }
  },
} satisfies ExportedHandler<Env>;
