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
    // 2. Hash IP client an toàn bằng SHA-256 + Server Pepper (KHÔNG lưu IP thô)
    const rawClientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown_ip';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, message: 'Cấu hình Server Env chưa hoàn tất.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const encoder = new TextEncoder();
    const pepper = supabaseServiceKey.slice(0, 32);
    const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(rawClientIp + pepper));
    const ipHashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    const ipIdentifier = `ip:${ipHashHex}`;

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

    const codeIdentifier = `code:${cleanCode}`;

    // Khởi tạo Supabase Admin Client bằng Service Role Key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Tìm học sinh trong public.profiles theo student_code chính thức
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('student_code', cleanCode)
      .eq('role', 'student')
      .maybeSingle();

    if (!profile || !profile.email) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Kiểm tra Auth User hiện có trong auth.users bằng Admin API
    const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(profile.id);
    if (authUserErr || !authUserData?.user || authUserData.user.id !== profile.id) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Xác minh PIN bằng RPC verify_student_pin_rate_limited trong CSDL
    const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('verify_student_pin_rate_limited', {
      p_student_id: profile.id,
      p_pin: cleanPin,
      p_code_identifier: codeIdentifier,
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

    if (rpcRes.success !== true) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Mã PIN ĐÚNG -> Tạo Magic Link token xác thực 1 lần
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: profile.email,
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      return new Response(
        JSON.stringify({ success: false, message: 'Không thể khởi tạo token xác thực cho học sinh.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hashedToken = linkData.properties.hashed_token;

    // 8. Phản hồi thành công CHỈ TRẢ VỀ token_hash
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
