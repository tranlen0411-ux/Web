import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, message: 'Chưa đăng nhập.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // 1. Xác thực Caller bằng Anon Key + User JWT
    const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerError } = await supabaseCaller.auth.getUser();
    if (callerError || !caller) {
      return new Response(JSON.stringify({ success: false, message: 'Phiên làm việc hết hạn.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Tạo Admin Client sử dụng Service Role Key (Server-side)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Kiểm tra vai trò Admin của Caller từ public.profiles
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (callerProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ success: false, message: 'Từ chối truy cập: Chỉ Admin mới có quyền tạo tài khoản.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Lấy thông tin đầu vào
    const { email, password, fullName, role, gradeLevel } = await req.json();

    if (!email || !password || !fullName) {
      return new Response(JSON.stringify({ success: false, message: 'Thiếu thông tin bắt buộc.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const targetRole = role === 'teacher' ? 'teacher' : 'student';
    const targetGrade = parseInt(gradeLevel) || 1;

    // 5. Tạo Auth User bằng Supabase Admin API
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName.trim(),
        role: targetRole,
        grade_level: targetGrade,
      },
    });

    if (createError) {
      return new Response(JSON.stringify({ success: false, message: createError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newUserId = authData.user.id;

    // 6. Đợi Trigger handle_new_user() xong và cập nhật vai trò / khối lớp chính xác
    await new Promise((res) => setTimeout(res, 500));

    await supabaseAdmin
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        role: targetRole,
        grade_level: targetGrade,
        is_disabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', newUserId);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Tạo tài khoản mới thành công!',
        user: authData.user,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, message: err.message || 'Lỗi server-side.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
