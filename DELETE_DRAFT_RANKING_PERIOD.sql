-- ============================================================================
-- MIGRATION: DELETE_DRAFT_RANKING_PERIOD.sql
-- Chức năng: Cho phép Giáo viên phụ trách lớp hoặc Admin xóa an toàn một kỳ DRAFT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_draft_ranking_period(
  p_period_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period RECORD;
BEGIN
  -- 1. Đọc và khóa bản ghi kỳ xếp hạng (SELECT FOR UPDATE)
  SELECT * INTO v_period 
  FROM public.ranking_periods 
  WHERE id = p_period_id 
  FOR UPDATE;

  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'NOT_FOUND',
      'message', 'Không tìm thấy kỳ xếp hạng cần xóa.'
    );
  END IF;

  -- 2. Kiểm tra phân quyền quản lý lớp (Admin hoặc Giáo viên phụ trách lớp)
  IF NOT app_private.can_manage_class(v_period.class_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'FORBIDDEN',
      'message', 'Từ chối: Bạn không có quyền xóa kỳ xếp hạng của lớp này.'
    );
  END IF;

  -- 3. Khóa trạng thái: Tuyệt đối chỉ cho phép xóa kỳ ở trạng thái 'DRAFT'
  IF v_period.status <> 'DRAFT' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'INVALID_STATUS',
      'message', 'Chỉ có thể xóa kỳ xếp hạng ở trạng thái Bản nháp (DRAFT). Không thể xóa kỳ đang diễn ra hoặc đã đóng.'
    );
  END IF;

  -- 4. Thực hiện xóa bản ghi DRAFT
  DELETE FROM public.ranking_periods WHERE id = p_period_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'DELETED',
    'message', 'Đã xóa bản nháp kỳ xếp hạng thành công.',
    'period_id', p_period_id
  );
END;
$$;

-- Thu hồi quyền từ PUBLIC và cấp quyền thực thi cho authenticated
REVOKE ALL ON FUNCTION public.delete_draft_ranking_period(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_draft_ranking_period(UUID) TO authenticated;
