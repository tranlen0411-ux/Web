import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appContent = fs.readFileSync('src/App.jsx', 'utf8');
const spectatorPageContent = fs.readFileSync('src/pages/CompetitionSpectatorPage.jsx', 'utf8');
const waitingViewContent = fs.readFileSync('src/components/competition/spectator/SpectatorWaitingView.jsx', 'utf8');
const liveViewContent = fs.readFileSync('src/components/competition/spectator/SpectatorLiveQuestionView.jsx', 'utf8');
const resultsViewContent = fs.readFileSync('src/components/competition/spectator/SpectatorQuestionResultsView.jsx', 'utf8');
const leaderboardViewContent = fs.readFileSync('src/components/competition/spectator/SpectatorLeaderboardView.jsx', 'utf8');
const finishedViewContent = fs.readFileSync('src/components/competition/spectator/SpectatorFinishedView.jsx', 'utf8');
const hostContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const clientContent = fs.readFileSync('src/services/competitionClient.js', 'utf8');

const allSpectatorBundle = [
  spectatorPageContent,
  waitingViewContent,
  liveViewContent,
  resultsViewContent,
  leaderboardViewContent,
  finishedViewContent
].join('\n');

// UUID format regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(v) {
  return typeof v === 'string' && UUID_REGEX.test(v.trim());
}

test('COMPETITION V1 R13 — SPECTATOR / PROJECTOR VIEW TEST SUITE', async (t) => {

  await t.test('Group 1: Route, Access Control & Layout Guard', async (t) => {
    await t.test('1. spectator route exists in App.jsx', () => {
      assert.match(appContent, /path="\/competition\/spectator"/);
    });

    await t.test('2. route requires teacher and admin roles', () => {
      assert.match(appContent, /<Route\s+path="\/competition\/spectator"\s+element=\{\s*<ProtectedRoute\s+allowedRoles=\{\['admin',\s*'teacher'\]\}/);
    });

    await t.test('3. student is excluded from spectator allowedRoles', () => {
      const match = appContent.match(/<Route\s+path="\/competition\/spectator"[\s\S]*?allowedRoles=\{([^}]+)\}/);
      assert.ok(match, 'Route must have allowedRoles');
      assert.ok(!match[1].includes('student'), 'Student must NOT be allowed in Phase 1 spectator view');
    });

    await t.test('4. anonymous access is denied via ProtectedRoute', () => {
      assert.ok(appContent.includes('<ProtectedRoute allowedRoles='));
      assert.match(appContent, /if \(!user\) \{\s*return <Navigate to="\/auth" replace \/>;\s*\}/);
    });

    await t.test('5. Navbar and Footer are hidden for spectator route', () => {
      assert.match(appContent, /const isSpectator = location\.pathname\.startsWith\('\/competition\/spectator'\)/);
      assert.match(appContent, /\{!isSpectator && <Navbar \/>\}/);
      assert.match(appContent, /\{!isSpectator && <Footer \/>\}/);
    });
  });

  await t.test('Group 2: Security & Read-Only Invariants', async (t) => {
    await t.test('7. spectator imports zero Host mutation RPCs', () => {
      const forbiddenMutationRpcs = [
        'hostCreateSession',
        'hostStartSession',
        'hostNextQuestion',
        'hostPauseSession',
        'hostResumeSession',
        'hostCloseQuestion',
        'hostFinishSession',
        'hostCancelSession'
      ];
      for (const rpc of forbiddenMutationRpcs) {
        assert.ok(!allSpectatorBundle.includes(rpc), `Spectator bundle must not import or use mutation RPC ${rpc}`);
      }
    });

    await t.test('8. spectator never calls studentSubmitAnswer or answer submission', () => {
      assert.ok(!allSpectatorBundle.includes('studentSubmitAnswer'));
      assert.ok(!allSpectatorBundle.includes('competition_submit_answer'));
    });

    await t.test('26. no raw competition_answers table query', () => {
      assert.ok(!allSpectatorBundle.includes(".from('competition_answers')"));
    });

    await t.test('27. no user_id exposure in spectator view', () => {
      assert.ok(!allSpectatorBundle.includes('user_id'));
    });

    await t.test('28. no guest_token exposure', () => {
      assert.ok(!allSpectatorBundle.includes('guest_token'));
    });

    await t.test('29. no guest_token_hash exposure', () => {
      assert.ok(!allSpectatorBundle.includes('guest_token_hash'));
    });
  });

  await t.test('Group 3: Session Validation & Fail-Closed Behavior', async (t) => {
    await t.test('5a. valid UUID is accepted', () => {
      assert.ok(isValidUUID('c1e08920-7f28-4444-a123-112233445566'));
      assert.ok(isValidUUID('a0000000-0000-4000-8000-000000000001'));
    });

    await t.test('5b. malformed sessionId fails validation', () => {
      assert.strictEqual(isValidUUID(''), false);
      assert.strictEqual(isValidUUID('invalid-uuid'), false);
      assert.strictEqual(isValidUUID('12345'), false);
      assert.strictEqual(isValidUUID(null), false);
      assert.strictEqual(isValidUUID(undefined), false);
      assert.strictEqual(isValidUUID('../admin'), false);
    });

    await t.test('5c. spectator page contains fail-closed screen on invalid UUID or error', () => {
      assert.match(spectatorPageContent, /if \(!isValidUUID \|\| errorMessage\)/);
      assert.match(spectatorPageContent, /Không Thể Mở Màn Hình Trình Chiếu/);
      assert.match(spectatorPageContent, /Fail-Closed/);
    });
  });

  await t.test('Group 4: Host Entry Point & Projector Action', async (t) => {
    await t.test('6a. Host page defines handleOpenSpectator with active session UUID', () => {
      assert.match(hostContent, /const handleOpenSpectator = \(/);
      assert.match(hostContent, /\/competition\/spectator\?sessionId=/);
    });

    await t.test('6b. handleOpenSpectator uses window.open with _blank and noopener,noreferrer', () => {
      assert.match(hostContent, /window\.open\(url,\s*'_blank',\s*'noopener,noreferrer'\)/);
    });

    await t.test('6c. Host page contains buttons to open spectator in waiting, in_progress, and finished', () => {
      assert.match(hostContent, /onClick=\{\(\) => handleOpenSpectator\(snapshot\.id\)\}/);
      assert.match(hostContent, /Màn hình trình chiếu|Trình Chiếu Trực Tiếp|Trình Chiếu Kết Quả/);
    });
  });

  await t.test('Group 5: View States & Presentation Integrity', async (t) => {
    await t.test('20. waiting screen displays room code prominently and participant count', () => {
      assert.match(waitingViewContent, /MÃ PHÒNG THI ĐẤU/);
      assert.match(waitingViewContent, /snapshot\?\.room_code/);
      assert.match(waitingViewContent, /Danh Sách Thí Sinh Trong Sảnh Chờ/);
    });

    await t.test('21-22. LIVE screen shows Question X / Y and countdown timer', () => {
      assert.match(liveViewContent, /Câu \{snapshot\?\.current_question_index \|\| 1\} \/ \{effectiveTotalQuestions\}/);
      assert.match(liveViewContent, /timeLeftSeconds/);
      assert.match(liveViewContent, /Tiến độ nộp bài/);
    });

    await t.test('9-10. LIVE screen does not leak correct answer or correct distribution', () => {
      assert.ok(!liveViewContent.includes('is_correct'), 'Live question view must not check or use is_correct');
      assert.ok(!liveViewContent.includes('correct_answer'), 'Live question view must not use correct_answer');
      assert.ok(!liveViewContent.includes('Đáp án đúng'), 'Live question view must not label correct answer');
      assert.ok(!liveViewContent.includes('correct_percentage'), 'Live question view must not display correctness percentage');
    });

    await t.test('23. paused state clearly displays pause banner and freezes timer', () => {
      assert.match(liveViewContent, /snapshot\?\.status === 'paused'/);
      assert.match(liveViewContent, /Trận Đấu Đang Tạm Dừng/);
    });

    await t.test('11 & 24. question results view displays aggregate counts and correctness percentage', () => {
      assert.match(resultsViewContent, /KẾT QUẢ CÂU HỎI ĐÃ ĐÓNG/);
      assert.match(resultsViewContent, /correct_percentage/);
      assert.match(resultsViewContent, /submitted_count/);
      assert.match(resultsViewContent, /correct_count/);
      assert.match(resultsViewContent, /incorrect_count/);
      assert.match(resultsViewContent, /Đáp án đúng/);
    });

    await t.test('12-14. leaderboard displays authoritative backend rank and preserves tie gaps', () => {
      assert.match(leaderboardViewContent, /BẢNG XẾP HẠNG TRỰC TIẾP/);
      assert.match(leaderboardViewContent, /#\{row\.rank\}/);
      assert.ok(!leaderboardViewContent.includes('leaderboard.sort('), 'Leaderboard must not do client-side re-sorting');
      assert.ok(!leaderboardViewContent.includes('rank = index + 1'), 'Leaderboard must not fabricate sequential ranks');
    });

    await t.test('15 & 25. finished ceremony podium handles tie rank 1 safely', () => {
      assert.match(finishedViewContent, /KẾT QUẢ CHUNG CUỘC/);
      assert.match(finishedViewContent, /Vinh Danh Nhà Vô Địch/);
      assert.match(finishedViewContent, /leaderboard\.filter\(\(p\) => p\.rank === 1\)/);
      assert.match(finishedViewContent, /leaderboard\.filter\(\(p\) => p\.rank === 2\)/);
      assert.match(finishedViewContent, /leaderboard\.filter\(\(p\) => p\.rank === 3\)/);
    });
  });

  await t.test('Group 6: Polling Lifecycle & Stale-Request Guard', async (t) => {
    await t.test('16. polling cadence is >= 2 seconds (2000ms for active, 3000ms for idle)', () => {
      assert.match(spectatorPageContent, /\(snapshot\?\.status === 'in_progress'\) \? 2000 : 3000/);
    });

    await t.test('17. polling timers cleaned up on unmount or session change', () => {
      assert.match(spectatorPageContent, /if \(pollingTimerRef\.current\) clearTimeout\(pollingTimerRef\.current\)/);
      assert.match(spectatorPageContent, /if \(timerIntervalRef\.current\) clearInterval\(timerIntervalRef\.current\)/);
      assert.match(spectatorPageContent, /isMountedRef\.current = false/);
    });

    await t.test('18. stale request guard discards responses from outdated request IDs', () => {
      assert.match(spectatorPageContent, /const currentRequestId = \+\+activeRequestIdRef\.current/);
      assert.match(spectatorPageContent, /if \(!isMountedRef\.current \|\| currentRequestId !== activeRequestIdRef\.current\) return/);
    });
  });

  await t.test('Group 7: Fullscreen & Projector Ergonomics', async (t) => {
    await t.test('19. fullscreen button and browser Fullscreen API integration present', () => {
      assert.match(spectatorPageContent, /requestFullscreen/);
      assert.match(spectatorPageContent, /exitFullscreen/);
      assert.match(spectatorPageContent, /Toàn Màn Hình|Thu Nhỏ/);
    });
  });
});
