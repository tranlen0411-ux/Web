import { PGlite } from '@electric-sql/pglite';

async function runSmokeTest() {
  try {
    const db = new PGlite();
    const result = await db.query('SELECT 1 AS ok;');

    if (!result || !result.rows || result.rows.length === 0 || Number(result.rows[0].ok) !== 1) {
      throw new Error(`Kết quả không khớp mong đợi: ${JSON.stringify(result)}`);
    }

    await db.close();
    console.log('✅ PGLITE SMOKE TEST PASS');
    process.exit(0);
  } catch (err) {
    console.error('❌ PGLITE SMOKE TEST FAIL:', err);
    process.exit(1);
  }
}

runSmokeTest();
