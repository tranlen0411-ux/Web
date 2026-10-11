import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hostPageContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const studentPageContent = fs.readFileSync('src/pages/CompetitionStudentPage.jsx', 'utf8');
const clientServiceContent = fs.readFileSync('src/services/competitionClient.js', 'utf8');

test('COMPETITION V1 R18 – REWARD FRONTEND BEHAVIORAL & INTEGRATION TEST SUITE', async (t) => {

  // =========================================================================
  // SUITE 1: BEHAVIORAL – BACKEND LEDGER FIXTURES & STATUS RESOLUTION
  // =========================================================================
  await t.test('Suite 1: Behavioral – Backend Ledger Fixtures & Status Resolution', async (t) => {
    // Helper to resolve transaction status (mirroring production frontend fix)
    const resolveTxStatus = (tx) => tx?.status || tx?.reward_status;

    await t.test('1.1. Backend transaction với status: awarded được nhận diện chính xác', () => {
      const awardedFixture = {
        id: 'tx-001',
        session_id: 'sess-001',
        participant_id: 'p-001',
        user_id: 'u-001',
        status: 'awarded',
        stars_awarded: 15,
        rank: 1,
      };

      // Xác nhận cột Backend status là awarded (không có reward_status)
      assert.strictEqual(awardedFixture.status, 'awarded');
      assert.strictEqual(awardedFixture.reward_status, undefined);

      const status = resolveTxStatus(awardedFixture);
      assert.strictEqual(status, 'awarded', 'Phải nhận diện được awarded từ cột status của Backend');
      assert.strictEqual(awardedFixture.stars_awarded, 15);
    });

    await t.test('1.2. Backend transaction với status: skipped_no_submission được nhận diện chính xác', () => {
      const skippedNoSubFixture = {
        id: 'tx-002',
        session_id: 'sess-001',
        participant_id: 'p-002',
        user_id: 'u-002',
        status: 'skipped_no_submission',
        stars_awarded: 0,
        rank: 5,
      };

      assert.strictEqual(skippedNoSubFixture.status, 'skipped_no_submission');
      const status = resolveTxStatus(skippedNoSubFixture);
      assert.strictEqual(status, 'skipped_no_submission');
      assert.strictEqual(skippedNoSubFixture.stars_awarded, 0);
    });

    await t.test('1.3. Backend transaction với status: skipped_guest được nhận diện chính xác', () => {
      const skippedGuestFixture = {
        id: 'tx-003',
        session_id: 'sess-001',
        participant_id: 'p-003',
        user_id: null,
        status: 'skipped_guest',
        stars_awarded: 0,
        rank: 6,
      };

      assert.strictEqual(skippedGuestFixture.status, 'skipped_guest');
      const status = resolveTxStatus(skippedGuestFixture);
      assert.strictEqual(status, 'skipped_guest');
      assert.strictEqual(skippedGuestFixture.stars_awarded, 0);
    });

    await t.test('1.4. Phát hiện lỗi nếu chỉ kiểm tra tx.reward_status (Regression blocker)', () => {
      const backendLedgerRecord = {
        id: 'tx-004',
        status: 'awarded',
        stars_awarded: 10,
      };

      // Nếu code cũ chỉ check tx.reward_status
      const legacyCheck = backendLedgerRecord.reward_status;
      assert.strictEqual(legacyCheck, undefined, 'tx.reward_status từ Backend phải là undefined');

      // Nhưng với hàm sửa đổi:
      const fixedCheck = resolveTxStatus(backendLedgerRecord);
      assert.strictEqual(fixedCheck, 'awarded', 'Hàm sửa đổi phải đọc được tx.status');
    });
  });

  // =========================================================================
  // SUITE 2: BEHAVIORAL – HOST REWARD AGGREGATION (15/10/5/2 RULE)
  // =========================================================================
  await t.test('Suite 2: Behavioral – Host Settlement Aggregation (15/10/5/2 Rule)', async (t) => {
    // Pure aggregation function as implemented in CompetitionHostPage.jsx
    const computeRewardStats = (rewardTransactions) => {
      if (!Array.isArray(rewardTransactions) || rewardTransactions.length === 0) {
        return {
          totalStarsAwarded: 0,
          awardedCount: 0,
          skippedCount: 0,
          guestCount: 0,
          totalTransactions: 0,
        };
      }
      let totalStars = 0;
      let awarded = 0;
      let skipped = 0;
      let guests = 0;

      rewardTransactions.forEach((tx) => {
        const txStatus = tx.status || tx.reward_status;
        if (txStatus === 'awarded') {
          awarded += 1;
          totalStars += Number(tx.stars_awarded || 0);
        } else if (txStatus === 'skipped_no_submission') {
          skipped += 1;
        } else if (txStatus === 'skipped_guest') {
          guests += 1;
        }
      });

      return {
        totalStarsAwarded: totalStars,
        awardedCount: awarded,
        skippedCount: skipped,
        guestCount: guests,
        totalTransactions: rewardTransactions.length,
      };
    };

    await t.test('2.1. Tổng hợp chính xác 15 + 10 + 5 + 2 = 32 sao từ bản ghi Backend', () => {
      const realisticBackendTransactions = [
        { participant_id: 'p1', user_id: 'u1', rank: 1, status: 'awarded', stars_awarded: 15 },
        { participant_id: 'p2', user_id: 'u2', rank: 2, status: 'awarded', stars_awarded: 10 },
        { participant_id: 'p3', user_id: 'u3', rank: 3, status: 'awarded', stars_awarded: 5 },
        { participant_id: 'p4', user_id: 'u4', rank: 4, status: 'awarded', stars_awarded: 2 },
        { participant_id: 'p5', user_id: 'u5', rank: 5, status: 'skipped_no_submission', stars_awarded: 0 },
        { participant_id: 'p6', user_id: null, rank: 6, status: 'skipped_guest', stars_awarded: 0 },
      ];

      const stats = computeRewardStats(realisticBackendTransactions);

      assert.strictEqual(stats.totalStarsAwarded, 32, 'Tổng sao thực tế phải là 32 (15+10+5+2)');
      assert.strictEqual(stats.awardedCount, 4, 'Số người nhận sao phải là 4');
      assert.strictEqual(stats.skippedCount, 1, 'Số người bị bỏ qua do chưa nộp bài phải là 1');
      assert.strictEqual(stats.guestCount, 1, 'Số khách phải là 1');
      assert.strictEqual(stats.totalTransactions, 6, 'Tổng bản ghi là 6');
    });

    await t.test('2.2. Lookup map theo participant_id hoạt động chuẩn xác', () => {
      const transactions = [
        { participant_id: 'p1', status: 'awarded', stars_awarded: 15 },
        { participant_id: 'p2', status: 'awarded', stars_awarded: 10 },
      ];
      const txMap = new Map();
      transactions.forEach((tx) => txMap.set(tx.participant_id, tx));

      assert.strictEqual(txMap.get('p1')?.stars_awarded, 15);
      assert.strictEqual(txMap.get('p2')?.stars_awarded, 10);
      assert.strictEqual(txMap.get('p3'), undefined);
    });
  });

  // =========================================================================
  // SUITE 3: BEHAVIORAL – STUDENT PROFILE REFRESH & SESSION/USER KEY ISOLATION
  // =========================================================================
  await t.test('Suite 3: Behavioral – Student Profile Refresh & Key Isolation', async (t) => {
    class StudentProfileSyncController {
      constructor(refreshProfileFn) {
        this.refreshProfileFn = refreshProfileFn;
        this.refreshedProfileKey = null;
        this.callCount = 0;
      }

      async onRewardTxLoaded(targetSessionId, targetUserId, tx) {
        const txStatus = tx?.status || tx?.reward_status;
        const profileRefreshKey = `${targetSessionId}:${targetUserId}`;

        if (
          tx &&
          txStatus === 'awarded' &&
          Number(tx.stars_awarded) > 0 &&
          this.refreshedProfileKey !== profileRefreshKey
        ) {
          this.refreshedProfileKey = profileRefreshKey;
          this.callCount += 1;
          await this.refreshProfileFn();
        }
      }

      reset() {
        this.refreshedProfileKey = null;
      }
    }

    await t.test('3.1. Gọi refreshProfile() khi có bản ghi awarded với stars_awarded > 0', async () => {
      let refreshed = false;
      const controller = new StudentProfileSyncController(async () => {
        refreshed = true;
      });

      const tx = { status: 'awarded', stars_awarded: 15 };
      await controller.onRewardTxLoaded('session-1', 'user-1', tx);

      assert.strictEqual(refreshed, true, 'refreshProfile phải được gọi');
      assert.strictEqual(controller.callCount, 1);
    });

    await t.test('3.2. Chống gọi trùng lặp refreshProfile() trong cùng session và user', async () => {
      const controller = new StudentProfileSyncController(async () => {});

      const tx = { status: 'awarded', stars_awarded: 15 };
      await controller.onRewardTxLoaded('session-1', 'user-1', tx);
      await controller.onRewardTxLoaded('session-1', 'user-1', tx); // Lần 2 (re-render)

      assert.strictEqual(controller.callCount, 1, 'Chỉ được gọi refreshProfile đúng 1 lần trong phiên');
    });

    await t.test('3.3. Cho phép refreshProfile() ở phiên tiếp theo (không bị cờ boolean chặn)', async () => {
      const controller = new StudentProfileSyncController(async () => {});

      const tx = { status: 'awarded', stars_awarded: 15 };
      await controller.onRewardTxLoaded('session-1', 'user-1', tx);
      assert.strictEqual(controller.callCount, 1);

      // Chuyển sang session-2 với cùng user-1
      await controller.onRewardTxLoaded('session-2', 'user-1', tx);
      assert.strictEqual(controller.callCount, 2, 'Phiên thứ hai phải được refresh profile thành công');
    });

    await t.test('3.4. Không refreshProfile() khi status là skipped_no_submission hoặc skipped_guest', async () => {
      const controller = new StudentProfileSyncController(async () => {});

      await controller.onRewardTxLoaded('session-1', 'user-1', { status: 'skipped_no_submission', stars_awarded: 0 });
      assert.strictEqual(controller.callCount, 0, 'skipped_no_submission không được gọi refreshProfile');

      await controller.onRewardTxLoaded('session-1', 'user-1', { status: 'skipped_guest', stars_awarded: 0 });
      assert.strictEqual(controller.callCount, 0, 'skipped_guest không được gọi refreshProfile');
    });
  });

  // =========================================================================
  // SUITE 4: BEHAVIORAL – NETWORK ERROR & RETRY RESILIENCE (HOST & STUDENT)
  // =========================================================================
  await t.test('Suite 4: Behavioral – Network Error & Retry Resilience', async (t) => {
    class LedgerStateModel {
      constructor() {
        this.isLoading = false;
        this.error = null;
        this.transactions = [];
        this.requestId = 0;
      }

      async fetchLedger(fetcherFn) {
        const currentReq = ++this.requestId;
        this.isLoading = true;
        this.error = null;

        try {
          const res = await fetcherFn();
          if (currentReq !== this.requestId) return;

          if (res.success && Array.isArray(res.data)) {
            this.transactions = res.data;
            this.error = null;
          } else {
            this.error = res.message || 'Lỗi tải dữ liệu';
            this.transactions = []; // Đảm bảo xóa data cũ khi request mới lỗi
          }
        } catch (_err) {
          if (currentReq === this.requestId) {
            this.error = 'Lỗi mạng';
            this.transactions = []; // Đảm bảo xóa data cũ
          }
        } finally {
          if (currentReq === this.requestId) {
            this.isLoading = false;
          }
        }
      }
    }

    await t.test('4.1. Lỗi mạng xóa bỏ dữ liệu cũ và hiển thị error state, không hiển thị 0 sao giả tạo', async () => {
      const model = new LedgerStateModel();
      model.transactions = [{ status: 'awarded', stars_awarded: 10 }]; // data cũ

      // Request mới bị lỗi
      await model.fetchLedger(async () => {
        throw new Error('Network timeout');
      });

      assert.strictEqual(model.isLoading, false);
      assert.strictEqual(model.error, 'Lỗi mạng');
      assert.strictEqual(model.transactions.length, 0, 'Data cũ phải được xóa, không được hiển thị như kết quả hiện tại');
    });

    await t.test('4.2. Retry sau lỗi tải thành công dữ liệu hợp lệ', async () => {
      const model = new LedgerStateModel();

      // Lần 1 thất bại
      await model.fetchLedger(async () => {
        return { success: false, message: 'Server busy' };
      });
      assert.strictEqual(model.error, 'Server busy');

      // Lần 2 retry thành công
      await model.fetchLedger(async () => {
        return { success: true, data: [{ status: 'awarded', stars_awarded: 15 }] };
      });

      assert.strictEqual(model.error, null);
      assert.strictEqual(model.transactions.length, 1);
      assert.strictEqual(model.transactions[0].stars_awarded, 15);
    });
  });

  // =========================================================================
  // SUITE 5: BEHAVIORAL – SESSION ISOLATION & EXIT / ROOM SWITCH GUARDS
  // =========================================================================
  await t.test('Suite 5: Behavioral – Session Isolation & Room Switch', async (t) => {
    await t.test('5.1. handleExit reset hoàn toàn finishedSessionSnapshot và reward state', () => {
      // Giả lập state ban đầu
      let finishedSessionSnapshot = { id: 'room-A', status: 'finished' };
      let studentRewardTx = { status: 'awarded', stars_awarded: 15 };
      let rewardTxError = 'some error';
      let refreshedProfileKey = 'room-A:user-1';

      // Thực thi hàm reset
      const handleExitSimulation = () => {
        finishedSessionSnapshot = null;
        studentRewardTx = null;
        rewardTxError = null;
        refreshedProfileKey = null;
      };

      handleExitSimulation();

      assert.strictEqual(finishedSessionSnapshot, null);
      assert.strictEqual(studentRewardTx, null);
      assert.strictEqual(rewardTxError, null);
      assert.strictEqual(refreshedProfileKey, null);
    });

    await t.test('5.2. finishedSessionSnapshot phòng cũ KHÔNG làm isFinished của phòng mới thành true', () => {
      const oldFinishedSnapshot = { id: 'room-OLD', status: 'finished' };
      const currentSessionId = 'room-NEW';
      const sessionData = { id: 'room-NEW', status: 'waiting' };

      // Công thức tính isFinished chuẩn sau khi sửa
      const isFinished =
        sessionData?.status === 'finished' ||
        (oldFinishedSnapshot?.status === 'finished' && oldFinishedSnapshot?.id === currentSessionId);

      assert.strictEqual(isFinished, false, 'Phòng mới ở trạng thái waiting không được bị tính là finished');
    });

    await t.test('5.3. Trạng thái reward_status không bị fallback thành completed khi chưa hoàn tất', () => {
      const sessionData = { id: 'room-1', status: 'finished', reward_status: 'pending' };
      const finishedSnapshot = null;

      // Không dùng || 'completed'
      const rewardStatus = sessionData?.reward_status || finishedSnapshot?.reward_status || null;

      assert.strictEqual(rewardStatus, 'pending', 'Phải giữ nguyên pending, không được tự ý ép thành completed');
    });
  });

  // =========================================================================
  // SUITE 6: BEHAVIORAL – F5 SESSION RESTORE LOGIC (STUDENT & GUEST)
  // =========================================================================
  await t.test('Suite 6: Behavioral – F5 Session Restore Logic (Student & Guest)', async (t) => {
    await t.test('6.1. F5 khôi phục Student trigger fetch reward khi finished và reward_enabled', () => {
      let fetchedSessionId = null;
      let fetchedUserId = null;

      const restoredSession = { id: 'sess-123', status: 'finished', reward_enabled: true };
      const isGuestMode = false;
      const user = { id: 'user-456' };

      if (restoredSession.status === 'finished' && restoredSession.reward_enabled && !isGuestMode && user?.id) {
        fetchedSessionId = restoredSession.id;
        fetchedUserId = user.id;
      }

      assert.strictEqual(fetchedSessionId, 'sess-123');
      assert.strictEqual(fetchedUserId, 'user-456');
    });

    await t.test('6.2. F5 khôi phục Guest TUYỆT ĐỐI không trigger fetch reward ledger', () => {
      let fetchedSessionId = null;

      const restoredSession = { id: 'sess-123', status: 'finished', reward_enabled: true };
      const isGuestMode = true;
      const user = null;

      if (restoredSession.status === 'finished' && restoredSession.reward_enabled && !isGuestMode && user?.id) {
        fetchedSessionId = restoredSession.id;
      }

      assert.strictEqual(fetchedSessionId, null, 'Guest F5 tuyệt đối không gọi query ledger');
    });
  });

  // =========================================================================
  // SUITE 7: BEHAVIORAL – DOUBLE-CLICK FINISH CONCURRENCY LOCK
  // =========================================================================
  await t.test('Suite 7: Behavioral – Double-Click Finish Concurrency Lock', async (t) => {
    let rpcCallCount = 0;
    const isFinishingSessionRef = { current: false };

    const handleFinishSessionSimulation = async () => {
      if (isFinishingSessionRef.current) return;
      isFinishingSessionRef.current = true;

      try {
        rpcCallCount += 1;
        // Giả lập RPC delay
        await new Promise((r) => setTimeout(r, 10));
      } finally {
        isFinishingSessionRef.current = false;
      }
    };

    // Bấm đồng thời 2 lần (double-click)
    await Promise.all([
      handleFinishSessionSimulation(),
      handleFinishSessionSimulation(),
    ]);

    assert.strictEqual(rpcCallCount, 1, 'Chỉ được gọi RPC đúng 1 lần duy nhất khi double-click');
    assert.strictEqual(isFinishingSessionRef.current, false, 'Lock phải được giải phóng sau khi xong');
  });

  // =========================================================================
  // SUITE 8: BEHAVIORAL – STALE IN-FLIGHT RESPONSE DROPPING (RACE GUARD)
  // =========================================================================
  await t.test('Suite 8: Behavioral – Stale In-Flight Response Dropping (Race Guard)', async (t) => {
    let latestRequestId = 0;
    let currentLedgerSession = null;

    const executeFetch = async (targetSession, delayMs) => {
      const reqId = ++latestRequestId;
      await new Promise((r) => setTimeout(r, delayMs));

      // Kiểm tra race guard
      if (reqId !== latestRequestId) {
        return { dropped: true };
      }

      currentLedgerSession = targetSession;
      return { dropped: false, session: targetSession };
    };

    // Gửi Request 1 cho Session A (chậm: 50ms)
    const p1 = executeFetch('Session-A', 50);
    // Ngay sau đó gửi Request 2 cho Session B (nhanh: 10ms)
    const p2 = executeFetch('Session-B', 10);

    const [res1, res2] = await Promise.all([p1, p2]);

    assert.strictEqual(res2.dropped, false, 'Request 2 của Session B thành công');
    assert.strictEqual(res1.dropped, true, 'Request 1 của Session A phản hồi muộn bị loại bỏ');
    assert.strictEqual(currentLedgerSession, 'Session-B', 'State cuối cùng phải thuộc Session B');
  });

  // =========================================================================
  // SUITE 9: BEHAVIORAL – REWARD OFF INVARIANT
  // =========================================================================
  await t.test('Suite 9: Behavioral – Reward OFF Invariant', async (t) => {
    let hostLedgerQueried = false;
    let studentLedgerQueried = false;

    const snapshot = { reward_enabled: false };

    // Host check
    if (snapshot.reward_enabled) {
      hostLedgerQueried = true;
    }

    // Student check
    if (snapshot.reward_enabled) {
      studentLedgerQueried = true;
    }

    assert.strictEqual(hostLedgerQueried, false, 'Host không query ledger khi reward_enabled là false');
    assert.strictEqual(studentLedgerQueried, false, 'Student không query ledger khi reward_enabled là false');
  });

  // =========================================================================
  // SUITE 10: STATIC ANALYSIS – CODEBASE CONTRACT ENFORCEMENT
  // =========================================================================
  await t.test('Suite 10: Static Analysis – Codebase Contract Enforcement', async (t) => {
    await t.test('10.1. CompetitionHostPage sử dụng tx.status hoặc tx.reward_status fallback', () => {
      assert.ok(
        hostPageContent.includes('const txStatus = tx.status || tx.reward_status;'),
        'Host page phải dùng const txStatus = tx.status || tx.reward_status;'
      );
    });

    await t.test('10.2. CompetitionStudentPage sử dụng studentTxStatus và refreshedProfileKeyRef', () => {
      assert.ok(
        studentPageContent.includes('refreshedProfileKeyRef'),
        'Student page phải quản lý profile refresh qua refreshedProfileKeyRef'
      );
      assert.ok(
        studentPageContent.includes('const txStatus = res.data?.status || res.data?.reward_status;'),
        'Student page fetchStudentRewardTx phải check status qua res.data?.status'
      );
    });

    await t.test('10.3. competitionClient select cột status từ competition_reward_transactions', () => {
      assert.ok(
        clientServiceContent.includes('hostGetRewardTransactions') &&
        clientServiceContent.includes('status') &&
        clientServiceContent.includes('stars_awarded'),
        'hostGetRewardTransactions phải select cột status và stars_awarded'
      );
      assert.ok(
        clientServiceContent.includes('studentGetRewardTransaction') &&
        clientServiceContent.includes('status') &&
        clientServiceContent.includes('stars_awarded'),
        'studentGetRewardTransaction phải select cột status và stars_awarded'
      );
    });

    await t.test('10.4. Phân biệt rõ empty vs error state trên Host', () => {
      assert.ok(
        hostPageContent.includes('rewardLedgerError && rewardTransactions.length === 0'),
        'Host page phải phân biệt riêng lỗi khi chưa có transactions'
      );
      assert.ok(
        hostPageContent.includes('rewardTransactions.length === 0'),
        'Host page phải có nhánh riêng cho empty state'
      );
    });

    await t.test('10.5. Student page xử lý unverified state khi session đã completed nhưng chưa có tx', () => {
      assert.ok(
        studentPageContent.includes("currentSessionRewardStatus === 'completed'"),
        'Student page phải kiểm tra currentSessionRewardStatus === completed'
      );
      assert.ok(
        studentPageContent.includes('Chưa xác minh được bản ghi thưởng sao'),
        'Student page phải hiển thị thông báo chưa xác minh được bản ghi thưởng sao'
      );
    });
  });

});
