import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('ADMIN UPDATE PROFILE MIGRATION STATIC VALIDATION SUITE', async (t) => {
  const migrationPath = 'supabase/migrations/20261007180000_fix_admin_update_profile_signature.sql';
  assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

  const content = fs.readFileSync(migrationPath, 'utf8');

  await t.test('1. Drops stale 5-argument overload explicitly', () => {
    assert.ok(content.includes('DROP FUNCTION IF EXISTS public.admin_update_profile(UUID, TEXT, INT, INT, INT);'));
  });

  await t.test('2. Creates canonical 6-argument function', () => {
    assert.ok(content.includes('CREATE OR REPLACE FUNCTION public.admin_update_profile('));
    assert.ok(content.includes('p_target_user_id UUID,'));
    assert.ok(content.includes('p_full_name TEXT DEFAULT NULL,'));
    assert.ok(content.includes('p_role TEXT DEFAULT NULL,'));
    assert.ok(content.includes('p_grade_level INT DEFAULT NULL,'));
    assert.ok(content.includes('p_total_stars INT DEFAULT NULL,'));
    assert.ok(content.includes('p_total_coins INT DEFAULT NULL'));
  });

  await t.test('3. Sets SECURITY DEFINER and safe search_path', () => {
    assert.ok(content.includes('SECURITY DEFINER'));
    assert.ok(content.includes("SET search_path = ''"));
  });

  await t.test('4. Includes admin role gate check', () => {
    assert.ok(content.includes('v_caller_role IS DISTINCT FROM'));
    assert.ok(content.includes("'admin'"));
  });

  await t.test('5. Validates role values strictly', () => {
    assert.ok(content.includes("p_role NOT IN ('student', 'teacher', 'admin')"));
  });

  await t.test('6. Validates grade_level (1 to 12)', () => {
    assert.ok(content.includes('p_grade_level < 1 OR p_grade_level > 12'));
  });

  await t.test('7. Validates total_stars >= 0', () => {
    assert.ok(content.includes('p_total_stars < 0'));
  });

  await t.test('8. Validates total_coins >= 0', () => {
    assert.ok(content.includes('p_total_coins < 0'));
  });

  await t.test('9. Updates full_name with TRIM and NULLIF', () => {
    assert.ok(content.includes("full_name = COALESCE(NULLIF(TRIM(p_full_name), ''), full_name)"));
  });

  await t.test('10. Revokes anon execute permissions', () => {
    assert.ok(content.includes('REVOKE ALL ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, INT, INT, INT) FROM PUBLIC, anon;'));
  });

  await t.test('11. Grants authenticated execute permissions', () => {
    assert.ok(content.includes('GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, INT, INT, INT) TO authenticated;'));
  });

  await t.test('12. Includes PostgREST schema reload notification', () => {
    assert.ok(content.includes("NOTIFY pgrst, 'reload schema';"));
  });

  await t.test('13. Frontend caller in UserFormModal matches 6-arg signature exactly', () => {
    const frontendSrc = fs.readFileSync('src/components/dashboard/UserFormModal.jsx', 'utf8');
    assert.ok(frontendSrc.includes("supabase.rpc('admin_update_profile', {"));
    assert.ok(frontendSrc.includes('p_target_user_id: userToEdit.id,'));
    assert.ok(frontendSrc.includes('p_full_name: formData.fullName,'));
    assert.ok(frontendSrc.includes('p_role: formData.role,'));
    assert.ok(frontendSrc.includes('p_grade_level: parseInt(formData.gradeLevel),'));
    assert.ok(frontendSrc.includes('p_total_stars: parseInt(formData.totalStars),'));
    assert.ok(frontendSrc.includes('p_total_coins: parseInt(formData.totalCoins),'));
  });
});
