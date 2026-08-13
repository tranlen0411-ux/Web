import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate Limiter Đơn giản theo IP để chống tấn công Dò Mã (Brute-force)
const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10; // Tối đa 10 lượt tra cứu
const WINDOW_MS = 5 * 60 * 1000; // Trong 5 phút

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Kiểm tra Rate Limiting chống Brute-force
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown_client';
    const now = Date.now();
    const rateData = ipRateLimitMap.get(clientIp);

    if (rateData) {
      if (now > rateData.resetAt) {
        ipRateLimitMap.set(clientIp, { count: 1, resetAt: now + WINDOW_MS });
      } else {
        rateData.count++;
        if (rateData.count > MAX_ATTEMPTS) {
          return new Response(
            JSON.stringify({
              success: false,
              message: 'Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau 5 phút để bảo mật.',
            }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } else {
      ipRateLimitMap.set(clientIp, { count: 1, resetAt: now + WINDOW_MS });
    }

    // 2. Lấy thông tin đầu vào
    const { accessCode } = await req.json();

    if (!accessCode || typeof accessCode !== 'string' || accessCode.trim().length < 3) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã tra cứu không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanCode = accessCode.trim().toUpperCase();

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Khởi tạo Supabase Admin Client bằng Service Role Key (Server-side)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Tra cứu học sinh theo parent_access_code hoặc mã mẫu quy đổi
    let studentProfile: any = null;

    // A. Tra cứu theo cột parent_access_code
    const { data: profileByAccessCode } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, grade_level, total_stars, total_coins, avatar_url, role')
      .eq('parent_access_code', cleanCode)
      .eq('role', 'student')
      .maybeSingle();

    if (profileByAccessCode) {
      studentProfile = profileByAccessCode;
    } else {
      // B. Quy đổi mã mẫu nếu CSDL chưa nạp parent_access_code (Dự phòng cho học sinh mẫu)
      const sampleParentCodes: Record<string, string> = {
        'PAR-HS101': 'hs_nam@hoclapvui.edu.vn',
        'PAR-HS202': 'hs_an@hoclapvui.edu.vn',
        'PAR-HS303': 'hs_duc@hoclapvui.edu.vn',
        'PAR-HS404': 'hs_bao@hoclapvui.edu.vn',
        'PAR-HS505': 'hs_mai@hoclapvui.edu.vn',
      };

      const mappedEmail = sampleParentCodes[cleanCode];
      if (mappedEmail) {
        const { data: mappedProfile } = await supabaseAdmin
          .from('profiles')
          .select('id, full_name, grade_level, total_stars, total_coins, avatar_url, role')
          .eq('email', mappedEmail)
          .maybeSingle();

        if (mappedProfile) studentProfile = mappedProfile;
      }
    }

    // Nếu không tìm thấy học sinh -> Trả thông báo bảo mật chung, KHÔNG tiết lộ nguyên nhân
    if (!studentProfile) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mã tra cứu không hợp lệ.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Lấy lịch sử tiến độ học tập (Giới hạn tối đa 10 bản ghi gần nhất)
    const { data: rawProgress } = await supabaseAdmin
      .from('student_progress')
      .select('score, stars_earned, completed_at, games(title, subject)')
      .eq('student_id', studentProfile.id)
      .order('completed_at', { ascending: false })
      .limit(10);

    // 5. Lấy danh sách huy hiệu
    const { data: rawBadges } = await supabaseAdmin
      .from('student_badges')
      .select('earned_at, badges(title, icon_url, description)')
      .eq('student_id', studentProfile.id);

    // 6. Lọc sạch dữ liệu trước khi trả về cho Frontend (Bảo vệ thông tin cá nhân)
    const sanitizedProgress = (rawProgress || []).map((p: any) => ({
      gameTitle: p.games?.title || 'Bài tập học tập',
      subject: p.games?.subject || 'Tổng hợp',
      score: p.score || 0,
      starsEarned: p.stars_earned || 0,
      completedAt: p.completed_at,
    }));

    const sanitizedBadges = (rawBadges || []).map((b: any) => ({
      title: b.badges?.title || 'Huy hiệu thành tích',
      iconUrl: b.badges?.icon_url || '🏅',
      description: b.badges?.description || 'Hoàn thành bài học',
      earnedAt: b.earned_at,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        student: {
          fullName: studentProfile.full_name,
          gradeLevel: studentProfile.grade_level || 1,
          totalStars: studentProfile.total_stars || 0,
          totalCoins: studentProfile.total_coins || 0,
          avatarUrl: studentProfile.avatar_url,
        },
        recentProgress: sanitizedProgress,
        badges: sanitizedBadges,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, message: 'Mã tra cứu không hợp lệ.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
