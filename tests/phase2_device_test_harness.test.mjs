import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 2 — Physical Device Isolated Test Harness Verification', () => {
  const harnessPath = path.resolve('src/pages/Phase2DeviceTestHarnessPage.jsx');
  const appPath = path.resolve('src/App.jsx');
  const fixturePath = path.resolve('public/test-fixtures/phase2-annotation-sample.svg');

  const harnessSource = fs.readFileSync(harnessPath, 'utf8');
  const appSource = fs.readFileSync(appPath, 'utf8');

  it('1. should verify NO Supabase client or RPC imports in Test Harness page', () => {
    assert(!harnessSource.includes("from '../lib/supabase'"), 'Harness must not import supabase client');
    assert(!harnessSource.includes("from '../../../lib/supabase'"), 'Harness must not import supabase client');
    assert(!harnessSource.includes('submissionAnnotationClient'), 'Harness must not import submissionAnnotationClient');
    assert(!harnessSource.includes('getStudentGradedSubmission'), 'Harness must not import getStudentGradedSubmission');
    assert(!harnessSource.includes('saveAnnotationDraft'), 'Harness must not import saveAnnotationDraft');
    assert(!harnessSource.includes('finalizeGradingWithAnnotations'), 'Harness must not import finalizeGradingWithAnnotations');
  });

  it('2. should verify NO backend RPC calls or database queries in Test Harness source', () => {
    assert(!harnessSource.includes('.rpc('), 'Harness must not execute RPC calls');
    assert(!harnessSource.includes('.from('), 'Harness must not query Supabase tables');
    assert(!harnessSource.includes('.storage'), 'Harness must not call Supabase storage');
  });

  it('3. should verify static local fixture image exists and is used', () => {
    assert(fs.existsSync(fixturePath), 'Fixture SVG image must exist in public/test-fixtures');
    const svgContent = fs.readFileSync(fixturePath, 'utf8');
    assert(svgContent.includes('<svg') && svgContent.includes('PHIẾU BÀI TẬP TOÁN TIỂU HỌC'), 'SVG fixture must be valid');
    assert(harnessSource.includes('/test-fixtures/phase2-annotation-sample.svg'), 'Harness must use local fixture path');
  });

  it('4. should initialize and maintain schema_version = 1 in memory', () => {
    assert(harnessSource.includes('schema_version: 1'), 'Initial annotation payload must use schema_version: 1');
    assert(harnessSource.includes('normalizeAnnotationPayload'), 'Harness must use defensive normalizeAnnotationPayload');
  });

  it('5. should reuse real Phase 2 Teacher components (SubmissionAnnotationCanvas)', () => {
    assert(harnessSource.includes('import { SubmissionAnnotationCanvas }'), 'Must import SubmissionAnnotationCanvas');
    assert(harnessSource.includes('<SubmissionAnnotationCanvas'), 'Must render SubmissionAnnotationCanvas');
  });

  it('6. should reuse real Phase 2 Student component (StudentAnnotationViewer)', () => {
    assert(harnessSource.includes('import { StudentAnnotationViewer }'), 'Must import StudentAnnotationViewer');
    assert(harnessSource.includes('<StudentAnnotationViewer'), 'Must render StudentAnnotationViewer');
  });

  it('7. should provide a clean in-memory Reset Fixture mechanism', () => {
    assert(harnessSource.includes('handleResetFixture'), 'Must provide handleResetFixture');
    assert(harnessSource.includes('Đặt lại mẫu'), 'Reset button text must be present');
  });

  it('8. should enforce environment flag guard (disabled by default in production)', () => {
    assert(harnessSource.includes('import.meta.env.DEV'), 'Must check DEV env');
    assert(harnessSource.includes('import.meta.env.VITE_ENABLE_PHASE2_TEST_HARNESS'), 'Must check VITE_ENABLE_PHASE2_TEST_HARNESS flag');
    assert(harnessSource.includes('404 - Trang Không Tồn Tại'), 'Must render 404 message when flag is off');
  });

  it('9. should verify route /phase2-device-test registered in App.jsx', () => {
    assert(appSource.includes('path="/phase2-device-test"'), 'App.jsx must register /phase2-device-test');
    assert(appSource.includes('Phase2DeviceTestHarnessPage'), 'App.jsx must import Phase2DeviceTestHarnessPage');
  });
});
