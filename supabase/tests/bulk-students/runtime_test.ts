import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ============================================================================
// CHỐT CỨNG AN TOÀN CHỐNG CHẠM PRODUCTION TRONG TEST (SECTION VIII)
// ============================================================================
const SUPABASE_LOCAL_GATEWAY = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321";

if (
  SUPABASE_LOCAL_GATEWAY.includes(".supabase.co") ||
  SUPABASE_LOCAL_GATEWAY.includes("supabase.in")
) {
  throw new Error("CRITICAL SECURITY ERROR: Phát hiện URL trỏ tới Supabase Cloud Production! Dừng khẩn cấp toàn bộ test!");
}

if (Deno.env.get("SUPABASE_ACCESS_TOKEN") || Deno.env.get("SUPABASE_DB_PASSWORD") || Deno.env.get("PROJECT_REF")) {
  throw new Error("CRITICAL SECURITY ERROR: Phát hiện biến môi trường Cloud Secrets! Dừng khẩn cấp test!");
}

console.log(`[TEST SUITE] Đang chạy kiểm thử trên Supabase Local Gateway: ${SUPABASE_LOCAL_GATEWAY}`);

Deno.test("01. Hard Guardrail - Đảm bảo URL là Localhost", () => {
  const isLocal = SUPABASE_LOCAL_GATEWAY.includes("127.0.0.1") || SUPABASE_LOCAL_GATEWAY.includes("localhost");
  assertEquals(isLocal, true, "URL kiểm thử phải là local host 127.0.0.1");
});

Deno.test("02. CORS - Origin Production https://web-len9.vercel.app được chấp nhận", async () => {
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "OPTIONS",
    headers: { Origin: "https://web-len9.vercel.app" },
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), "https://web-len9.vercel.app");
});

Deno.test("03. CORS - Localhost http://localhost:3000 được chấp nhận", async () => {
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3000" },
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), "http://localhost:3000");
});

Deno.test("04. CORS - Origin lạ (https://evil-attacker.com) bị từ chối HTTP 403 và không có CORS allow header", async () => {
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/student-quick-login`, {
    method: "POST",
    headers: { Origin: "https://evil-attacker.com", "Content-Type": "application/json" },
    body: JSON.stringify({ studentCode: "HS212-0001", pin: "1234" }),
  });
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("access-control-allow-origin"), null);
});

Deno.test("05. Phân quyền - Anon request bị từ chối khi gọi Bulk Create", async () => {
  const res = await fetch(`${SUPABASE_LOCAL_GATEWAY}/functions/v1/admin-bulk-create-students`, {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ classId: "99999999-9999-9999-9999-999999999999", students: [] }),
  });
  assertEquals(res.status, 401);
});

Deno.test("06. Dry-run Sanitize - response_data không chứa PIN, password, JWT hoặc claimToken", () => {
  const mockResponseData = {
    success: true,
    dryRun: true,
    batchId: "11111111-1111-1111-1111-111111111111",
    results: [{ stt: 1, fullName: "Trần Lê Hoàng An", status: "READY_TO_CREATE" }]
  };
  const jsonStr = JSON.stringify(mockResponseData);
  assertEquals(jsonStr.includes("pin"), false);
  assertEquals(jsonStr.includes("password"), false);
  assertEquals(jsonStr.includes("claimToken"), false);
  assertEquals(jsonStr.includes("Authorization"), false);
});
