// tests/notificationClient.test.mjs
// Unit tests cho NotificationClient API Service
// Sử dụng Mock Client 100%, độc lập hoàn toàn với Network / Hosted Staging

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNotification,
  publishNotification,
  recallNotification,
  getMyNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  getSentNotifications,
  deleteDraftNotification,
  formatNotificationError,
  NOTIFICATION_ERROR_MAP
} from '../src/services/notificationClient.js';

test('=== NOTIFICATIONS V1: FRONTEND API SERVICE UNIT TESTS ===', async (t) => {

  await t.test('1. formatNotificationError: Ánh xạ chính xác các mã lỗi PostgreSQL/RPC sang Tiếng Việt', () => {
    // Kiểm tra lỗi FORBIDDEN_CLASS
    const errClass = formatNotificationError(new Error('P0001: FORBIDDEN_CLASS: Teacher does not teach class'));
    assert.equal(errClass.code, 'FORBIDDEN_CLASS');
    assert.equal(errClass.message, NOTIFICATION_ERROR_MAP.FORBIDDEN_CLASS);

    // Kiểm tra lỗi FORBIDDEN_ROLE
    const errRole = formatNotificationError(new Error('FORBIDDEN_ROLE: Only admins can perform this'));
    assert.equal(errRole.code, 'FORBIDDEN_ROLE');
    assert.equal(errRole.message, NOTIFICATION_ERROR_MAP.FORBIDDEN_ROLE);

    // Kiểm tra lỗi FORBIDDEN_ACCOUNT_DISABLED
    const errDisabled = formatNotificationError(new Error('FORBIDDEN_ACCOUNT_DISABLED: Account is disabled'));
    assert.equal(errDisabled.code, 'FORBIDDEN_ACCOUNT_DISABLED');
    assert.equal(errDisabled.message, NOTIFICATION_ERROR_MAP.FORBIDDEN_ACCOUNT_DISABLED);

    // Kiểm tra lỗi UNAUTHENTICATED
    const errAuth = formatNotificationError(new Error('UNAUTHENTICATED: User is not authenticated'));
    assert.equal(errAuth.code, 'UNAUTHENTICATED');
    assert.equal(errAuth.message, NOTIFICATION_ERROR_MAP.UNAUTHENTICATED);

    // Kiểm tra lỗi FORBIDDEN_NOT_RECIPIENT
    const errNotRecipient = formatNotificationError(new Error('FORBIDDEN_NOT_RECIPIENT: You are not a recipient'));
    assert.equal(errNotRecipient.code, 'FORBIDDEN_NOT_RECIPIENT');
    assert.equal(errNotRecipient.message, NOTIFICATION_ERROR_MAP.FORBIDDEN_NOT_RECIPIENT);

    // Kiểm tra lỗi mạng (NetworkError / Failed to fetch)
    const errNet = formatNotificationError(new TypeError('Failed to fetch'));
    assert.equal(errNet.code, 'NETWORK_ERROR');
    assert.equal(errNet.message, NOTIFICATION_ERROR_MAP.NETWORK_ERROR);

    // Kiểm tra fallback cho lỗi tùy biến không rõ mã
    const errUnknown = formatNotificationError(new Error('Custom database error XYZ'));
    assert.equal(errUnknown.message, 'Custom database error XYZ');
  });

  await t.test('2. createNotification: Validate tham số đầu vào và gọi đúng RPC', async () => {
    // Test fail-fast khi thiếu title hoặc content
    const resEmpty = await createNotification({ title: '', content: '' });
    assert.equal(resEmpty.ok, false);
    assert.equal(resEmpty.error.code, 'MISSING_TITLE_OR_CONTENT');

    let rpcCalledWith = null;
    let callCount = 0;
    const mockClient = {
      rpc: async (fnName, params) => {
        callCount++;
        rpcCalledWith = { fnName, params };
        return { data: '550e8400-e29b-41d4-a716-446655440000', error: null };
      }
    };

    const res = await createNotification({
      title: 'Thông báo nộp bài tập',
      content: 'Hạn chót nộp bài là 20h tối nay.',
      priority: 'high',
      category: 'assignment',
      targetType: 'classes',
      targetClassIds: ['a17c24d8-c090-4287-9642-703e77873af9'],
      linkedResourceType: 'exercise',
      linkedResourceId: 'b28d35e9-d101-4398-a753-814f88984ba0',
      linkUrl: 'https://example.com/homework',
      publishNow: true
    }, mockClient);

    assert.equal(res.ok, true);
    assert.equal(res.data, '550e8400-e29b-41d4-a716-446655440000');
    assert.equal(callCount, 1, 'Chỉ gọi đúng 1 lần, không được tự động retry');
    assert.equal(rpcCalledWith.fnName, 'rpc_create_notification');
    assert.equal(rpcCalledWith.params.p_title, 'Thông báo nộp bài tập');
    assert.equal(rpcCalledWith.params.p_priority, 'high');
    assert.equal(rpcCalledWith.params.p_category, 'assignment');
    assert.equal(rpcCalledWith.params.p_target_type, 'classes');
    assert.deepEqual(rpcCalledWith.params.p_target_class_ids, ['a17c24d8-c090-4287-9642-703e77873af9']);
    assert.equal(rpcCalledWith.params.p_publish_now, true);
  });

  await t.test('3. createNotification: Xử lý lỗi từ database và không tự ý retry', async () => {
    let callCount = 0;
    const mockClient = {
      rpc: async () => {
        callCount++;
        return { data: null, error: { message: 'FORBIDDEN_CLASS: Not your class' } };
      }
    };

    const res = await createNotification({
      title: 'Test',
      content: 'Content',
      targetType: 'classes',
      targetClassIds: ['99999999-9999-9999-9999-999999999999']
    }, mockClient);

    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'FORBIDDEN_CLASS');
    assert.equal(res.error.message, NOTIFICATION_ERROR_MAP.FORBIDDEN_CLASS);
    assert.equal(callCount, 1, 'Không được retry khi database từ chối quyền');
  });

  await t.test('4. publishNotification: R3-FIX-01 Boolean RPC Success Guard (chỉ data === true mới ok: true)', async () => {
    // 4.1. data === true, error === null -> THÀNH CÔNG
    let callCount = 0;
    let rpcArgs = null;
    const mockSuccess = {
      rpc: async (fnName, params) => {
        callCount++;
        rpcArgs = { fnName, params };
        return { data: true, error: null };
      }
    };
    const resSuccess = await publishNotification('e19de13b-6d35-4511-b011-0e36a08f63f7', mockSuccess);
    assert.equal(resSuccess.ok, true);
    assert.equal(resSuccess.data, true);
    assert.equal(callCount, 1, 'Không được retry RPC');
    assert.equal(rpcArgs.fnName, 'rpc_publish_notification');
    assert.equal(rpcArgs.params.p_notification_id, 'e19de13b-6d35-4511-b011-0e36a08f63f7');

    // 4.2. data === false, error === null -> KHÔNG THÀNH CÔNG (ok: false, data: false)
    callCount = 0;
    const mockFalse = {
      rpc: async () => {
        callCount++;
        return { data: false, error: null };
      }
    };
    const resFalse = await publishNotification('notif-id-1', mockFalse);
    assert.equal(resFalse.ok, false);
    assert.equal(resFalse.data, false);
    assert.ok(resFalse.error instanceof Error);
    assert.equal(callCount, 1);

    // 4.3. data === null, error === null -> KHÔNG THÀNH CÔNG
    const mockNull = { rpc: async () => ({ data: null, error: null }) };
    const resNull = await publishNotification('notif-id-1', mockNull);
    assert.equal(resNull.ok, false);
    assert.equal(resNull.data, false);
    assert.ok(resNull.error instanceof Error);

    // 4.4. data === undefined, error === null -> KHÔNG THÀNH CÔNG
    const mockUndefined = { rpc: async () => ({ data: undefined, error: null }) };
    const resUndef = await publishNotification('notif-id-1', mockUndefined);
    assert.equal(resUndef.ok, false);
    assert.equal(resUndef.data, false);
    assert.ok(resUndef.error instanceof Error);

    // 4.5. data === "true" (string), error === null -> KHÔNG ĐƯỢC COI LÀ THÀNH CÔNG
    const mockStrTrue = { rpc: async () => ({ data: 'true', error: null }) };
    const resStrTrue = await publishNotification('notif-id-1', mockStrTrue);
    assert.equal(resStrTrue.ok, false);
    assert.equal(resStrTrue.data, false);
    assert.ok(resStrTrue.error instanceof Error);

    // 4.6. data === 1 (number), error === null -> KHÔNG ĐƯỢC COI LÀ THÀNH CÔNG
    const mockNum1 = { rpc: async () => ({ data: 1, error: null }) };
    const resNum1 = await publishNotification('notif-id-1', mockNum1);
    assert.equal(resNum1.ok, false);
    assert.equal(resNum1.data, false);
    assert.ok(resNum1.error instanceof Error);

    // 4.7. data === null, error === Error -> Lỗi được format
    const mockError = { rpc: async () => ({ data: null, error: { message: 'FORBIDDEN_PUBLISH_RECALLED: Cannot publish' } }) };
    const resErr = await publishNotification('notif-id-1', mockError);
    assert.equal(resErr.ok, false);
    assert.equal(resErr.data, false);
    assert.equal(resErr.error.code, 'FORBIDDEN_PUBLISH_RECALLED');

    // 4.8. RPC ném exception -> Xử lý an toàn, không báo thành công giả
    const mockThrow = {
      rpc: async () => {
        throw new Error('Network request failed');
      }
    };
    const resThrow = await publishNotification('notif-id-1', mockThrow);
    assert.equal(resThrow.ok, false);
    assert.equal(resThrow.data, false);
    assert.equal(resThrow.error.code, 'NETWORK_ERROR');

    // 4.9. Test trường hợp thiếu ID
    const resNoId = await publishNotification('', mockSuccess);
    assert.equal(resNoId.ok, false);
    assert.equal(resNoId.data, false);
  });

  await t.test('5. recallNotification: R3-FIX-01 Boolean RPC Success Guard (chỉ data === true mới ok: true)', async () => {
    // 5.1. data === true, error === null -> THÀNH CÔNG kèm lý do
    let callCount = 0;
    let rpcArgs = null;
    const mockSuccess = {
      rpc: async (fnName, params) => {
        callCount++;
        rpcArgs = { fnName, params };
        return { data: true, error: null };
      }
    };

    const res = await recallNotification('83d46317-0df5-461d-a01c-0e61b37fa846', 'Nhầm lịch thi', mockSuccess);
    assert.equal(res.ok, true);
    assert.equal(res.data, true);
    assert.equal(callCount, 1, 'Không được retry RPC');
    assert.equal(rpcArgs.fnName, 'rpc_recall_notification');
    assert.equal(rpcArgs.params.p_notification_id, '83d46317-0df5-461d-a01c-0e61b37fa846');
    assert.equal(rpcArgs.params.p_reason, 'Nhầm lịch thi');

    // 5.2. data === false, error === null -> KHÔNG THÀNH CÔNG (ok: false, data: false)
    callCount = 0;
    const mockFalse = {
      rpc: async () => {
        callCount++;
        return { data: false, error: null };
      }
    };
    const resFalse = await recallNotification('notif-id-2', 'Lý do', mockFalse);
    assert.equal(resFalse.ok, false);
    assert.equal(resFalse.data, false);
    assert.ok(resFalse.error instanceof Error);
    assert.equal(callCount, 1);

    // 5.3. data === null, error === null -> KHÔNG THÀNH CÔNG
    const mockNull = { rpc: async () => ({ data: null, error: null }) };
    const resNull = await recallNotification('notif-id-2', null, mockNull);
    assert.equal(resNull.ok, false);
    assert.equal(resNull.data, false);

    // 5.4. data === undefined, error === null -> KHÔNG THÀNH CÔNG
    const mockUndefined = { rpc: async () => ({ data: undefined, error: null }) };
    const resUndef = await recallNotification('notif-id-2', null, mockUndefined);
    assert.equal(resUndef.ok, false);
    assert.equal(resUndef.data, false);

    // 5.5. data === "true" (string), error === null -> KHÔNG ĐƯỢC COI LÀ THÀNH CÔNG
    const mockStrTrue = { rpc: async () => ({ data: 'true', error: null }) };
    const resStrTrue = await recallNotification('notif-id-2', null, mockStrTrue);
    assert.equal(resStrTrue.ok, false);
    assert.equal(resStrTrue.data, false);

    // 5.6. data === 1 (number), error === null -> KHÔNG ĐƯỢC COI LÀ THÀNH CÔNG
    const mockNum1 = { rpc: async () => ({ data: 1, error: null }) };
    const resNum1 = await recallNotification('notif-id-2', null, mockNum1);
    assert.equal(resNum1.ok, false);
    assert.equal(resNum1.data, false);

    // 5.7. data === null, error === Error -> Lỗi được format
    const mockError = { rpc: async () => ({ data: null, error: { message: 'FORBIDDEN_ROLE: Not allowed' } }) };
    const resErr = await recallNotification('notif-id-2', null, mockError);
    assert.equal(resErr.ok, false);
    assert.equal(resErr.data, false);
    assert.equal(resErr.error.code, 'FORBIDDEN_ROLE');

    // 5.8. RPC ném exception -> Xử lý an toàn, không báo thành công giả
    const mockThrow = {
      rpc: async () => {
        throw new TypeError('Failed to fetch');
      }
    };
    const resThrow = await recallNotification('notif-id-2', null, mockThrow);
    assert.equal(resThrow.ok, false);
    assert.equal(resThrow.data, false);
    assert.equal(resThrow.error.code, 'NETWORK_ERROR');

    // 5.9. Test trường hợp thiếu ID
    const resNoId = await recallNotification('', null, mockSuccess);
    assert.equal(resNoId.ok, false);
    assert.equal(resNoId.data, false);
  });

  await t.test('6. getMyNotifications: Lấy hộp thư đến của học sinh với đầy đủ cấu trúc', async () => {
    const mockData = [
      {
        id: 'notif-1',
        title: 'Bài tập mới',
        content: 'Làm bài trang 5',
        priority: 'high',
        category: 'assignment',
        linked_resource_type: 'exercise',
        linked_resource_id: 'res-1',
        link_url: null,
        published_at: '2026-10-24T00:00:00Z',
        sender_name: 'Cô Lan',
        is_read: false,
        read_at: null
      }
    ];

    let rpcArgs = null;
    const mockClient = {
      rpc: async (fnName, params) => {
        rpcArgs = { fnName, params };
        return { data: mockData, error: null };
      }
    };

    const res = await getMyNotifications({ limit: 10, offset: 0, unreadOnly: true }, mockClient);
    assert.equal(res.ok, true);
    assert.equal(res.data.length, 1);
    assert.equal(res.data[0].title, 'Bài tập mới');
    assert.equal(res.data[0].is_read, false);
    assert.equal(rpcArgs.fnName, 'rpc_get_my_notifications');
    assert.equal(rpcArgs.params.p_limit, 10);
    assert.equal(rpcArgs.params.p_offset, 0);
    assert.equal(rpcArgs.params.p_unread_only, true);
  });

  await t.test('7. getUnreadNotificationCount: Đếm số lượng thông báo chưa đọc', async () => {
    const mockClient = {
      rpc: async (fnName) => {
        assert.equal(fnName, 'rpc_get_unread_notification_count');
        return { data: 5, error: null };
      }
    };

    const res = await getUnreadNotificationCount(mockClient);
    assert.equal(res.ok, true);
    assert.equal(res.data, 5);

    // Test trường hợp database trả về lỗi -> trả về data: 0 kèm error
    const mockErrorClient = {
      rpc: async () => ({ data: null, error: { message: 'Database connection failed' } })
    };
    const resErr = await getUnreadNotificationCount(mockErrorClient);
    assert.equal(resErr.ok, false);
    assert.equal(resErr.data, 0);
    assert.ok(resErr.error);
  });

  await t.test('8. markNotificationAsRead: R3-FIX-02 Boolean RPC Success Guard (chỉ data === true mới ok: true)', async () => {
    // 8.1. data === true, error === null -> THÀNH CÔNG
    let callCount = 0;
    let rpcArgs = null;
    const mockSuccess = {
      rpc: async (fnName, params) => {
        callCount++;
        rpcArgs = { fnName, params };
        return { data: true, error: null };
      }
    };

    const res = await markNotificationAsRead('notif-123', mockSuccess);
    assert.equal(res.ok, true);
    assert.equal(res.data, true);
    assert.equal(callCount, 1, 'Không được tự ý retry RPC');
    assert.equal(rpcArgs.fnName, 'rpc_mark_notification_as_read');
    assert.equal(rpcArgs.params.p_notification_id, 'notif-123');

    // 8.2. data === false, error === null -> KHÔNG THÀNH CÔNG (ok: false, data: false)
    callCount = 0;
    const mockFalse = {
      rpc: async () => {
        callCount++;
        return { data: false, error: null };
      }
    };
    const resFalse = await markNotificationAsRead('notif-123', mockFalse);
    assert.equal(resFalse.ok, false);
    assert.equal(resFalse.data, false);
    assert.ok(resFalse.error instanceof Error);
    assert.equal(callCount, 1, 'Không được retry RPC');

    // 8.3. data === null, error === null -> KHÔNG THÀNH CÔNG
    const mockNull = { rpc: async () => ({ data: null, error: null }) };
    const resNull = await markNotificationAsRead('notif-123', mockNull);
    assert.equal(resNull.ok, false);
    assert.equal(resNull.data, false);
    assert.ok(resNull.error instanceof Error);

    // 8.4. data === undefined, error === null -> KHÔNG THÀNH CÔNG
    const mockUndefined = { rpc: async () => ({ data: undefined, error: null }) };
    const resUndef = await markNotificationAsRead('notif-123', mockUndefined);
    assert.equal(resUndef.ok, false);
    assert.equal(resUndef.data, false);
    assert.ok(resUndef.error instanceof Error);

    // 8.5. data === "true" (string), error === null -> KHÔNG ĐƯỢC COI LÀ THÀNH CÔNG
    const mockStrTrue = { rpc: async () => ({ data: 'true', error: null }) };
    const resStrTrue = await markNotificationAsRead('notif-123', mockStrTrue);
    assert.equal(resStrTrue.ok, false);
    assert.equal(resStrTrue.data, false);
    assert.ok(resStrTrue.error instanceof Error);

    // 8.6. data === 1 (number), error === null -> KHÔNG ĐƯỢC COI LÀ THÀNH CÔNG
    const mockNum1 = { rpc: async () => ({ data: 1, error: null }) };
    const resNum1 = await markNotificationAsRead('notif-123', mockNum1);
    assert.equal(resNum1.ok, false);
    assert.equal(resNum1.data, false);
    assert.ok(resNum1.error instanceof Error);

    // 8.7. data === null, error === Error -> Lỗi được format
    const mockError = { rpc: async () => ({ data: null, error: { message: 'FORBIDDEN_NOT_RECIPIENT: You are not a recipient' } }) };
    const resErr = await markNotificationAsRead('notif-123', mockError);
    assert.equal(resErr.ok, false);
    assert.equal(resErr.data, false);
    assert.equal(resErr.error.code, 'FORBIDDEN_NOT_RECIPIENT');

    // 8.8. RPC ném exception -> Xử lý an toàn, không báo thành công giả
    const mockThrow = {
      rpc: async () => {
        throw new TypeError('Failed to fetch');
      }
    };
    const resThrow = await markNotificationAsRead('notif-123', mockThrow);
    assert.equal(resThrow.ok, false);
    assert.equal(resThrow.data, false);
    assert.equal(resThrow.error.code, 'NETWORK_ERROR');

    // 8.9. Test trường hợp thiếu ID
    const resNoId = await markNotificationAsRead('', mockSuccess);
    assert.equal(resNoId.ok, false);
    assert.equal(resNoId.data, false);
  });

  await t.test('9. getSentNotifications: Truy vấn danh sách tin đã tạo kèm filter trạng thái & sắp xếp tất định (created_at DESC, id DESC)', async () => {
    let queryState = {
      table: null,
      selected: null,
      filters: [],
      orders: [],
      range: null
    };

    const mockQueryBuilder = {
      select: function(fields, opts) {
        queryState.selected = fields;
        queryState.countOpt = opts;
        return this;
      },
      order: function(col, opts) {
        queryState.orders.push({ col, opts });
        return this;
      },
      range: function(from, to) {
        queryState.range = { from, to };
        return this;
      },
      eq: function(col, val) {
        queryState.filters.push({ col, val });
        return this;
      },
      then: function(onFulfilled) {
        const dummyRows = [
          { id: 'sent-2', title: 'Thông báo lớp 1B', created_at: '2026-10-24T10:00:00Z', is_published: true, is_recalled: false },
          { id: 'sent-1', title: 'Thông báo lớp 1A', created_at: '2026-10-24T10:00:00Z', is_published: true, is_recalled: false }
        ];
        return Promise.resolve({ data: dummyRows, count: 2, error: null }).then(onFulfilled);
      }
    };

    const mockClient = {
      from: (tableName) => {
        queryState.table = tableName;
        return mockQueryBuilder;
      }
    };

    const res = await getSentNotifications({ limit: 15, offset: 0, status: 'published' }, mockClient);
    assert.equal(res.ok, true);
    assert.equal(res.data.length, 2);
    assert.equal(res.count, 2);
    assert.equal(queryState.table, 'notifications');
    assert.deepEqual(queryState.range, { from: 0, to: 14 });
    // R3-D1 Pagination Hardening: Sắp xếp sơ cấp created_at DESC, thứ cấp id DESC
    assert.equal(queryState.orders.length, 2, 'Phải có 2 tiêu chí sắp xếp để tạo thứ tự tất định');
    assert.deepEqual(queryState.orders[0], { col: 'created_at', opts: { ascending: false } });
    assert.deepEqual(queryState.orders[1], { col: 'id', opts: { ascending: false } });
    assert.ok(queryState.filters.some(f => f.col === 'is_published' && f.val === true));
    assert.ok(queryState.filters.some(f => f.col === 'is_recalled' && f.val === false));
  });

  await t.test('10. deleteDraftNotification: Chỉ xóa thông báo khi is_published = false', async () => {
    let deleteState = {
      table: null,
      deleted: false,
      filters: []
    };

    const mockQueryBuilder = {
      delete: function() {
        deleteState.deleted = true;
        return this;
      },
      eq: function(col, val) {
        deleteState.filters.push({ col, val });
        return this;
      },
      then: function(onFulfilled) {
        return Promise.resolve({ error: null }).then(onFulfilled);
      }
    };

    const mockClient = {
      from: (tableName) => {
        deleteState.table = tableName;
        return mockQueryBuilder;
      }
    };

    const res = await deleteDraftNotification('draft-uuid-1', mockClient);
    assert.equal(res.ok, true);
    assert.equal(deleteState.table, 'notifications');
    assert.equal(deleteState.deleted, true);
    assert.ok(deleteState.filters.some(f => f.col === 'id' && f.val === 'draft-uuid-1'));
    assert.ok(deleteState.filters.some(f => f.col === 'is_published' && f.val === false));
  });

});
