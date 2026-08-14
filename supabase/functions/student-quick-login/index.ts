import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Rate Limiter phòng vệ tầng Edge Worker (Best-effort trên từng instance)
const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 15;
const WINDOW_MS = 5 * 60 * 1000;

serve(async (req) => {
  // 1. Xử lý preflight CORS OPTIONS ngay đầu function với status 200 & full corsHeaders
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    // 2. Kiểm tra Rate Limiting phòng vệ brute-force theo IP (Best-effort)
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown_client';
    const now = Date.now();
    const rateData = ipRateLimitMap.get(clientIp);

    if (rateData) {
      if (now > rateData.resetAt) {
        ipRateLimitMap.set(clientIp, { count: 1, resetAt: now + WINDOW_MS });
      } else {
        rateData.count++;
        if (rateData.count > MAX_LOGIN_ATTEMPTS) {
          return new Response(
            JSON.stringify({
              success: false,
              message: 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi 5 phút.',
            }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } else {
      ipRateLimitMap.set(clientIp, { count: 1, resetAt: now + WINDOW_MS });
    }

    // 3. Đọc dữ liệu đầu vào: studentCode + pin
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

    // Yêu cầu bắt buộc cả studentCode lẫn PIN
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

    // Khởi tạo Supabase Admin Client bằng Service Role Key (Bảo mật 100% ở Server-side)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Tìm kiếm học sinh trong public.profiles theo student_code chính thức
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('student_code', cleanCode)
      .eq('role', 'student')
      .maybeSingle();

    // Nếu KHÔNG tìm thấy học sinh -> Trả thông báo lỗi chung đồng nhất (KHÔNG tự tạo user)
    if (!profile || !profile.email) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Kiểm tra Auth User hiện có trong auth.users bằng Admin API
    const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(profile.id);

    if (
      authUserErr ||
      !authUserData?.user ||
      authUserData.user.id !== profile.id ||
      authUserData.user.email?.toLowerCase() !== profile.email.toLowerCase()
    ) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Xác minh Mã PIN Server-side bằng RPC public.verify_student_pin (TUYỆT ĐỐI KHÔNG FALLBACK)
    const { data: isPinValid, error: rpcErr } = await supabaseAdmin.rpc('verify_student_pin', {
      p_student_id: profile.id,
      p_pin: cleanPin,
    });

    if (rpcErr || isPinValid !== true) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Mã PIN ĐÚNG -> Tạo Magic Link token xác thực 1 lần bằng Supabase Auth Admin API
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: profile.email,
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error('Error generating auth link:', linkErr);
      return new Response(
        JSON.stringify({ success: false, message: 'Không thể khởi tạo token xác thực cho học sinh.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hashedToken = linkData.properties.hashed_token;

    // 8. Phản hồi thành công CHỈ TRẢ VỀ token_hash (KHÔNG trả email, KHÔNG trả email_otp, KHÔNG trả PIN/service_role)
    return new Response(
      JSON.stringify({
        success: true,
        token_hash: hashedToken,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('student-quick-login error:', err);
    return new Response(
      JSON.stringify({ success: false, message: 'Mã học sinh hoặc PIN không hợp lệ.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
