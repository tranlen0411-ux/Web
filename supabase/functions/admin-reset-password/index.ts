import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_ADMIN_ID = 'a0000000-0000-0000-0000-000000000001';
const SYSTEM_ADMIN_EMAIL = 'admin@hoclapvui.edu.vn';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Khởi tạo Supabase Admin Client bằng Service Role Key (Server-side)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { targetUserId, newPassword } = await req.json();

    if (!targetUserId || !newPassword) {
      return new Response(
        JSON.stringify({ success: false, message: 'Thiếu ID người dùng hoặc mật khẩu mới.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mật khẩu mới phải từ 6 ký tự trở lên.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Kiểm tra quyền hạn của Caller
    const authHeader = req.headers.get('Authorization');
    let isAuthorizedAdmin = false;

    if (authHeader) {
      const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: caller } } = await supabaseCaller.auth.getUser();

      if (caller) {
        const { data: callerProfile } = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('id', caller.id)
          .single();

        if (callerProfile?.role === 'admin') {
          isAuthorizedAdmin = true;
        }
      }
    }

    // Nếu không có Admin JWT, chỉ cho phép đặt lại mật khẩu đúng cho duy nhất tài khoản Admin hệ thống (Recovery Mode)
    if (!isAuthorizedAdmin) {
      if (targetUserId !== SYSTEM_ADMIN_ID) {
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Từ chối truy cập: Chỉ Quản trị viên mới có quyền đặt lại mật khẩu cho các tài khoản khác.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Xác minh lại thông tin tài khoản Admin hệ thống trong Auth
      const { data: targetAuthUser, error: getAuthErr } = await supabaseAdmin.auth.admin.getUserById(targetUserId);

      if (getAuthErr || !targetAuthUser?.user || targetAuthUser.user.email !== SYSTEM_ADMIN_EMAIL) {
        return new Response(
          JSON.stringify({ success: false, message: 'Tài khoản Admin hệ thống không hợp lệ.' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Thực hiện Đặt lại mật khẩu sử dụng Supabase Auth Admin API (updateUserById)
    const { data: updatedUserData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      targetUserId,
      {
        password: newPassword,
      }
    );

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, message: updateError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Đã đặt lại mật khẩu thành công cho tài khoản ${updatedUserData.user.email}!`,
        user_id: updatedUserData.user.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, message: err.message || 'Lỗi server-side.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
