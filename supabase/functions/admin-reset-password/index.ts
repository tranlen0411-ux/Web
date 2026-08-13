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
    const envRecoverySecret = Deno.env.get('ADMIN_RECOVERY_SECRET');

    // Khởi tạo Supabase Admin Client bằng Service Role Key (Server-side)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { targetUserId, email, newPassword, recoverySecret } = body;

    // Validate độ dài newPassword
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mật khẩu mới phải từ 6 ký tự trở lên.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Kiểm tra JWT của Caller (Long-term Admin Mode)
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

    // 2. Nếu không có Admin JWT -> Yêu cầu Emergency Recovery Secret + Đúng Admin Target
    if (!isAuthorizedAdmin) {
      const isSecretValid =
        !!envRecoverySecret &&
        typeof recoverySecret === 'string' &&
        recoverySecret.trim() === envRecoverySecret.trim();

      const isTargetValid =
        targetUserId === SYSTEM_ADMIN_ID &&
        typeof email === 'string' &&
        email.trim().toLowerCase() === SYSTEM_ADMIN_EMAIL;

      // Không đủ điều kiện đồng thời -> Trả 403 bảo mật chung, không tiết lộ nguyên nhân hỏng
      if (!isSecretValid || !isTargetValid) {
        return new Response(
          JSON.stringify({ success: false, message: 'Từ chối truy cập: Thông tin xác thực không hợp lệ.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 3. Thực hiện Đặt lại mật khẩu bằng Supabase Auth Admin API (updateUserById)
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
        message: 'Đã đặt lại mật khẩu thành công!',
        user_id: updatedUserData.user.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, message: 'Có lỗi xảy ra trong quá trình xử lý.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
