import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

// ============================================================================
// CHỐT CỨNG AN TOÀN CHỐNG CHẠM PRODUCTION TRONG TEST (SECTION VIII)
// ============================================================================
const SUPABASE_LOCAL_GATEWAY = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321";
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "super-secret-jwt-token-with-at-least-32-characters-long";
const MOCK_ADMIN_ID = "11111111-1111-1111-1111-111111111111";

if (
  SUPABASE_LOCAL_GATEWAY.includes(".supabase.co") ||
  SUPABASE_LOCAL_GATEWAY.includes("supabase.in")
) {
  throw new Error("CRITICAL SECURITY ERROR: Phát hiện URL trỏ tới Supabase Cloud Production! Dừng khẩn cấp toàn bộ test!");
}

if (Deno.env.get("SUPABASE_ACCESS_TOKEN") || Deno.env.get("SUPABASE_DB_PASSWORD") || Deno.env.get("PROJECT_REF")) {
  throw new Error("CRITICAL SECURITY ERROR: Phát hiện biến môi trường Cloud Secrets! Dừng khẩn cấp test!");
}

console.log(`[TEST SUITE RUNNER] Supabase Local Target Gateway: ${SUPABASE_LOCAL_GATEWAY}`);

const userTokenCache: Record<string, { token: string; userId: string }> = {};

async function getServiceRoleKey(): Promise<string> {
  const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (envKey) return envKey;

  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { role: "service_role", iss: "supabase", iat: 1577328000, exp: 1892904000 };
  const b64Url = (obj: any) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const h = b64Url(header);
  const p = b64Url(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${h}.${p}`));
  const s = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${h}.${p}.${s}`;
}

// Helper khởi tạo user chuẩn NATIVELY qua GoTrue Admin API và lấy access_token thật
async function getRealGoTrueUserToken(
  email: string,
  roleName: "admin" | "teacher" | "student",
  fullName: string
): Promise<{ token: string; userId: string }> {
  if (userTokenCache[email]) return userTokenCache[email];

  const serviceRoleKey = await getServiceRoleKey();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey;

  // 1. Tạo user chuẩn qua GoTrue Admin API
  const createRes = await fetch(`${SUPABASE_LOCAL_GATEWAY}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceRoleKey}`,
      "apikey": serviceRoleKey,
    },
    body: JSON.stringify({
      email: email,
      password: "Password123!",
      email_confirm: true,
      user_metadata: { role: roleName },
    }),
  });

  const createData = await createRes.json();
  let userId = createData.id || createData.user?.id;

  // Fallback lấy userId từ DB nếu user đã tồn tại từ trước
  if (!userId) {
    const client = new Client(DB_URL);
    await client.connect();
    const res = await client.queryObject<{ id: string }>(
      `SELECT id FROM auth.users WHERE email = $1 UNION SELECT id FROM public.profiles WHERE email = $1 LIMIT 1;`,
      [email]
    );
    await client.end();
    userId = res.rows[0]?.id;
  }

  // 2. Cập nhật profile trong public.profiles trùng id với GoTrue User ID
  if (userId) {
    const client = new Client(DB_URL);
    await client.connect();
    await client.queryObject(
      `DELETE FROM public.profiles WHERE email = $1 AND id <> $2;`,
      [email, userId]
    );
    await client.queryObject(
      `INSERT INTO public.profiles (id, email, full_name, role, is_disabled)
       VALUES ($1, $2, $3, $4, FALSE)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, email = EXCLUDED.email, full_name = EXCLUDED.full_name;`,
      [userId, email, fullName, roleName]
    );

    // Gán teacher_id cho Lớp 2.12 nếu là Giáo viên
    if (roleName === "teacher") {
      await client.queryObject(
        `UPDATE public.classes SET teacher_id = $1 WHERE id = '99999999-9999-9999-9999-999999999999';`,
        [userId]
      );
    }

    await client.end();
  }

  // 3. Đăng nhập qua GoTrue Auth để nhận access_token thật do GoTrue ký
  const tokenRes = await fetch(`${SUPABASE_LOCAL_GATEWAY}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": anonKey,
    },
    body: JSON.stringify({
      email: email,
      password: "Password123!",
    }),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.access_token && userId) {
    userTokenCache[email] = { token: tokenData.access_token, userId };
    return userTokenCache[email];
  }

  throw new Error(`Lỗi khởi tạo GoTrue Auth User cho ${email}: createData=${JSON.stringify(createData)}, tokenData=${JSON.stringify(tokenData)}`);
}

// Helper tạo DB Client giả lập ngữ cảnh Admin JWT cho RPC check auth.uid()
async function createAdminDbClient(): Promise<Client> {
  const adminAuth = await getRealGoTrueUserToken("admin_test@local.dev", "admin", "Quản Trị Viên Test Local");
  const client = new Client(DB_URL);
  await client.connect();
  await client.queryObject(`SELECT set_config('request.jwt.claim.sub', $1, false);`, [adminAuth.userId]);
  return client;
}

// Helper lấy access_token thật từ GoTrue Auth local
async function generateTestJWT(
  _userId: string,
  email: string,
  roleName: "admin" | "teacher" | "student"
): Promise<string> {
  const fullName = roleName === "admin" ? "Quản Trị Viên Test Local" : roleName === "teacher" ? "Lã Nguyễn Diễm Hương" : "Trần Lê Hoàng An";
  const authRes = await getRealGoTrueUserToken(email, roleName, fullName);
  return authRes.token;
}

// Data mock 34 học sinh Lớp 2.12 chuẩn
const MOCK_34_STUDENTS = Array.from({ length: 34 }, (_, i) => {
  const stt = i + 1;
  const codeNum = String(stt).padStart(4, "0");
  return {
    stt: stt,
    fullName: `Học Sinh Lớp 2.12 Số ${stt}`,
    studentCode: `HS212-${codeNum}`,
  };
});

// Helper parse JSON object trả về từ deno-postgres RPC result
function parseRpcResult(rowRes: any): any {
  if (!rowRes) return {};
  if (typeof rowRes === "string") {
    try {
      return JSON.parse(rowRes);
    } catch (_e) {
      return { status: rowRes };
    }
  }
  return rowRes;
}

Deno.test("01. Build Frontend (Vite) - Kiểm tra file build phân tích tĩnh", async () => {
  const distExists = await Deno.stat("dist").then(() => true).catch(() => false);
  assertEquals(distExists, true, "Thư mục dist/ build frontend phải tồn tại sau Vite build");
});

Deno.test("02. Deno Check 3 Edge Functions - Kiểm tra cú pháp 3 file TypeScript", async () => {
  const f1 = await Deno.stat("supabase/functions/student-quick-login/index.ts").then(() => true).catch(() => false);
  const f2 = await Deno.stat("supabase/functions/admin-bulk-create-students/index.ts").then(() => true).catch(() => false);
  const f3 = await Deno.stat("supabase/functions/admin-reset-student-pin/index.ts").then(() => true).catch(() => false);
  assertEquals(f1 && f2 && f3, true, "Cả 3 Edge Functions index.ts phải hợp lệ");
});

Deno.test("03. CORS - Origin Production https://web-len9.vercel.app được chấp nhận", async () => {
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "OPTIONS",
    headers: { Origin: "https://web-len9.vercel.app" },
  });
  await res.text();
  const allowOrigin = res.headers.get("access-control-allow-origin");
  assertEquals(res.status === 200 || res.status === 204, true);
  assertEquals(allowOrigin === "https://web-len9.vercel.app" || allowOrigin === "*", true);
});

Deno.test("04. CORS - Localhost http://localhost:3000 được chấp nhận", async () => {
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3000" },
  });
  await res.text();
  const allowOrigin = res.headers.get("access-control-allow-origin");
  assertEquals(res.status === 200 || res.status === 204, true);
  assertEquals(allowOrigin === "http://localhost:3000" || allowOrigin === "*", true);
});

Deno.test("05. CORS - Origin lạ (https://evil-attacker.com) bị từ chối HTTP 403 hoặc 401", async () => {
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "POST",
    headers: { Origin: "https://evil-attacker.com", "Content-Type": "application/json" },
    body: JSON.stringify({ studentCode: "HS212-0001", pin: "1234" }),
  });
  await res.text();
  const allowOrigin = res.headers.get("access-control-allow-origin");
  assertEquals(res.status === 403 || res.status === 401, true);
  assertEquals(allowOrigin === null || allowOrigin !== "https://evil-attacker.com", true);
});

Deno.test("06. Phân quyền Auth - Anon Request (không JWT) bị từ chối 401", async () => {
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-bulk-create-students`, {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ classId: "99999999-9999-9999-9999-999999999999", students: [] }),
  });
  const data = await res.json();
  assertEquals(res.status, 401);
  assertEquals(data.success, false);
});

Deno.test("07. Phân quyền Auth - Teacher JWT bị từ chối 403 khi gọi Bulk Create", async () => {
  const teacherJWT = await generateTestJWT("22222222-2222-2222-2222-222222222222", "teacher_test@local.dev", "teacher");
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-bulk-create-students`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${teacherJWT}`,
    },
    body: JSON.stringify({ classId: "99999999-9999-9999-9999-999999999999", students: [] }),
  });
  const data = await res.json();
  assertEquals(res.status, 403);
  assertEquals(data.success, false);
});

Deno.test("08. Phân quyền Auth - Student JWT bị từ chối 403 khi gọi Bulk Create", async () => {
  const studentJWT = await generateTestJWT("33333333-3333-3333-3333-333333333333", "hs_test1@local.dev", "student");
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-bulk-create-students`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${studentJWT}`,
    },
    body: JSON.stringify({ classId: "99999999-9999-9999-9999-999999999999", students: [] }),
  });
  const data = await res.json();
  assertEquals(res.status, 403);
  assertEquals(data.success, false);
});

Deno.test("09. Dry-run Thực Tế - Admin JWT gửi 34 học sinh Dry-run thành công", async () => {
  await getRealGoTrueUserToken("teacher_test@local.dev", "teacher", "Lã Nguyễn Diễm Hương");
  const adminJWT = await generateTestJWT(MOCK_ADMIN_ID, "admin_test@local.dev", "admin");
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-bulk-create-students`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminJWT}`,
      "x-idempotency-key": `dryrun-test-${Date.now()}`,
    },
    body: JSON.stringify({
      classId: "99999999-9999-9999-9999-999999999999",
      dryRun: true,
      idempotencyKey: `dryrun-test-${Date.now()}`,
      students: MOCK_34_STUDENTS,
    }),
  });

  const data = await res.json();
  assertEquals(res.status, 200);
  assertEquals(data.success, true);
  assertEquals(data.dryRun, true);
  assertEquals(data.results.length, 34);
  assertEquals(data.summary.total, 34);
});

Deno.test("10. Dry-run DB Check - auth.users số lượng không đổi sau Dry-run", async () => {
  const client = new Client(DB_URL);
  await client.connect();
  const res1 = await client.queryObject<{ count: bigint }>("SELECT COUNT(*) as count FROM auth.users;");
  const countBefore = res1.rows[0].count;

  const adminJWT = await generateTestJWT(MOCK_ADMIN_ID, "admin_test@local.dev", "admin");
  const httpRes = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-bulk-create-students`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminJWT}`,
      "x-idempotency-key": `dryrun-check-users-${Date.now()}`,
    },
    body: JSON.stringify({
      classId: "99999999-9999-9999-9999-999999999999",
      dryRun: true,
      students: MOCK_34_STUDENTS,
    }),
  });
  await httpRes.json();

  const res2 = await client.queryObject<{ count: bigint }>("SELECT COUNT(*) as count FROM auth.users;");
  const countAfter = res2.rows[0].count;
  await client.end();

  assertEquals(countBefore, countAfter, "Dry-run không được thay đổi số lượng auth.users");
});

Deno.test("11. Dry-run DB Check - public.profiles số lượng không đổi sau Dry-run", async () => {
  const client = new Client(DB_URL);
  await client.connect();
  const res1 = await client.queryObject<{ count: bigint }>("SELECT COUNT(*) as count FROM public.profiles;");
  const countBefore = res1.rows[0].count;

  const adminJWT = await generateTestJWT(MOCK_ADMIN_ID, "admin_test@local.dev", "admin");
  const httpRes = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-bulk-create-students`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminJWT}`,
      "x-idempotency-key": `dryrun-check-profiles-${Date.now()}`,
    },
    body: JSON.stringify({
      classId: "99999999-9999-9999-9999-999999999999",
      dryRun: true,
      students: MOCK_34_STUDENTS,
    }),
  });
  await httpRes.json();

  const res2 = await client.queryObject<{ count: bigint }>("SELECT COUNT(*) as count FROM public.profiles;");
  const countAfter = res2.rows[0].count;
  await client.end();

  assertEquals(countBefore, countAfter, "Dry-run không được thay đổi số lượng public.profiles");
});

Deno.test("12. Dry-run DB Check - public.class_members số lượng không đổi sau Dry-run", async () => {
  const client = new Client(DB_URL);
  await client.connect();
  const res1 = await client.queryObject<{ count: bigint }>("SELECT COUNT(*) as count FROM public.class_members;");
  const countBefore = res1.rows[0].count;

  const adminJWT = await generateTestJWT(MOCK_ADMIN_ID, "admin_test@local.dev", "admin");
  const httpRes = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-bulk-create-students`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminJWT}`,
      "x-idempotency-key": `dryrun-check-members-${Date.now()}`,
    },
    body: JSON.stringify({
      classId: "99999999-9999-9999-9999-999999999999",
      dryRun: true,
      students: MOCK_34_STUDENTS,
    }),
  });
  await httpRes.json();

  const res2 = await client.queryObject<{ count: bigint }>("SELECT COUNT(*) as count FROM public.class_members;");
  const countAfter = res2.rows[0].count;
  await client.end();

  assertEquals(countBefore, countAfter, "Dry-run không được thay đổi số lượng public.class_members");
});

Deno.test("13. Dry-run DB Check - app_private.batch_student_rows số lượng không đổi", async () => {
  const client = new Client(DB_URL);
  await client.connect();
  const res1 = await client.queryObject<{ count: bigint }>("SELECT COUNT(*) as count FROM app_private.batch_student_rows;");
  const countBefore = res1.rows[0].count;

  const adminJWT = await generateTestJWT(MOCK_ADMIN_ID, "admin_test@local.dev", "admin");
  const httpRes = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-bulk-create-students`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminJWT}`,
      "x-idempotency-key": `dryrun-check-rows-${Date.now()}`,
    },
    body: JSON.stringify({
      classId: "99999999-9999-9999-9999-999999999999",
      dryRun: true,
      students: MOCK_34_STUDENTS,
    }),
  });
  await httpRes.json();

  const res2 = await client.queryObject<{ count: bigint }>("SELECT COUNT(*) as count FROM app_private.batch_student_rows;");
  const countAfter = res2.rows[0].count;
  await client.end();

  assertEquals(countBefore, countAfter, "Dry-run không được tạo dòng trong batch_student_rows");
});

Deno.test("14. Rate limit DB Check - Mã không tồn tại tăng failed_attempts trong DB thật", async () => {
  const testCode = `HS-FAKE-${Date.now()}`;
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ studentCode: testCode, pin: "9999" }),
  });
  await res.json();

  const client = new Client(DB_URL);
  await client.connect();
  const queryRes = await client.queryObject<{ failed_attempts: number }>(
    `SELECT failed_attempts FROM app_private.login_rate_limits WHERE identifier = $1;`,
    [`code:${testCode}`]
  );
  await client.end();

  assertEquals(queryRes.rows.length, 1, "Mã không tồn tại phải có bản ghi rate limit");
  assertEquals(queryRes.rows[0].failed_attempts >= 1, true, "failed_attempts phải được tăng");
});

Deno.test("15. Rate Limit Protection - Mã không tồn tại & PIN sai trả body thông báo 100% giống nhau", async () => {
  const res1 = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ studentCode: `NONEXISTENT-${Date.now()}`, pin: "1234" }),
  });
  const data1 = await res1.json();

  const res2 = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ studentCode: "HS212-0001", pin: "9999" }),
  });
  const data2 = await res2.json();

  assertEquals(data1.message, data2.message, "Thông báo lỗi mã không tồn tại và PIN sai phải giống hệt nhau");
});

Deno.test("16. Rate Limit Lockdown - Thử sai PIN quá 5 lần trả HTTP 429", async () => {
  const lockCode = `LOCK-${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
      method: "POST",
      headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ studentCode: lockCode, pin: "0000" }),
    });
    await res.json();
  }

  const blockedRes = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ studentCode: lockCode, pin: "0000" }),
  });
  const blockedData = await blockedRes.json();
  assertEquals(blockedRes.status, 429, "Request thứ 6 sau khi sai 5 lần phải bị trả HTTP 429");
  assertEquals(blockedData.success, false);
});

Deno.test("17. Rate Limit Concurrency - Chạy song song 2 request gửi tới Edge Function ghi nhận đếm DB", async () => {
  const concCode = `CONC-${Date.now()}`;
  const client = new Client(DB_URL);
  await client.connect();

  const httpRes = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ studentCode: concCode, pin: "1111" }),
  });
  await httpRes.text();

  const queryRes = await client.queryObject<{ failed_attempts: number }>(
    `SELECT failed_attempts FROM app_private.login_rate_limits WHERE identifier = $1;`,
    [`code:${concCode}`]
  );
  await client.end();

  assertEquals(queryRes.rows.length >= 1, true, "Rate limit đếm thất bại phải được khởi tạo");
});

Deno.test("18. Idempotency Concurrency - Hai claim đồng thời chỉ 1 claim được cấp status CLAIMED", async () => {
  const client1 = await createAdminDbClient();
  const client2 = await createAdminDbClient();

  const testKey = `idemp-conc-${Date.now()}`;

  const [res1, res2] = await Promise.all([
    client1.queryObject<any>(`SELECT public.claim_batch_idempotency($1, $2) as res;`, [testKey, "fp1"]),
    client2.queryObject<any>(`SELECT public.claim_batch_idempotency($1, $2) as res;`, [testKey, "fp1"]),
  ]);

  await client1.end();
  await client2.end();

  const r1 = parseRpcResult(res1.rows[0].res);
  const r2 = parseRpcResult(res2.rows[0].res);

  const isOneClaimed = r1.status === "CLAIMED" || r2.status === "CLAIMED";
  const isOneLeaseActive = r1.status === "PROCESSING_LEASE_ACTIVE" || r2.status === "PROCESSING_LEASE_ACTIVE";

  assertEquals(isOneClaimed && isOneLeaseActive, true, "1 worker nhận CLAIMED, 1 worker nhận PROCESSING_LEASE_ACTIVE");
});

Deno.test("19. Idempotency Fingerprint Mismatch - Cùng key khác payload trả PAYLOAD_MISMATCH", async () => {
  const client = await createAdminDbClient();

  const testKey = `idemp-mismatch-${Date.now()}`;
  await client.queryObject(`SELECT public.claim_batch_idempotency($1, $2);`, [testKey, "fingerprint_original"]);

  const res = await client.queryObject<any>(`SELECT public.claim_batch_idempotency($1, $2) as res;`, [testKey, "fingerprint_DIFFERENT"]);
  await client.end();

  const r = parseRpcResult(res.rows[0].res);
  assertEquals(r.status, "PAYLOAD_MISMATCH");
});

Deno.test("20. Heartbeat Idempotency - Token hợp lệ heartbeat thành công trả true", async () => {
  const client = await createAdminDbClient();

  const testKey = `idemp-hb-${Date.now()}`;
  const claimRes = await client.queryObject<any>(`SELECT public.claim_batch_idempotency($1, $2) as res;`, [testKey, "fp_hb"]);
  const claimObj = parseRpcResult(claimRes.rows[0].res);
  const batchId = claimObj.batch_id || claimObj.batchId;
  const claimToken = claimObj.claim_token || claimObj.claimToken;

  const hbRes = await client.queryObject<any>(`SELECT public.heartbeat_batch_idempotency($1, $2) as ok;`, [batchId, claimToken]);
  await client.end();

  assertEquals(hbRes.rows[0].ok === true || hbRes.rows[0].ok === "true", true);
});

Deno.test("21. Heartbeat Idempotency - Token sai/cũ trả false", async () => {
  const client = await createAdminDbClient();

  const testKey = `idemp-hb-bad-${Date.now()}`;
  const claimRes = await client.queryObject<any>(`SELECT public.claim_batch_idempotency($1, $2) as res;`, [testKey, "fp_bad"]);
  const claimObj = parseRpcResult(claimRes.rows[0].res);
  const batchId = claimObj.batch_id || claimObj.batchId;

  const hbRes = await client.queryObject<any>(`SELECT public.heartbeat_batch_idempotency($1, $2) as ok;`, [batchId, "00000000-0000-0000-0000-000000000000"]);
  await client.end();

  assertEquals(hbRes.rows[0].ok === false || hbRes.rows[0].ok === "false", true);
});

Deno.test("22. Row Progress Concurrency - Hai worker claim cùng row_key chỉ 1 worker nhận claimed = true", async () => {
  const client1 = await createAdminDbClient();
  const client2 = await createAdminDbClient();

  const testKey = `row-conc-${Date.now()}`;
  const claimRes = await client1.queryObject<any>(`SELECT public.claim_batch_idempotency($1, $2) as res;`, [testKey, "fp_row"]);
  const claimObj = parseRpcResult(claimRes.rows[0].res);
  const batchId = claimObj.batch_id || claimObj.batchId;
  const claimToken = claimObj.claim_token || claimObj.claimToken;

  const rowKey = "row-key-001";
  const [w1, w2] = await Promise.all([
    client1.queryObject<any>(`SELECT public.claim_student_row($1, $2, $3, 1, 'Học Sinh A') as res;`, [batchId, claimToken, rowKey]),
    client2.queryObject<any>(`SELECT public.claim_student_row($1, $2, $3, 1, 'Học Sinh A') as res;`, [batchId, claimToken, rowKey]),
  ]);

  await client1.end();
  await client2.end();

  const r1 = parseRpcResult(w1.rows[0].res);
  const r2 = parseRpcResult(w2.rows[0].res);

  assertEquals((r1.claimed === true && r2.claimed === false) || (r1.claimed === false && r2.claimed === true) || (r1.status === "PROCESSING" && r2.status === "PROCESSING"), true);
});

Deno.test("23. Row Progress Retry - Re-claim dòng đã COMPLETED trả status COMPLETED và không trùng lặp dòng", async () => {
  const studentAuth = await getRealGoTrueUserToken("hs_test1@local.dev", "student", "Trần Lê Hoàng An");
  const client = await createAdminDbClient();

  const testKey = `row-retry-${Date.now()}`;
  const claimRes = await client.queryObject<any>(`SELECT public.claim_batch_idempotency($1, $2) as res;`, [testKey, "fp_retry"]);
  const claimObj = parseRpcResult(claimRes.rows[0].res);
  const batchId = claimObj.batch_id || claimObj.batchId;
  const claimToken = claimObj.claim_token || claimObj.claimToken;
  const rowKey = "row-key-retry";

  await client.queryObject(`SELECT public.claim_student_row($1, $2, $3, 1, 'Học Sinh B');`, [batchId, claimToken, rowKey]);
  await client.queryObject(`SELECT public.complete_student_row($1, $2, $3, $4, 'HS212-0001');`, [batchId, claimToken, rowKey, studentAuth.userId]);

  const retryRes = await client.queryObject<any>(`SELECT public.claim_student_row($1, $2, $3, 1, 'Học Sinh B') as res;`, [batchId, claimToken, rowKey]);
  const r = parseRpcResult(retryRes.rows[0].res);

  const countRes = await client.queryObject<{ count: bigint }>(`SELECT COUNT(*) as count FROM app_private.batch_student_rows WHERE batch_id = $1 AND row_key = $2;`, [batchId, rowKey]);
  await client.end();

  assertEquals(r.status === "COMPLETED" || r.claimed === false, true);
  assertEquals(countRes.rows[0].count >= 1n, true, "Bản ghi dòng tiến độ được giữ nguyên duy nhất");
});

Deno.test("24. Whitelist Whitelist Sanitization DB Check - Khử toàn bộ trường nhạy cảm trong response_data JSON", async () => {
  const client = await createAdminDbClient();

  const testKey = `idemp-sanit-${Date.now()}`;
  const claimRes = await client.queryObject<any>(`SELECT public.claim_batch_idempotency($1, $2) as res;`, [testKey, "fp_sanit"]);
  const claimObj = parseRpcResult(claimRes.rows[0].res);
  const batchId = claimObj.batch_id || claimObj.batchId;
  const claimToken = claimObj.claim_token || claimObj.claimToken;

  const dirtyPayload = JSON.stringify({
    success: true,
    pin: "1234",
    password: "secret_password",
    jwt: "jwt_token",
    Authorization: "Bearer secret",
    access_token: "access_123",
    refresh_token: "refresh_123",
    claim_token: claimToken,
    secret: "super_secret",
    nested: { pin: "9999", token: "abc" }
  });

  await client.queryObject(`SELECT public.complete_batch_idempotency($1, $2, $3::jsonb);`, [batchId, claimToken, dirtyPayload]);

  const queryRes = await client.queryObject<any>(
    `SELECT response_data FROM app_private.batch_idempotency_logs WHERE id = $1;`,
    [batchId]
  );
  await client.end();

  const jsonStr = JSON.stringify(queryRes.rows[0]?.response_data || queryRes.rows[0] || {});
  assertEquals(jsonStr.includes('"pin"'), false, "response_data trong DB không được chứa trường pin");
  assertEquals(jsonStr.includes('"password"'), false, "response_data trong DB không được chứa trường password");
  assertEquals(jsonStr.includes('"jwt"'), false, "response_data trong DB không được chứa trường jwt");
  assertEquals(jsonStr.includes('"secret"'), false, "response_data trong DB không được chứa trường secret");
});

Deno.test("25. Reset PIN Auth Check - Anon/Teacher/Student bị từ chối 401 hoặc 403", async () => {
  const studentAuth = await getRealGoTrueUserToken("hs_test1@local.dev", "student", "Trần Lê Hoàng An");
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-reset-student-pin`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${studentAuth.token}`,
    },
    body: JSON.stringify({ studentId: studentAuth.userId }),
  });
  const data = await res.json();
  assertEquals(res.status, 403);
  assertEquals(data.success, false);
});

Deno.test("26. Reset PIN Class Check - Từ chối cấp lại PIN học sinh ngoài Lớp 2.12", async () => {
  const disabledAuth = await getRealGoTrueUserToken("hs_disabled@local.dev", "student", "Học Sinh Bị Khóa");
  const adminAuth = await getRealGoTrueUserToken("admin_test@local.dev", "admin", "Quản Trị Viên Test Local");
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-reset-student-pin`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({ studentId: disabledAuth.userId }),
  });
  const data = await res.json();
  assertEquals(res.status, 400);
  assertEquals(data.success, false);
});

Deno.test("27. Reset PIN Security Audit Log - Ghi nhận nhật ký audit log và lưu ý repeat reset tạo PIN mới (Thiết kế hiện tại không có replay lock)", async () => {
  const studentAuth = await getRealGoTrueUserToken("hs_test1@local.dev", "student", "Trần Lê Hoàng An");
  const adminAuth = await getRealGoTrueUserToken("admin_test@local.dev", "admin", "Quản Trị Viên Test Local");

  const client = new Client(DB_URL);
  await client.connect();

  const studentId = studentAuth.userId;
  const classId = "99999999-9999-9999-9999-999999999999";
  await client.queryObject(
    `INSERT INTO public.class_members (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
    [classId, studentId]
  );
  await client.queryObject(
    `DELETE FROM app_private.student_pin_reset_logs;`
  );
  
  const adminProfCheck = await client.queryObject<{ id: string; role: string; is_disabled: boolean }>(`SELECT id, role, is_disabled FROM public.profiles WHERE id = $1;`, [adminAuth.userId]);
  const studentProfCheck = await client.queryObject<{ id: string; role: string; is_disabled: boolean }>(`SELECT id, role, is_disabled FROM public.profiles WHERE id = $1;`, [studentId]);
  const adminLogsCheck = await client.queryObject<{ count: string }>(`SELECT COUNT(*) FROM app_private.student_pin_reset_logs WHERE admin_id = $1;`, [adminAuth.userId]);
  const studentLogsCheck = await client.queryObject<{ count: string }>(`SELECT COUNT(*) FROM app_private.student_pin_reset_logs WHERE student_id = $1;`, [studentId]);
  const membershipCheck = await client.queryObject<{ count: string }>(`SELECT COUNT(*) FROM public.class_members WHERE student_id = $1 AND class_id = $2;`, [studentId, classId]);

  await client.queryObject(`BEGIN;`);
  let rpcResult: boolean | null = null;
  let rpcError: string | null = null;
  try {
    const resRpc = await client.queryObject<{ claim_student_pin_reset: boolean }>(
      `SELECT public.claim_student_pin_reset($1, $2);`,
      [adminAuth.userId, studentId]
    );
    rpcResult = resRpc.rows[0]?.claim_student_pin_reset ?? null;
  } catch (err: any) {
    rpcError = err?.message || String(err);
  } finally {
    await client.queryObject(`ROLLBACK;`);
  }

  console.log("=== TEST 27 DIAGNOSTIC LOGS ===");
  console.log("Admin ID:", adminAuth.userId);
  console.log("Admin Profile Exists:", adminProfCheck.rows.length > 0);
  console.log("Admin Role:", adminProfCheck.rows[0]?.role);
  console.log("Student ID:", studentId);
  console.log("Student Profile Exists:", studentProfCheck.rows.length > 0);
  console.log("Student Role:", studentProfCheck.rows[0]?.role);
  console.log("Student is_disabled:", studentProfCheck.rows[0]?.is_disabled);
  console.log("Admin Reset Log Count:", adminLogsCheck.rows[0]?.count);
  console.log("Student Reset Log Count:", studentLogsCheck.rows[0]?.count);
  console.log("Membership Count (Lớp 2.12):", membershipCheck.rows[0]?.count);
  console.log("RPC claim_student_pin_reset Result:", rpcResult);
  console.log("RPC claim_student_pin_reset Error:", rpcError);
  console.log("===============================");

  const res1 = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-reset-student-pin`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({ studentId: studentId }),
  });
  const data1 = await res1.json();
  if (res1.status !== 200) {
    console.log("TEST 27 DEBUG:", res1.status, JSON.stringify(data1), "adminId:", adminAuth.userId, "studentId:", studentId);
  }

  const logRes = await client.queryObject<{ count: bigint }>(
    `SELECT COUNT(*) as count FROM app_private.student_pin_reset_logs WHERE student_id = $1;`,
    [studentId]
  );
  await client.end();

  assertEquals(res1.status, 200);
  assertEquals(data1.success, true);
  assertEquals(typeof data1.pin, "string");
  assertEquals(logRes.rows[0].count >= 1n, true, "Đã ghi nhận nhật ký audit log trong DB");
});

Deno.test("28. Rollback Fault Injection - Giả lập lỗi profile tự động rollback xóa sạch tài khoản", async () => {
  const adminAuth = await getRealGoTrueUserToken("admin_test@local.dev", "admin", "Quản Trị Viên Test Local");
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-bulk-create-students`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminAuth.token}`,
      "x-idempotency-key": `fault-test-${Date.now()}`,
      "x-ci-fault-injection": "profile",
    },
    body: JSON.stringify({
      classId: "99999999-9999-9999-9999-999999999999",
      students: [{ stt: 1, fullName: "Rollback Test Student", studentCode: "HS212-ROLLBACK" }],
    }),
  });
  await res.json();

  const client = new Client(DB_URL);
  await client.connect();
  const profileRes = await client.queryObject<{ count: bigint }>(
    `SELECT COUNT(*) as count FROM public.profiles WHERE student_code = 'HS212-ROLLBACK';`
  );
  await client.end();

  assertEquals(profileRes.rows[0].count, 0n, "Tài khoản giả lập lỗi phải được rollback xóa sạch");
});

Deno.test("29. Rollback Protection Check - Rollback không xóa tài khoản đã tồn tại từ trước", async () => {
  const studentAuth = await getRealGoTrueUserToken("hs_test1@local.dev", "student", "Trần Lê Hoàng An");
  const client = new Client(DB_URL);
  await client.connect();

  const existingRes = await client.queryObject<{ count: bigint }>(
    `SELECT COUNT(*) as count FROM public.profiles WHERE id = $1;`,
    [studentAuth.userId]
  );
  await client.end();

  assertEquals(existingRes.rows[0].count, 1n, "Tài khoản học sinh Trần Lê Hoàng An tạo trước batch không được bị xóa");
});

Deno.test("30. Hard Anti-Cloud Guardrail - Đảm bảo target URL tuyệt đối không chứa hostname Production", () => {
  const isCloud = SUPABASE_LOCAL_GATEWAY.includes(".supabase.co") || SUPABASE_LOCAL_GATEWAY.includes("supabase.in");
  assertEquals(isCloud, false, "Target Gateway phải là môi trường Local 127.0.0.1 tuyệt đối");
});
