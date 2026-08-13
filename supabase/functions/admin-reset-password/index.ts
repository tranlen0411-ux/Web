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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const envRecoverySecret = Deno.env.get('ADMIN_RECOVERY_SECRET');

    // Khởi tạo Supabase Admin Client bằng Service Role Key (Server-side)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { targetUserId, email, newPassword, recoverySecret } = body;

    // Validate newPassword
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mật khẩu mới phải từ 6 ký tự trở lên.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GIAI ĐOẠN 1: Bắt buộc kiểm tra đồng thời 4 điều kiện xác thực Emergency Recovery
    const isSecretValid =
      !!envRecoverySecret &&
      typeof recoverySecret === 'string' &&
      recoverySecret.trim() === envRecoverySecret.trim();

    const isTargetValid =
      targetUserId === SYSTEM_ADMIN_ID &&
      typeof email === 'string' &&
      email.trim().toLowerCase() === SYSTEM_ADMIN_EMAIL;

    // Nếu không khớp đồng thời tất cả điều kiện -> Trả 403 bảo mật chung (Không log secret hay password)
    if (!isSecretValid || !isTargetValid) {
      return new Response(
        JSON.stringify({ success: false, message: 'Từ chối truy cập: Thông tin xác thực không hợp lệ.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Thực hiện Đặt lại mật khẩu duy nhất qua Supabase Auth Admin API (updateUserById)
    const { data: updatedUserData, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      SYSTEM_ADMIN_ID,
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
        message: 'Đã đặt lại mật khẩu Admin hệ thống thành công!',
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
