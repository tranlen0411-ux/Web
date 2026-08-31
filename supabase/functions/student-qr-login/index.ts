import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 1. CẤU HÌNH CORS CHẶT CHẼ — BẮT BUỘC TỪ BIẾN MÔI TRƯỜNG ALLOWED_ORIGINS (FAIL CLOSED)
// Tuyệt đối không hard-code origin (Production/Preview/localhost) trong source code
const getAllowedOrigins = (): string[] => {
  const rawEnv = Deno.env.get('ALLOWED_ORIGINS');
  if (!rawEnv || typeof rawEnv !== 'string') {
    return [];
  }
  return rawEnv
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter((s) => s.length > 0);
};

const getStrictCorsHeaders = (origin: string | null) => {
  if (!origin) return null;
  const cleanOrigin = origin.trim().replace(/\/$/, '');
  const allowedOrigins = getAllowedOrigins();

  // FAIL CLOSED: Nếu env ALLOWED_ORIGINS bị thiếu, rỗng hoặc origin không khớp exact -> Từ chối
  if (allowedOrigins.length === 0 || !allowedOrigins.includes(cleanOrigin)) {
    return null;
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };
};

serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getStrictCorsHeaders(origin);

  // Từ chối ngay nếu Origin không thuộc allowlist hoặc env chưa cấu hình
  if (!corsHeaders) {
    return new Response(
      JSON.stringify({ success: false, message: 'Từ chối truy cập: Origin không thuộc danh sách được phép.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, message: 'Phương thức không được hỗ trợ.' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // 2. LẤY SECRET BÍ MẬT IP_HASH_PEPPER ĐỂ ẨN DANH HÓA IP
    const ipHashPepper = Deno.env.get('IP_HASH_PEPPER');
    if (!ipHashPepper) {
      return new Response(
        JSON.stringify({ success: false, message: 'Không thể đăng nhập lúc này. Vui lòng thử lại sau.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rawGatewayIp = req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip');
    let ipIdentifier: string | null = null;

    if (rawGatewayIp) {
      const textEncoder = new TextEncoder();
      const hmacKey = await crypto.subtle.importKey(
        'raw',
        textEncoder.encode(ipHashPepper),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const signature = await crypto.subtle.sign('HMAC', hmacKey, textEncoder.encode(rawGatewayIp.trim()));
      const ipHashHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
      ipIdentifier = `ip:${ipHashHex}`;
    }

    // 3. Đọc dữ liệu qrId + pin từ body
    let body: any = {};
    try {
      body = await req.json();
    } catch (_e) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã QR hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { qrId, pin } = body;

    if (!qrId || typeof qrId !== 'string' || !pin || typeof pin !== 'string') {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã QR hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanQrId = qrId.trim();
    const cleanPin = pin.trim();

    // Validate định dạng nghiêm ngặt: qrId bắt buộc theo chuẩn qr_sec_ + 64 ký tự hex thường; pin 4-6 chữ số
    if (!cleanQrId || !cleanPin || !/^qr_sec_[0-9a-f]{64}$/.test(cleanQrId) || !/^[0-9]{4,6}$/.test(cleanPin)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã QR hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. BĂM SHA-256 RAW QR_ID SERVER-SIDE
    const textEncoder = new TextEncoder();
    const qrHashBuffer = await crypto.subtle.digest('SHA-256', textEncoder.encode(cleanQrId));
    const qrIdHash = Array.from(new Uint8Array(qrHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, message: 'Không thể đăng nhập lúc này. Vui lòng thử lại sau.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 5. XÁC THỰC NGUYÊN TỬ QUA RPC public.verify_student_qr_and_pin_rate_limited (SERVER-ONLY)
    const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('verify_student_qr_and_pin_rate_limited', {
      p_qr_id_hash: qrIdHash,
      p_pin: cleanPin,
      p_ip_identifier: ipIdentifier,
    });

    if (rpcErr || !rpcRes) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã QR hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (rpcRes.reason === 'BLOCKED') {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã QR hoặc PIN không hợp lệ. Vui lòng thử lại sau.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (rpcRes.success !== true || !rpcRes.student_id || !rpcRes.email) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã QR hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const studentId = rpcRes.student_id;
    const studentEmail = rpcRes.email;

    // 6. Kiểm tra tài khoản trong auth.users
    const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(studentId);
    if (authUserErr || !authUserData?.user || authUserData.user.id !== studentId) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã QR hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Tạo Magic Link token 1 lần
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: studentEmail,
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      return new Response(
        JSON.stringify({ success: false, message: 'Không thể đăng nhập lúc này. Vui lòng thử lại sau.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hashedToken = linkData.properties.hashed_token;

    // 8. Trả về token_hash với header Cache-Control no-store
    return new Response(
      JSON.stringify({
        success: true,
        token_hash: hashedToken,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (_err: any) {
    return new Response(
      JSON.stringify({ success: false, message: 'Không thể đăng nhập lúc này. Vui lòng thử lại sau.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
