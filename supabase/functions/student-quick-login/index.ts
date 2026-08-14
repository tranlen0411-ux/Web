import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate Limiter phòng vệ tầng Edge Worker (Tối đa 15 lượt đăng nhập / 5 phút per IP)
const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 15;
const WINDOW_MS = 5 * 60 * 1000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Kiểm tra Rate Limiting phòng vệ brute-force theo IP
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
              message: 'Bạn đã đăng nhập quá nhiều lần. Vui lòng đợi 5 phút.',
            }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } else {
      ipRateLimitMap.set(clientIp, { count: 1, resetAt: now + WINDOW_MS });
    }

    // 2. Nhận studentCode từ request body
    const { studentCode } = await req.json();

    if (!studentCode || typeof studentCode !== 'string') {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã học sinh không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanCode = studentCode.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!cleanCode) {
      return new Response(
        JSON.stringify({ success: false, message: 'Vui lòng nhập Mã Học Sinh.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Khởi tạo Supabase Admin Client bằng Service Role Key (Bảo mật 100% ở Server-side)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Map mã học sinh sang email tương ứng
    const sampleEmails: Record<string, string> = {
      'hs101': 'hs_nam@hoclapvui.edu.vn',
      'nam': 'hs_nam@hoclapvui.edu.vn',
      'hs202': 'hs_an@hoclapvui.edu.vn',
      'an': 'hs_an@hoclapvui.edu.vn',
      'hs303': 'hs_duc@hoclapvui.edu.vn',
      'duc': 'hs_duc@hoclapvui.edu.vn',
      'hs404': 'hs_bao@hoclapvui.edu.vn',
      'bao': 'hs_bao@hoclapvui.edu.vn',
      'hs505': 'hs_mai@hoclapvui.edu.vn',
      'mai': 'hs_mai@hoclapvui.edu.vn',
    };

    let targetEmail = sampleEmails[cleanCode];

    // 4. Nếu mã chưa nằm trong bản đồ mặc định -> Tìm kiếm trong bảng public.profiles bằng Admin API
    if (!targetEmail) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name')
        .or(`email.ilike.%${cleanCode}%,full_name.ilike.%${cleanCode}%`)
        .eq('role', 'student')
        .limit(1)
        .maybeSingle();

      if (profile && profile.email) {
        targetEmail = profile.email;
      } else {
        targetEmail = `hs_${cleanCode}@hoclapvui.edu.vn`;
      }
    }

    // 5. Kiểm tra tài khoản học sinh đã tồn tại trong Auth chưa
    // Nếu chưa tồn tại -> Tạo mới bằng Admin API (email_confirm: true)
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const userExists = existingUsers?.users?.find(u => u.email?.toLowerCase() === targetEmail.toLowerCase());

    if (!userExists) {
      // Tạo Auth user chuẩn hóa ở Server-side bằng Admin API
      const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: targetEmail,
        email_confirm: true,
        user_metadata: {
          full_name: `Học Sinh (${cleanCode.toUpperCase()})`,
          role: 'student',
          grade_level: 1,
        }
      });
      if (createErr) {
        console.error('Error creating student auth user:', createErr);
      }
    }

    // 6. Tạo Magic Link / OTP xác thực 1 lần hợp lệ cho tài khoản học sinh bằng Admin API
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: targetEmail,
    });

    if (linkErr || !linkData?.properties) {
      console.error('Error generating auth link:', linkErr);
      return new Response(
        JSON.stringify({ success: false, message: 'Không thể khởi tạo token xác thực cho học sinh.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hashedToken = linkData.properties.hashed_token;
    const emailOtp = linkData.properties.email_otp;

    // 7. Trả về token_hash & email cho Frontend để xác thực Client-side qua Auth SDK (verifyOtp)
    return new Response(
      JSON.stringify({
        success: true,
        email: targetEmail,
        token_hash: hashedToken,
        email_otp: emailOtp,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('student-quick-login error:', err);
    return new Response(
      JSON.stringify({ success: false, message: err.message || 'Lỗi hệ thống đăng nhập.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
