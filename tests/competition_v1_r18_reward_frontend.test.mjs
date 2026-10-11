import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hostPageContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const studentPageContent = fs.readFileSync('src/pages/CompetitionStudentPage.jsx', 'utf8');
const clientServiceContent = fs.readFileSync('src/services/competitionClient.js', 'utf8');

test('COMPETITION V1 R18 – REWARD FRONTEND IMPLEMENTATION TEST SUITE', async (t) => {

  // =========================================================================
  // GROUP 1: PHẦN A – HOST TẠO PHÒNG & THIẾT LẬP THƯỞNG SAO
  // =========================================================================
  await t.test('Group 1: Phần A – Host Setup & Creation Rules', async (t) => {
    // 1. Reward mặc định OFF
    await t.test('1. rewardEnabled state mặc định là false', () => {
      assert.ok(
        hostPageContent.includes("const [rewardEnabled, setRewardEnabled] = useState(false);"),
        'rewardEnabled state phải khởi tạo mặc định là false'
      );
    });

    // 2. Có công tắc Bật/Tắt trao thưởng
    await t.test('2. Giao diện có công tắc Bật/Tắt trao thưởng sao', () => {
      assert.ok(
        hostPageContent.includes('Thưởng sao tích lũy (Reward System)'),
        'Phải có tiêu đề công tắc trao thưởng sao'
      );
      assert.ok(
        hostPageContent.includes('onChange={(e) => setRewardEnabled(e.target.checked)}'),
        'Công tắc checkbox phải gọi setRewardEnabled(e.target.checked)'
      );
      assert.ok(
        hostPageContent.includes("{rewardEnabled ? 'BẬT' : 'TẮT'}"),
        'Phải hiển thị nhãn trạng thái BẬT/TẮT trên switch'
      );
    });

    // 3. Hiển thị quy tắc cố định 15/10/5/2 sao và điều kiện nộp >= 1 câu
    await t.test('3. Hiển thị quy tắc 15/10/5/2 sao và điều kiện nộp >= 1 câu', () => {
      assert.ok(hostPageContent.includes('Quán Quân (Top 1)'), 'Phải hiển thị quy tắc Quán Quân');
      assert.ok(hostPageContent.includes('+15 sao'), 'Phải hiển thị 15 sao');
      assert.ok(hostPageContent.includes('Hạng Nhì (Top 2)'), 'Phải hiển thị quy tắc Hạng Nhì');
      assert.ok(hostPageContent.includes('+10 sao'), 'Phải hiển thị 10 sao');
      assert.ok(hostPageContent.includes('Hạng Ba (Top 3)'), 'Phải hiển thị quy tắc Hạng Ba');
      assert.ok(hostPageContent.includes('+5 sao'), 'Phải hiển thị 5 sao');
      assert.ok(hostPageContent.includes('Tham gia hợp lệ') && hostPageContent.includes('+2 sao'), 'Phải hiển thị 2 sao tham gia hợp lệ');
      assert.ok(
        hostPageContent.includes('Điều kiện: Học sinh phải nộp bài ít nhất 1 câu hỏi để nhận sao thưởng'),
        'Phải có điều kiện nộp ít nhất 1 câu trả lời'
      );
      assert.ok(
        hostPageContent.includes('Thí sinh tham gia với tư cách Khách (Guest) không được cộng sao vào hệ thống'),
        'Phải nêu rõ tài khoản khách không nhận sao'
      );
    });

    // 4. Không cho phép client chỉnh sửa số sao cố định
    await t.test('4. Không có input cho phép sửa số sao cố định từ Client', () => {
      assert.ok(
        !hostPageContent.includes('name="first_place_stars"') &&
        !hostPageContent.includes('setFirstPlaceStars'),
        'Frontend tuyệt đối không có input thay đổi cấu hình số sao'
      );
      assert.ok(
        hostPageContent.includes('Cố định hệ thống'),
        'Phải ghi rõ quy tắc sao là cố định hệ thống'
      );
    });

    // 5. Truyền rewardEnabled vào hostCreateSession
    await t.test('5. Truyền rewardEnabled vào hostCreateSession', () => {
      assert.ok(
        hostPageContent.includes('rewardEnabled: Boolean(rewardEnabled)'),
        'handleCreateSession phải truyền rewardEnabled'
      );
      assert.ok(
        hostPageContent.includes('rewardConfig: {}'),
        'handleCreateSession phải truyền rewardConfig rỗng'
      );
    });
  });

  // =========================================================================
  // GROUP 2: PHẦN B – HOST KẾT THÚC & XỬ LÝ SỔ CÁI
  // =========================================================================
  await t.test('Group 2: Phần B – Host Finish & Settlement Ledger', async (t) => {
    // 6. Ref guard chống gửi duplicate finish RPC
    await t.test('6. Có isFinishingSessionRef guard chống gửi RPC kết thúc trùng', () => {
      assert.ok(
        hostPageContent.includes('const isFinishingSessionRef = useRef(false);'),
        'Phải có ref isFinishingSessionRef'
      );
      assert.ok(
        hostPageContent.includes('if (!activeSessionId || actionPending || isFinishingSessionRef.current) return;'),
        'handleFinishSession phải kiểm tra isFinishingSessionRef.current ngay đầu hàm'
      );
      assert.ok(
        hostPageContent.includes('isFinishingSessionRef.current = true;'),
        'handleFinishSession phải bật cờ isFinishingSessionRef.current trước khi gọi RPC'
      );
      assert.ok(
        hostPageContent.includes('isFinishingSessionRef.current = false;'),
        'handleFinishSession phải reset cờ isFinishingSessionRef.current trong finally'
      );
    });

    // 7. Giữ cơ chế actionPending và không chuyển finished khi RPC lỗi
    await t.test('7. Giữ cơ chế actionPending, nếu RPC thất bại không chuyển sang finished sai', () => {
      assert.ok(
        hostPageContent.includes('setActionPending(true)'),
        'Phải bật actionPending khi bắt đầu finish'
      );
      assert.ok(
        hostPageContent.includes("showToast(res.message || 'Không thể kết thúc phòng thi.', 'error')"),
        'Hiển thị thông báo lỗi khi finish RPC trả về thất bại'
      );
      assert.ok(
        hostPageContent.includes("showToast('Lỗi mạng khi kết thúc phòng thi.', 'error')"),
        'Hiển thị thông báo lỗi mạng trong catch'
      );
    });

    // 8. Đọc ledger khi snapshot.reward_enabled là true
    await t.test('8. Khi phòng bật thưởng, đọc ledger theo sessionId', () => {
      assert.ok(
        hostPageContent.includes('hostGetRewardTransactions(targetSessionId)'),
        'Phải gọi hostGetRewardTransactions khi phiên thi bật thưởng'
      );
      assert.ok(
        hostPageContent.includes('snapshot.reward_enabled') && hostPageContent.includes('fetchRewardLedger(activeSessionId)'),
        'Effect khi finished phải gọi fetchRewardLedger nếu reward_enabled'
      );
    });

    // 9. Hiển thị tổng sao thực tế, số học sinh nhận, số trường hợp bỏ qua
    await t.test('9. Hiển thị tổng sao thực tế, số học sinh nhận, số trường hợp không đủ điều kiện', () => {
      assert.ok(
        hostPageContent.includes('rewardStats.totalStarsAwarded'),
        'Phải hiển thị tổng sao thực tế từ ledger'
      );
      assert.ok(
        hostPageContent.includes('rewardStats.awardedCount'),
        'Phải hiển thị số học sinh nhận thưởng'
      );
      assert.ok(
        hostPageContent.includes('rewardStats.skippedCount + rewardStats.guestCount'),
        'Phải hiển thị số trường hợp không đủ điều kiện hoặc bỏ qua'
      );
    });

    // 10. Tra cứu sao cạnh thành tích từ ledger, không tự tính phần thưởng từ rank trên client
    await t.test('10. Hiển thị sao cạnh thành tích từ ledger, không tự tính trên client', () => {
      assert.ok(
        hostPageContent.includes('const tx = rewardTxMap.get(p.participant_id)'),
        'Phải tra cứu transaction từ rewardTxMap theo participant_id cho Top 3'
      );
      assert.ok(
        hostPageContent.includes('const tx = rewardTxMap.get(item.participant_id)'),
        'Phải tra cứu transaction từ rewardTxMap theo participant_id cho Leaderboard Table'
      );
      assert.ok(
        hostPageContent.includes('+{tx.stars_awarded} ⭐'),
        'Phải hiển thị đúng tx.stars_awarded từ backend'
      );
    });
  });

  // =========================================================================
  // GROUP 3: PHẦN C – HỌC SINH & XÁC NHẬN SỔ CÁI CÁ NHÂN
  // =========================================================================
  await t.test('Group 3: Phần C – Student View & Verification', async (t) => {
    // 11. Đọc reward_enabled và reward_status từ session snapshot
    await t.test('11. Đọc reward_enabled và reward_status từ session snapshot', () => {
      assert.ok(
        clientServiceContent.includes('reward_enabled, reward_config, reward_status'),
        'competitionClient getSessionSnapshot phải select reward_enabled, reward_config, reward_status'
      );
      assert.ok(
        studentPageContent.includes('currentSessionRewardEnabled'),
        'Student page phải đọc trạng thái reward_enabled'
      );
      assert.ok(
        studentPageContent.includes('currentSessionRewardStatus'),
        'Student page phải đọc trạng thái reward_status'
      );
    });

    // 12. Học sinh đăng nhập đọc bản ghi bằng RLS thông qua studentGetRewardTransaction
    await t.test('12. Học sinh đăng nhập đọc bản ghi của mình bằng RLS qua studentGetRewardTransaction', () => {
      assert.ok(
        clientServiceContent.includes('studentGetRewardTransaction'),
        'Phải có hàm studentGetRewardTransaction trong competitionClient'
      );
      assert.ok(
        studentPageContent.includes('studentGetRewardTransaction(targetSessionId, targetUserId)'),
        'Student page phải gọi studentGetRewardTransaction với sessionId và userId'
      );
    });

    // 13. Phân biệt awarded, skipped_no_submission, không có dữ liệu, lỗi truy vấn
    await t.test('13. Phân biệt awarded, skipped_no_submission, lỗi mạng và guest', () => {
      assert.ok(
        studentPageContent.includes("studentRewardTx?.reward_status === 'awarded'"),
        'Phải có nhánh xử lý trạng thái awarded'
      );
      assert.ok(
        studentPageContent.includes("studentRewardTx?.reward_status === 'skipped_no_submission'"),
        'Phải có nhánh xử lý trạng thái skipped_no_submission'
      );
      assert.ok(
        studentPageContent.includes('Chưa đủ điều kiện nhận sao (0 sao)'),
        'Phải hiển thị rõ 0 sao khi chưa nộp câu nào'
      );
      assert.ok(
        studentPageContent.includes('rewardTxError && !studentRewardTx'),
        'Phải có nhánh hiển thị lỗi khi truy vấn sổ cái thất bại kèm nút Thử lại'
      );
    });

    // 14. Gọi refreshProfile() đúng 1 lần sau khi nhận kết quả awarded
    await t.test('14. Gọi refreshProfile() đúng 1 lần sau khi nhận kết quả awarded, chống gọi lặp', () => {
      assert.ok(
        studentPageContent.includes('const hasRefreshedProfileRef = useRef(false);'),
        'Phải có ref hasRefreshedProfileRef'
      );
      assert.ok(
        studentPageContent.includes('!hasRefreshedProfileRef.current'),
        'Chỉ gọi refreshProfile khi !hasRefreshedProfileRef.current'
      );
      assert.ok(
        studentPageContent.includes('hasRefreshedProfileRef.current = true;'),
        'Đặt cờ hasRefreshedProfileRef.current = true ngay sau khi kích hoạt'
      );
      assert.ok(
        studentPageContent.includes('await refreshProfile()') || studentPageContent.includes('refreshProfile()'),
        'Phải gọi refreshProfile'
      );
    });

    // 15. Guest không query ledger và không được cộng sao
    await t.test('15. Guest không query ledger, không được cộng sao, không hứa hẹn hồi tố', () => {
      assert.ok(
        studentPageContent.includes('if (isGuestMode || !targetUserId || !targetSessionId || !isValidUUID(targetSessionId))'),
        'fetchStudentRewardTx phải dừng ngay lập tức nếu là Guest hoặc unauthenticated'
      );
      assert.ok(
        studentPageContent.includes('Chế độ Khách (0 sao)'),
        'Hiển thị rõ ràng Chế độ Khách 0 sao'
      );
      assert.ok(
        studentPageContent.includes('Hãy đăng nhập tài khoản học sinh ở các trận đấu sau'),
        'Khuyên đăng nhập ở các trận sau, không hứa hẹn cộng sao hồi tố cho trận này'
      );
    });

    // 16. F5 khôi phục và xem kết quả thưởng chính xác
    await t.test('16. F5 khôi phục và hiển thị kết quả thưởng chính xác', () => {
      assert.ok(
        studentPageContent.includes('setFinishedSessionSnapshot(session);'),
        'validateAndRestoreSession phải lưu snapshot session'
      );
      assert.ok(
        studentPageContent.includes('if (session.reward_enabled && !isGuestMode && user?.id)'),
        'F5 restore phải kích hoạt fetchStudentRewardTx khi phòng bật thưởng'
      );
    });
  });

  // =========================================================================
  // GROUP 4: PHẦN D – AN TOÀN FRONTEND & TÍNH TOÀN VẸN
  // =========================================================================
  await t.test('Group 4: Phần D – Frontend Security & Integrity Guards', async (t) => {
    // 17. Không tự tính sao từ rank trên client
    await t.test('17. Không tự tính sao từ rank trên client', () => {
      assert.ok(
        !studentPageContent.includes('const stars = rank === 1 ? 15 : rank === 2 ? 10'),
        'Student tuyệt đối không tự tính số sao từ rank'
      );
      assert.ok(
        !hostPageContent.includes('const stars = rank === 1 ? 15 : rank === 2 ? 10'),
        'Host tuyệt đối không tự tính số sao từ rank'
      );
    });

    // 18. Không tự UPDATE profiles.total_stars từ client
    await t.test('18. Không có lệnh UPDATE profiles.total_stars hoặc INSERT ledger từ client', () => {
      assert.ok(
        !hostPageContent.includes(".from('profiles').update({ total_stars"),
        'Host không được UPDATE profiles.total_stars'
      );
      assert.ok(
        !studentPageContent.includes(".from('profiles').update({ total_stars"),
        'Student không được UPDATE profiles.total_stars'
      );
      assert.ok(
        !clientServiceContent.includes(".from('profiles').update({ total_stars"),
        'competitionClient không được UPDATE profiles.total_stars'
      );
      assert.ok(
        !hostPageContent.includes(".from('competition_reward_transactions').insert"),
        'Host không được INSERT vào competition_reward_transactions'
      );
      assert.ok(
        !studentPageContent.includes(".from('competition_reward_transactions').insert"),
        'Student không được INSERT vào competition_reward_transactions'
      );
      assert.ok(
        !clientServiceContent.includes(".from('competition_reward_transactions').insert"),
        'competitionClient không được INSERT vào competition_reward_transactions'
      );
    });

    // 19. Chống stale response và sai session ID
    await t.test('19. Chống stale response và sai session ID bằng request ID', () => {
      assert.ok(
        hostPageContent.includes('const requestId = ++latestRewardRequestIdRef.current;'),
        'Host fetchRewardLedger phải có request ID guard'
      );
      assert.ok(
        hostPageContent.includes('if (activeSessionIdRef.current && targetSessionId !== activeSessionIdRef.current) return;'),
        'Host fetchRewardLedger phải kiểm tra targetSessionId khớp activeSessionId'
      );
      assert.ok(
        studentPageContent.includes('const requestId = ++latestStudentRewardRequestIdRef.current;'),
        'Student fetchStudentRewardTx phải có request ID guard'
      );
    });

    // 20. Không nhầm lỗi mạng với kết quả 0 sao
    await t.test('20. Không nhầm lỗi mạng với kết quả 0 sao (Hiển thị Retry button)', () => {
      assert.ok(
        hostPageContent.includes('setRewardLedgerError'),
        'Host phải lưu trữ lỗi riêng biệt với kết quả rỗng'
      );
      assert.ok(
        studentPageContent.includes('setRewardTxError'),
        'Student phải lưu trữ lỗi riêng biệt với kết quả rỗng'
      );
      assert.ok(
        hostPageContent.includes('rewardLedgerError') && hostPageContent.includes('Thử lại'),
        'Host phải có nút Thử lại khi lỗi sổ cái'
      );
      assert.ok(
        studentPageContent.includes('rewardTxError') && studentPageContent.includes('Thử lại'),
        'Student phải có nút Thử lại khi lỗi sổ cái'
      );
    });

    // 21. Bảo toàn giao diện khi phòng chưa bật thưởng (Reward OFF)
    await t.test('21. Bảo toàn giao diện khi reward_enabled là false', () => {
      assert.ok(
        hostPageContent.includes('snapshot.reward_enabled && ('),
        'Host chỉ render Settlement Card khi snapshot.reward_enabled là true'
      );
      assert.ok(
        studentPageContent.includes('currentSessionRewardEnabled && ('),
        'Student chỉ render Star Reward Card khi currentSessionRewardEnabled là true'
      );
    });
  });
});
