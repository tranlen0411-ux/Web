import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Rate Limiter trong bộ nhớ cho Edge Worker instance
const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 30; // Tối đa 30 lượt tra cứu / IP
const WINDOW_MS = 60 * 1000; // Trong 1 phút

serve(async (req) => {
  // 1. Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // 2. Method Guard: Chỉ cho phép POST và OPTIONS. Từ chối GET, PUT, PATCH, DELETE...
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, message: 'Phương thức HTTP không được hỗ trợ (405 Method Not Allowed).' }),
      { 
        status: 405, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Allow': 'POST, OPTIONS'
        } 
      }
    );
  }

  try {
    // 3. Kiểm tra Rate Limiting bảo vệ Server
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
              message: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút.',
            }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } else {
      ipRateLimitMap.set(clientIp, { count: 1, resetAt: now + WINDOW_MS });
    }

    // 4. Lấy share_token từ POST Body duy nhất (Client không được gửi share_token trong Query Params)
    let shareToken: string | null = null;
    try {
      const body = await req.json();
      shareToken = body?.share_token || body?.shareToken;
    } catch {
      return new Response(
        JSON.stringify({ success: false, message: 'Dữ liệu yêu cầu không hợp lệ (yêu cầu JSON body).' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!shareToken || typeof shareToken !== 'string' || shareToken.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, message: 'Thiếu mã liên kết chia sẻ công khai.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanToken = shareToken.trim();

    // 5. Khởi tạo Supabase Admin Client từ biến môi trường máy chủ
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, message: 'Cấu hình Server chưa hoàn tất.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 6. Tìm kiếm bài giảng: Phải có visibility = 'public' VÀ share_token khớp
    const { data: material, error: matErr } = await supabaseAdmin
      .from('learning_materials')
      .select(`
        id,
        title,
        description,
        subject,
        file_name,
        file_path,
        file_type,
        file_size,
        external_url,
        allow_download,
        visibility,
        created_at,
        classes:class_id (name),
        profiles:created_by (full_name)
      `)
      .eq('share_token', cleanToken)
      .eq('visibility', 'public')
      .maybeSingle();

    if (matErr || !material) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Tài liệu không tồn tại hoặc đã ngừng chia sẻ công khai.',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Nếu có file đính kèm trên Private Storage -> Server tạo Signed URL 300s
    let signedUrl: string | null = null;
    if (material.file_path) {
      const { data: signData, error: signErr } = await supabaseAdmin.storage
        .from('learning-materials')
        .createSignedUrl(material.file_path, 300);

      if (!signErr && signData?.signedUrl) {
        signedUrl = signData.signedUrl;
      }
    } else if (material.external_url) {
      signedUrl = material.external_url;
    }

    // 8. Trả về metadata an toàn, KHÔNG để lộ file_path, created_by UUID, class_id UUID
    const safeResponse = {
      success: true,
      data: {
        id: material.id,
        title: material.title,
        description: material.description,
        subject: material.subject,
        file_name: material.file_name,
        file_type: material.file_type,
        file_size: material.file_size,
        external_url: material.external_url,
        allow_download: material.allow_download,
        visibility: material.visibility,
        author_name: (material.profiles as any)?.full_name || 'Thầy/Cô Giáo',
        class_name: (material.classes as any)?.name || null,
        created_at: material.created_at,
        signed_url: signedUrl,
      },
    };

    return new Response(JSON.stringify(safeResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('get-public-learning-material error:', err);
    return new Response(
      JSON.stringify({ success: false, message: 'Đã xảy ra lỗi khi xử lý bài giảng công khai.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
