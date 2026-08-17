import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 1. CẤU HÌNH CORS EXACT WHITELIST (BÁN `*`, BÁN REFLECT TỦY Ý)
const STRICT_EXACT_ORIGINS = [
  'https://web-len9.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

const getStrictCorsHeaders = (origin: string | null) => {
  if (!origin || !STRICT_EXACT_ORIGINS.includes(origin)) {
    return null; // Từ chối origin không thuộc whitelist
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

  // Từ chối ngay nếu Origin không thuộc whitelist
  if (!corsHeaders) {
    return new Response(
      JSON.stringify({ success: false, message: 'Từ chối truy cập: Origin không thuộc danh sách được phép.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // 2. LẤY SECRET BÍ MẬT IP_HASH_PEPPER (TUYỆT ĐỐI KHÔNG FALLBACK SANG SERVICE ROLE KEY)
    const ipHashPepper = Deno.env.get('IP_HASH_PEPPER');
    if (!ipHashPepper) {
      return new Response(
        JSON.stringify({ success: false, message: 'Cấu hình Server Env IP_HASH_PEPPER chưa hoàn tất.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Quy tắc lấy IP từ Supabase Gateway Header chính thức (x-real-ip / cf-connecting-ip)
    // Nếu không có header gateway đáng tin cậy -> Đặt null (không dùng chuỗi cố định tránh khóa chung)
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

    // 3. Đọc dữ liệu studentCode + pin
    let body: any = {};
    try {
      body = await req.json();
    } catch (_e) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { studentCode, pin } = body;

    if (!studentCode || typeof studentCode !== 'string' || !pin || typeof pin !== 'string') {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanCode = studentCode.trim().toUpperCase();
    const cleanPin = pin.trim();

    if (!cleanCode || !cleanPin || !/^[0-9]{4,6}$/.test(cleanPin)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, message: 'Cấu hình Server Env chưa hoàn tất.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Khởi tạo Supabase Admin Client bằng Service Role Key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 4. XÁC MINH MÃ HỌC SINH + PIN HASH BẰNG RPC NGUYÊN TỬ CÓ RATE LIMIT KỂ CẢ KHI MÃ CHƯA TỒN TẠI
    const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('verify_student_pin_rate_limited', {
      p_student_code: cleanCode,
      p_pin: cleanPin,
      p_ip_identifier: ipIdentifier,
    });

    if (rpcErr || !rpcRes) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (rpcRes.reason === 'BLOCKED') {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ. Vui lòng thử lại sau.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (rpcRes.success !== true || !rpcRes.student_id || !rpcRes.email) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const studentId = rpcRes.student_id;
    const studentEmail = rpcRes.email;

    // 5. Kiểm tra Auth User trong auth.users bằng Admin API
    const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(studentId);
    if (authUserErr || !authUserData?.user || authUserData.user.id !== studentId) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Mã PIN ĐÚNG -> Tạo Magic Link token xác thực 1 lần bằng Supabase Auth Admin API
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: studentEmail,
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      return new Response(
        JSON.stringify({ success: false, message: 'Không thể khởi tạo token xác thực cho học sinh.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hashedToken = linkData.properties.hashed_token;

    // 7. Phản hồi thành công CHỈ TRẢ VỀ token_hash với header Cache-Control no-store
    return new Response(
      JSON.stringify({
        success: true,
        token_hash: hashedToken,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
