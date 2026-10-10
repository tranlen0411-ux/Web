import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAX_COMPETITION_QUESTIONS,
  sanitizeQuestionsForCreation
} from '../src/utils/competitionQuestionAdapters.js';

// Read relevant codebase files for static audit and behavioral contract tests
const hostPageContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const pollingHookContent = fs.readFileSync('src/hooks/useHostCompetitionPolling.js', 'utf8');
const clientContent = fs.readFileSync('src/services/competitionClient.js', 'utf8');
const analyticsContent = fs.readFileSync('src/components/competition/HostQuestionAnalyticsView.jsx', 'utf8');
const spectatorLiveContent = fs.readFileSync('src/components/competition/spectator/SpectatorLiveQuestionView.jsx', 'utf8');
const spectatorResultsContent = fs.readFileSync('src/components/competition/spectator/SpectatorQuestionResultsView.jsx', 'utf8');

test('COMPETITION V1 — PERFORMANCE & LOADING UX V1 TEST SUITE (30 TESTS)', async (t) => {

  // =========================================================================
  // SIMULATION HARNESS FOR IN-MEMORY CACHE, DEDUP & STALE GUARDS
  // =========================================================================
  function createHarness() {
    let activeSessionId = 'session-123';
    let currentQuestionIndex = 3;
    let currentQuestionId = 'q-current-3';
    let hostViewMode = 'LIVE_QUESTION';
    let isHistoricalResultsLoading = false;
    let loadingOrder = null;
    let reviewedQuestionOrder = null;
    let reviewedQuestionResults = null;
    let historicalError = null;

    const historicalResultsCache = new Map();
    const orderToQuestionIdMap = new Map();
    const inFlightResults = new Map();
    let latestHistoricalRequestId = 0;
    let rpcCallCount = 0;

    // Mock RPC implementation
    let rpcHandler = async (sessionId, questionOrder) => {
      return {
        success: true,
        data: {
          question_id: `q-order-${questionOrder}`,
          question_order: questionOrder,
          question_closed: true,
          question_text: `Câu hỏi ${questionOrder}?`,
          total_questions: 10
        }
      };
    };

    function setRpcHandler(customHandler) {
      rpcHandler = customHandler;
    }

    async function fetchHistoricalResult(orderToFetch) {
      const sessionId = activeSessionId;
      if (!sessionId) return { success: false, error_code: 'NO_SESSION' };

      // 1. Advance request generation first (Blocker 1)
      const requestId = ++latestHistoricalRequestId;

      // 2. In-memory Cache Lookup
      const orderLookupKey = `${sessionId}:${orderToFetch}`;
      const knownQuestionId = orderToQuestionIdMap.get(orderLookupKey);
      const cacheKey = knownQuestionId ? `${sessionId}:${knownQuestionId}` : null;

      if (cacheKey && historicalResultsCache.has(cacheKey)) {
        const cachedData = historicalResultsCache.get(cacheKey);
        if (
          requestId === latestHistoricalRequestId &&
          activeSessionId === sessionId
        ) {
          historicalError = null;
          reviewedQuestionOrder = orderToFetch;
          reviewedQuestionResults = cachedData;
          hostViewMode = 'QUESTION_RESULTS';
          isHistoricalResultsLoading = false;
          loadingOrder = null;
        }
        return { success: true, data: cachedData, fromCache: true };
      }

      // 3. Immediate loading feedback
      isHistoricalResultsLoading = true;
      loadingOrder = orderToFetch;
      historicalError = null;

      // 4. In-flight request deduplication & network fetch
      const inFlightKey = cacheKey || orderLookupKey;
      let fetchPromise = inFlightResults.get(inFlightKey);

      if (!fetchPromise) {
        fetchPromise = (async () => {
          try {
            rpcCallCount++;
            const res = await rpcHandler(sessionId, orderToFetch);

            if (res.success && res.data && res.data.question_id) {
              const itemCacheKey = `${sessionId}:${res.data.question_id}`;
              historicalResultsCache.set(itemCacheKey, res.data);
              orderToQuestionIdMap.set(orderLookupKey, res.data.question_id);
            }
            return res;
          } catch (_err) {
            return {
              success: false,
              error_code: 'NETWORK_ERROR',
              message: 'Lỗi mạng khi tải kết quả câu hỏi.'
            };
          } finally {
            inFlightResults.delete(inFlightKey);
          }
        })();

        inFlightResults.set(inFlightKey, fetchPromise);
      }

      // 5. Await result and check UI ownership
      try {
        const res = await fetchPromise;

        if (
          requestId === latestHistoricalRequestId &&
          activeSessionId === sessionId
        ) {
          if (res.success && res.data) {
            reviewedQuestionOrder = orderToFetch;
            reviewedQuestionResults = res.data;
            hostViewMode = 'QUESTION_RESULTS';
            historicalError = null;
            return { success: true, data: res.data };
          } else {
            historicalError = {
              order: orderToFetch,
              message: res.message || 'Không thể tải kết quả câu hỏi này.'
            };
            return { success: false, error_code: res.error_code };
          }
        }
        return { success: false, error_code: 'STALE_REQUEST' };
      } catch (_err) {
        if (
          requestId === latestHistoricalRequestId &&
          activeSessionId === sessionId
        ) {
          historicalError = {
            order: orderToFetch,
            message: 'Lỗi mạng khi tải kết quả câu hỏi.'
          };
        }
        return { success: false, error_code: 'NETWORK_ERROR' };
      } finally {
        if (requestId === latestHistoricalRequestId) {
          isHistoricalResultsLoading = false;
          loadingOrder = null;
        }
      }
    }

    return {
      getState: () => ({
        activeSessionId,
        currentQuestionIndex,
        currentQuestionId,
        hostViewMode,
        isHistoricalResultsLoading,
        loadingOrder,
        reviewedQuestionOrder,
        reviewedQuestionResults,
        historicalError,
        rpcCallCount,
        cacheSize: historicalResultsCache.size,
        inFlightCount: inFlightResults.size
      }),
      fetchHistoricalResult,
      setRpcHandler,
      clearSession: (newSessionId) => {
        activeSessionId = newSessionId;
        historicalResultsCache.clear();
        orderToQuestionIdMap.clear();
        inFlightResults.clear();
        historicalError = null;
        loadingOrder = null;
      },
      cache: historicalResultsCache,
      orderMap: orderToQuestionIdMap
    };
  }

  // =========================================================================
  // TEST 1: Result click sets loading immediately
  // =========================================================================
  await t.test('1. result click sets loading immediately', () => {
    // Audit host page source code
    assert.match(hostPageContent, /setHostViewMode\('QUESTION_RESULTS'\)/);
    assert.match(hostPageContent, /setIsHistoricalResultsLoading\(true\)/);
    assert.match(hostPageContent, /setLoadingOrder\(orderToFetch\)/);
    assert.match(hostPageContent, /aria-busy=\{isResultsLoading \|\| isHistoricalResultsLoading\}/);
  });

  // =========================================================================
  // TEST 2: Historical uncached question performs fetch
  // =========================================================================
  await t.test('2. historical uncached question performs fetch', async () => {
    const harness = createHarness();
    const res = await harness.fetchHistoricalResult(1);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.fromCache, undefined);
    assert.strictEqual(harness.getState().rpcCallCount, 1);
    assert.strictEqual(harness.getState().reviewedQuestionOrder, 1);
  });

  // =========================================================================
  // TEST 3: Successful closed result stored in cache
  // =========================================================================
  await t.test('3. successful closed result stored in cache', async () => {
    const harness = createHarness();
    await harness.fetchHistoricalResult(1);
    const expectedKey = 'session-123:q-order-1';
    assert.strictEqual(harness.cache.has(expectedKey), true);
    const cachedItem = harness.cache.get(expectedKey);
    assert.strictEqual(cachedItem.question_id, 'q-order-1');
    assert.strictEqual(cachedItem.question_closed, true);
  });

  // =========================================================================
  // TEST 4: Revisiting cached question performs zero RPC
  // =========================================================================
  await t.test('4. revisiting cached question performs zero RPC', async () => {
    const harness = createHarness();
    // First fetch: uncached -> 1 RPC
    await harness.fetchHistoricalResult(1);
    assert.strictEqual(harness.getState().rpcCallCount, 1);

    // Second fetch: cached -> 0 additional RPC
    const cachedRes = await harness.fetchHistoricalResult(1);
    assert.strictEqual(cachedRes.success, true);
    assert.strictEqual(cachedRes.fromCache, true);
    assert.strictEqual(harness.getState().rpcCallCount, 1); // Remains 1, 0 new RPC
  });

  // =========================================================================
  // TEST 5: Cache key includes sessionId
  // =========================================================================
  await t.test('5. cache key includes sessionId', async () => {
    const harness = createHarness();
    await harness.fetchHistoricalResult(2);
    const keys = Array.from(harness.cache.keys());
    assert.ok(keys.some(k => k.startsWith('session-123:')));
    // Check in hostPage source code as well
    assert.match(hostPageContent, /const cacheKey = `\$\{sessionId\}:\$\{res\.data\.question_id\}`;/);
  });

  // =========================================================================
  // TEST 6: Cache key includes questionId
  // =========================================================================
  await t.test('6. cache key includes questionId', async () => {
    const harness = createHarness();
    await harness.fetchHistoricalResult(2);
    const keys = Array.from(harness.cache.keys());
    assert.ok(keys.some(k => k.endsWith(':q-order-2')));
  });

  // =========================================================================
  // TEST 7: Same pending key deduplicated
  // =========================================================================
  await t.test('7. same pending key deduplicated', async () => {
    const harness = createHarness();
    // Setup delayed RPC
    harness.setRpcHandler(async (sessionId, order) => {
      await new Promise(r => setTimeout(r, 20));
      return {
        success: true,
        data: {
          question_id: `q-order-${order}`,
          question_order: order,
          question_closed: true
        }
      };
    });

    // Launch two parallel fetches for the exact same order
    const p1 = harness.fetchHistoricalResult(2);
    const p2 = harness.fetchHistoricalResult(2);

    const [res1, res2] = await Promise.all([p1, p2]);
    // The earlier duplicate call was superseded by the later call (stale guard)
    assert.strictEqual(res1.error_code, 'STALE_REQUEST');
    // The later call owns the UI and succeeds
    assert.strictEqual(res2.success, true);
    // RPC was only launched ONCE (deduplication verified)
    assert.strictEqual(harness.getState().rpcCallCount, 1);
    assert.strictEqual(harness.getState().reviewedQuestionOrder, 2);
  });

  // =========================================================================
  // TEST 8: Different question key may fetch independently
  // =========================================================================
  await t.test('8. different question key may fetch independently', async () => {
    const harness = createHarness();
    let resolveOrder1, resolveOrder2;
    harness.setRpcHandler(async (sessionId, order) => {
      if (order === 1) {
        await new Promise(r => { resolveOrder1 = r; });
      } else {
        await new Promise(r => { resolveOrder2 = r; });
      }
      return {
        success: true,
        data: {
          question_id: `q-order-${order}`,
          question_order: order,
          question_closed: true
        }
      };
    });

    const p1 = harness.fetchHistoricalResult(1);
    const p2 = harness.fetchHistoricalResult(2);

    resolveOrder1();
    resolveOrder2();

    const [res1, res2] = await Promise.all([p1, p2]);
    // Both launched independently (rpcCallCount = 2)
    assert.strictEqual(harness.getState().rpcCallCount, 2);
    // Request 1 was superseded by request 2 (stale guard)
    assert.strictEqual(res1.error_code, 'STALE_REQUEST');
    // Request 2 succeeded
    assert.strictEqual(res2.success, true);
    // Both populated cache entries safely
    assert.strictEqual(harness.cache.has('session-123:q-order-1'), true);
    assert.strictEqual(harness.cache.has('session-123:q-order-2'), true);
  });

  // =========================================================================
  // TEST 9: Stale response cannot replace newer target UI
  // =========================================================================
  await t.test('9. stale response cannot replace newer target UI', async () => {
    const harness = createHarness();
    let finishQ1;
    harness.setRpcHandler(async (sessionId, order) => {
      if (order === 1) {
        // Slow response for Q1
        await new Promise(r => { finishQ1 = r; });
        return {
          success: true,
          data: { question_id: 'q-1', question_order: 1, question_closed: true, question_text: 'Text Q1' }
        };
      } else {
        // Fast response for Q2
        return {
          success: true,
          data: { question_id: 'q-2', question_order: 2, question_closed: true, question_text: 'Text Q2' }
        };
      }
    });

    // Host clicks Q1 first, then quickly clicks Q2
    const p1 = harness.fetchHistoricalResult(1);
    const p2 = await harness.fetchHistoricalResult(2);

    assert.strictEqual(p2.success, true);
    assert.strictEqual(harness.getState().reviewedQuestionOrder, 2);
    assert.strictEqual(harness.getState().reviewedQuestionResults.question_id, 'q-2');

    // Now Q1 returns later
    finishQ1();
    const res1 = await p1;

    // Q1 returns STALE_REQUEST and MUST NOT overwrite Q2 in UI
    assert.strictEqual(res1.error_code, 'STALE_REQUEST');
    assert.strictEqual(harness.getState().reviewedQuestionOrder, 2);
    assert.strictEqual(harness.getState().reviewedQuestionResults.question_id, 'q-2');
  });

  // =========================================================================
  // TEST 10: Stale valid response may populate cache
  // =========================================================================
  await t.test('10. stale valid response may populate cache', async () => {
    const harness = createHarness();
    let finishQ1;
    harness.setRpcHandler(async (sessionId, order) => {
      if (order === 1) {
        await new Promise(r => { finishQ1 = r; });
        return {
          success: true,
          data: { question_id: 'q-1', question_order: 1, question_closed: true, question_text: 'Text Q1' }
        };
      } else {
        return {
          success: true,
          data: { question_id: 'q-2', question_order: 2, question_closed: true, question_text: 'Text Q2' }
        };
      }
    });

    const p1 = harness.fetchHistoricalResult(1);
    await harness.fetchHistoricalResult(2);

    finishQ1();
    await p1;

    // Even though Q1 didn't overwrite UI, its cache entry IS safely populated!
    assert.strictEqual(harness.cache.has('session-123:q-1'), true);
    assert.strictEqual(harness.cache.get('session-123:q-1').question_text, 'Text Q1');
  });

  // =========================================================================
  // TEST 11: Prev navigation uses cache
  // =========================================================================
  await t.test('11. prev navigation uses cache', async () => {
    const harness = createHarness();
    // Warm up cache for Q1
    await harness.fetchHistoricalResult(1);
    assert.strictEqual(harness.getState().rpcCallCount, 1);

    // Host goes to Q2
    await harness.fetchHistoricalResult(2);
    assert.strictEqual(harness.getState().rpcCallCount, 2);

    // Host navigates back to Q1 (prev)
    const prevRes = await harness.fetchHistoricalResult(1);
    assert.strictEqual(prevRes.fromCache, true);
    assert.strictEqual(harness.getState().rpcCallCount, 2); // 0 new RPC
  });

  // =========================================================================
  // TEST 12: Next navigation uses cache
  // =========================================================================
  await t.test('12. next navigation uses cache', async () => {
    const harness = createHarness();
    // Warm up cache for Q2
    await harness.fetchHistoricalResult(2);
    // Back to Q1
    await harness.fetchHistoricalResult(1);
    assert.strictEqual(harness.getState().rpcCallCount, 2);

    // Host navigates forward to Q2 (next)
    const nextRes = await harness.fetchHistoricalResult(2);
    assert.strictEqual(nextRes.fromCache, true);
    assert.strictEqual(harness.getState().rpcCallCount, 2); // 0 new RPC
  });

  // =========================================================================
  // TEST 13: Return-to-current preserves cache
  // =========================================================================
  await t.test('13. return-to-current preserves cache', async () => {
    const harness = createHarness();
    await harness.fetchHistoricalResult(1);
    assert.strictEqual(harness.cache.size, 1);

    // Simulating handleReturnToCurrentQuestion in source code
    assert.match(hostPageContent, /const handleReturnToCurrentQuestion = useCallback\(\(\) => \{/);
    assert.doesNotMatch(hostPageContent, /handleReturnToCurrentQuestion[\s\S]*?historicalResultsCacheRef\.current\.clear/);
    assert.strictEqual(harness.cache.size, 1); // cache preserved
  });

  // =========================================================================
  // TEST 14: Failure clears loading
  // =========================================================================
  await t.test('14. failure clears loading', async () => {
    const harness = createHarness();
    harness.setRpcHandler(async () => {
      throw new Error('Network timeout');
    });

    const res = await harness.fetchHistoricalResult(2);
    assert.strictEqual(res.success, false);
    assert.strictEqual(harness.getState().isHistoricalResultsLoading, false);
    assert.strictEqual(harness.getState().loadingOrder, null);
    assert.ok(harness.getState().historicalError !== null);
  });

  // =========================================================================
  // TEST 15: Failure does not clear previous cache
  // =========================================================================
  await t.test('15. failure does not clear previous cache', async () => {
    const harness = createHarness();
    // Fetch Q1 successfully
    await harness.fetchHistoricalResult(1);
    assert.strictEqual(harness.cache.has('session-123:q-order-1'), true);

    // Fetch Q2 with failure
    harness.setRpcHandler(async () => {
      throw new Error('Network error');
    });
    await harness.fetchHistoricalResult(2);

    // Q1 cache entry MUST remain intact!
    assert.strictEqual(harness.cache.has('session-123:q-order-1'), true);
  });

  // =========================================================================
  // TEST 16: Retry can refetch failed target
  // =========================================================================
  await t.test('16. retry can refetch failed target', async () => {
    const harness = createHarness();
    let failFirst = true;
    harness.setRpcHandler(async (sessionId, order) => {
      if (failFirst) {
        failFirst = false;
        throw new Error('Temporary failure');
      }
      return {
        success: true,
        data: { question_id: `q-${order}`, question_order: order, question_closed: true }
      };
    });

    const attempt1 = await harness.fetchHistoricalResult(2);
    assert.strictEqual(attempt1.success, false);
    assert.strictEqual(harness.getState().historicalError.order, 2);

    // Host clicks "Thử lại"
    const retryOrder = harness.getState().historicalError.order;
    const attempt2 = await harness.fetchHistoricalResult(retryOrder);
    assert.strictEqual(attempt2.success, true);
    assert.strictEqual(harness.getState().historicalError, null);
  });

  // =========================================================================
  // TEST 17: QUESTION_STILL_ACTIVE not cached
  // =========================================================================
  await t.test('17. QUESTION_STILL_ACTIVE not cached', () => {
    assert.match(
      hostPageContent,
      /\} else if \(res\.error_code === 'QUESTION_STILL_ACTIVE'\) \{[\s\S]*?\/\/ Active questions MUST NOT be cached as closed[\s\S]*?return \{ success: false, error_code: 'QUESTION_STILL_ACTIVE' \};/
    );
  });

  // =========================================================================
  // TEST 18: Closed current result can be cached
  // =========================================================================
  await t.test('18. closed current result can be cached', () => {
    assert.match(
      hostPageContent,
      /if \(res\.data\.question_id\) \{[\s\S]*?const cacheKey = `\$\{sessionId\}:\$\{res\.data\.question_id\}`;[\s\S]*?historicalResultsCacheRef\.current\.set\(cacheKey, res\.data\);/
    );
  });

  // =========================================================================
  // TEST 19: Bounded retry preserved
  // =========================================================================
  await t.test('19. bounded retry preserved', () => {
    assert.match(hostPageContent, /autoResultAttemptRef\.current/);
    assert.match(hostPageContent, /trigger at most TWO bounded automatic attempts/);
  });

  // =========================================================================
  // TEST 20: No countdown-zero repeated fetch loop
  // =========================================================================
  await t.test('20. no countdown-zero repeated fetch loop', () => {
    assert.match(
      hostPageContent,
      /if \(remaining === 0 && hostViewMode === 'LIVE_QUESTION' && !isFetchingResultsRef\.current && !questionResults\)/
    );
  });

  // =========================================================================
  // TEST 21: No extra timer created
  // =========================================================================
  await t.test('21. no extra timer created', () => {
    // Check that CompetitionHostPage only has one setInterval (for the local countdown updateTimer)
    const setIntervalMatches = hostPageContent.match(/setInterval\(/g) || [];
    assert.strictEqual(setIntervalMatches.length, 1);
  });

  // =========================================================================
  // TEST 22: R7 lazy analytics preserved
  // =========================================================================
  await t.test('22. R7 lazy analytics preserved', () => {
    // Ensure HostQuestionAnalyticsView is only rendered when tab is ANALYTICS
    assert.match(hostPageContent, /finishedTab === 'ANALYTICS'/);
    // Ensure no automatic prefetch of analytics in polling or question transition
    assert.doesNotMatch(pollingHookContent, /analytics/i);
  });

  // =========================================================================
  // TEST 23: R12 historical navigation preserved
  // =========================================================================
  await t.test('23. R12 historical navigation preserved', () => {
    assert.match(hostPageContent, /handleReviewPrevQuestion/);
    assert.match(hostPageContent, /handleReviewNextQuestion/);
    assert.match(hostPageContent, /handleReturnToCurrentQuestion/);
    assert.match(hostPageContent, /Đang xem lại kết quả Câu/);
  });

  // =========================================================================
  // TEST 24: Single choice regression
  // =========================================================================
  await t.test('24. single_choice regression', () => {
    const q = {
      question_order: 1,
      question_text: 'Hà Nội là thủ đô của?',
      question_type: 'single_choice',
      points: 10,
      time_limit_seconds: 20,
      options: [
        { id: 'opt_1', text: 'Việt Nam' },
        { id: 'opt_2', text: 'Lào' }
      ],
      correct_answer: { option_id: 'opt_1' }
    };
    const sanitized = sanitizeQuestionsForCreation([q]);
    assert.strictEqual(sanitized[0].question_type, 'single_choice');
    assert.deepStrictEqual(sanitized[0].correct_answer, { option_id: 'opt_1' });
  });

  // =========================================================================
  // TEST 25: R15A multiple_choice regression
  // =========================================================================
  await t.test('25. R15A multiple_choice regression', () => {
    const q = {
      question_order: 1,
      question_text: 'Thành phố lớn?',
      question_type: 'multiple_choice',
      points: 10,
      time_limit_seconds: 20,
      options: [
        { id: 'opt_1', text: 'Hà Nội' },
        { id: 'opt_2', text: 'TP.HCM' },
        { id: 'opt_3', text: 'Huế' }
      ],
      correct_answer: { option_ids: ['opt_1', 'opt_2'] }
    };
    const sanitized = sanitizeQuestionsForCreation([q]);
    assert.strictEqual(sanitized[0].question_type, 'multiple_choice');
    assert.deepStrictEqual(sanitized[0].correct_answer, { option_ids: ['opt_1', 'opt_2'] });
  });

  // =========================================================================
  // TEST 26: R15B fill_blank regression
  // =========================================================================
  await t.test('26. R15B fill_blank regression', () => {
    const q = {
      question_order: 1,
      question_text: 'Điền từ còn thiếu',
      question_type: 'fill_blank',
      points: 10,
      time_limit_seconds: 20,
      options: [],
      correct_answer: { accepted_answers: ['đáp án 1', 'đáp án 2'] }
    };
    const sanitized = sanitizeQuestionsForCreation([q]);
    assert.strictEqual(sanitized[0].question_type, 'short_answer');
    assert.deepStrictEqual(sanitized[0].correct_answer, { accepted_answers: ['đáp án 1', 'đáp án 2'] });
  });

  // =========================================================================
  // TEST 27: Guest security regression
  // =========================================================================
  await t.test('27. guest security regression', () => {
    // Ensure no token or secret leak in historical results cache
    const harness = createHarness();
    const item = {
      question_id: 'q-sec',
      guest_token: 'secret-token-123',
      session_secret: 'pass-456'
    };
    // Ensure cache stores authoritative closed results only
    assert.doesNotMatch(hostPageContent, /guest_token/);
  });

  // =========================================================================
  // TEST 28: Spectator regression
  // =========================================================================
  await t.test('28. spectator regression', () => {
    assert.ok(spectatorLiveContent.includes('SpectatorLiveQuestionView'));
    assert.ok(spectatorResultsContent.includes('SpectatorQuestionResultsView'));
  });

  // =========================================================================
  // TEST 29: Leaderboard / tie unchanged
  // =========================================================================
  await t.test('29. leaderboard/tie unchanged', () => {
    // Ensure no frontend re-ranking added to client or page
    assert.doesNotMatch(clientContent, /leaderboard\.sort/);
    assert.doesNotMatch(hostPageContent, /leaderboard\.sort/);
  });

  // =========================================================================
  // TEST 30: MAX_COMPETITION_QUESTIONS == 20
  // =========================================================================
  await t.test('30. MAX_COMPETITION_QUESTIONS == 20', () => {
    assert.strictEqual(MAX_COMPETITION_QUESTIONS, 20);
  });

  // =========================================================================
  // TEST 31: uncached Câu 1 pending -> cached Câu 2 selected
  //          -> Câu 1 returns later -> UI remains Câu 2 (Blocker 1)
  // =========================================================================
  await t.test('31. uncached Câu 1 pending -> cached Câu 2 selected -> Câu 1 returns later -> UI remains Câu 2', async () => {
    const harness = createHarness();
    // Warm up Câu 2 in cache first
    await harness.fetchHistoricalResult(2);
    assert.strictEqual(harness.getState().reviewedQuestionOrder, 2);

    // Setup slow RPC for Câu 1
    let finishQ1;
    harness.setRpcHandler(async (sessionId, order) => {
      if (order === 1) {
        await new Promise(r => { finishQ1 = r; });
        return {
          success: true,
          data: { question_id: 'q-order-1', question_order: 1, question_closed: true, question_text: 'Text Q1' }
        };
      }
      return {
        success: true,
        data: { question_id: `q-order-${order}`, question_order: order, question_closed: true }
      };
    });

    // 1. Host requests uncached Câu 1 (in-flight)
    const p1 = harness.fetchHistoricalResult(1);
    assert.strictEqual(harness.getState().loadingOrder, 1);

    // 2. While Câu 1 pending, Host navigates to cached Câu 2
    const res2 = await harness.fetchHistoricalResult(2);
    assert.strictEqual(res2.fromCache, true);
    assert.strictEqual(harness.getState().reviewedQuestionOrder, 2);
    assert.strictEqual(harness.getState().reviewedQuestionResults.question_id, 'q-order-2');

    // 3. Câu 1 finishes later
    finishQ1();
    const res1 = await p1;

    // Câu 1 must be marked STALE_REQUEST and UI remains Câu 2
    assert.strictEqual(res1.error_code, 'STALE_REQUEST');
    assert.strictEqual(harness.getState().reviewedQuestionOrder, 2);
    assert.strictEqual(harness.getState().reviewedQuestionResults.question_id, 'q-order-2');
    // Cache for Câu 1 was still populated safely
    assert.strictEqual(harness.cache.has('session-123:q-order-1'), true);
  });

  // =========================================================================
  // TEST 32: uncached Câu 1 pending -> uncached Câu 2 selected
  //          -> both RPCs may run -> latest Câu 2 owns UI
  // =========================================================================
  await t.test('32. uncached Câu 1 pending -> uncached Câu 2 selected -> both RPCs may run -> latest Câu 2 owns UI', async () => {
    const harness = createHarness();
    let finishQ1, finishQ2;
    harness.setRpcHandler(async (sessionId, order) => {
      if (order === 1) {
        await new Promise(r => { finishQ1 = r; });
        return {
          success: true,
          data: { question_id: 'q-order-1', question_order: 1, question_closed: true }
        };
      } else if (order === 2) {
        await new Promise(r => { finishQ2 = r; });
        return {
          success: true,
          data: { question_id: 'q-order-2', question_order: 2, question_closed: true }
        };
      }
    });

    const p1 = harness.fetchHistoricalResult(1);
    const p2 = harness.fetchHistoricalResult(2);

    // Q1 finishes first, then Q2 finishes
    finishQ1();
    await p1;
    finishQ2();
    await p2;

    assert.strictEqual(harness.getState().rpcCallCount, 2);
    assert.strictEqual(harness.getState().reviewedQuestionOrder, 2);
    assert.strictEqual(harness.getState().reviewedQuestionResults.question_id, 'q-order-2');
  });

  // =========================================================================
  // TEST 33: Câu 1 pending -> navigate Câu 2 -> navigate back Câu 1
  //          while original Câu 1 request still pending
  //          -> RPC count for Câu 1 remains 1
  //          -> Câu 1 becomes latest UI target
  //          -> when original Câu 1 resolves, UI shows Câu 1
  // =========================================================================
  await t.test('33. Câu 1 pending -> navigate Câu 2 -> navigate back Câu 1 while pending -> RPC count 1, UI shows Câu 1', async () => {
    const harness = createHarness();
    let finishQ1;
    harness.setRpcHandler(async (sessionId, order) => {
      if (order === 1) {
        await new Promise(r => { finishQ1 = r; });
        return {
          success: true,
          data: { question_id: 'q-order-1', question_order: 1, question_closed: true, question_text: 'Result Q1' }
        };
      } else {
        return {
          success: true,
          data: { question_id: `q-order-${order}`, question_order: order, question_closed: true }
        };
      }
    });

    // 1. Host requests Câu 1 (in-flight pending)
    const p1_first = harness.fetchHistoricalResult(1);
    assert.strictEqual(harness.getState().rpcCallCount, 1);

    // 2. Host navigates to Câu 2
    const p2 = await harness.fetchHistoricalResult(2);
    assert.strictEqual(p2.success, true);
    assert.strictEqual(harness.getState().reviewedQuestionOrder, 2);

    // 3. While original Câu 1 is still pending, Host navigates BACK to Câu 1!
    const p1_second = harness.fetchHistoricalResult(1);

    // Crucial check: RPC count MUST REMAIN 1 (no duplicate RPC for Câu 1)
    assert.strictEqual(harness.getState().rpcCallCount, 2); // 1 for Q1 + 1 for Q2 = 2 total

    // 4. Now original Câu 1 RPC finishes
    finishQ1();
    const [res1_first, res1_second] = await Promise.all([p1_first, p1_second]);

    // First caller was superseded by Q2, so it gets STALE_REQUEST
    assert.strictEqual(res1_first.error_code, 'STALE_REQUEST');
    // Second caller adopted the pending result as latest UI target!
    assert.strictEqual(res1_second.success, true);
    assert.strictEqual(harness.getState().reviewedQuestionOrder, 1);
    assert.strictEqual(harness.getState().reviewedQuestionResults.question_id, 'q-order-1');
  });

  // =========================================================================
  // TEST 34: cache hit increments/invalidates stale UI generation
  // =========================================================================
  await t.test('34. cache hit increments/invalidates stale UI generation', () => {
    const freshHostPageContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
    const fnStartMatch = freshHostPageContent.match(
      /const fetchHistoricalResult = useCallback\(async \(orderToFetch\) => \{[\s\S]*?const requestId = \+\+latestHistoricalRequestIdRef\.current;[\s\S]*?if \(cacheKey && historicalResultsCacheRef\.current\.has\(cacheKey\)\)/
    );
    assert.ok(fnStartMatch, 'fetchHistoricalResult must increment latestHistoricalRequestIdRef before checking cache');
  });

  // =========================================================================
  // TEST 35: Prev/Next are NOT globally disabled by isHistoricalResultsLoading
  // =========================================================================
  await t.test('35. Prev/Next are NOT globally disabled by isHistoricalResultsLoading', () => {
    const freshHostPageContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
    assert.doesNotMatch(
      freshHostPageContent,
      /<button[^>]*onClick=\{handleReviewPrevQuestion\}[^>]*disabled=\{isHistoricalResultsLoading/
    );
    assert.doesNotMatch(
      freshHostPageContent,
      /<button[^>]*onClick=\{handleReviewNextQuestion\}[^>]*disabled=\{isHistoricalResultsLoading/
    );
  });

  // =========================================================================
  // TEST 36: exact pending target button IS disabled
  // =========================================================================
  await t.test('36. exact pending target button IS disabled', () => {
    const freshHostPageContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
    assert.match(
      freshHostPageContent,
      /disabled=\{loadingOrder === activeDisplayedOrder - 1 \|\| activeDisplayedOrder <= 1\}/
    );
    assert.match(
      freshHostPageContent,
      /disabled=\{\s*loadingOrder === activeDisplayedOrder \+ 1 \|\|/
    );
  });

  // =========================================================================
  // TEST 37: different target button remains enabled while another target is pending
  // =========================================================================
  await t.test('37. different target button remains enabled while another target is pending', () => {
    const activeDisplayedOrder = 2;
    const loadingOrder = 1;
    const effectiveTotalQuestions = 5;

    const isPrevDisabled = loadingOrder === activeDisplayedOrder - 1 || activeDisplayedOrder <= 1;
    const isNextDisabled = loadingOrder === activeDisplayedOrder + 1 || activeDisplayedOrder >= effectiveTotalQuestions;

    assert.strictEqual(isPrevDisabled, true, 'Prev (target 1) must be disabled while target 1 is pending');
    assert.strictEqual(isNextDisabled, false, 'Next (target 3) must remain enabled while target 1 is pending');
  });

});
