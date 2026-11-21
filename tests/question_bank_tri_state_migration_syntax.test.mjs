// tests/question_bank_tri_state_migration_syntax.test.mjs
// Automated verification of 20261109140000_question_bank_list_questions_persistent_tri_state_origin.sql

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.resolve('D:/Cacduanweb/Web-qb-clone-preview-isolated/supabase/migrations/20261109140000_question_bank_list_questions_persistent_tri_state_origin.sql');

test('R2-B6G-5P34: Tri-State Migration SQL Syntax & Structure Verification', async (t) => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');

  await t.test('1. Dollar Quote Delimiters Match Exactly', () => {
    const dollarMatches = sql.match(/\$[a-zA-Z0-9_]*\$/g) || [];
    assert.equal(dollarMatches.length, 2, 'Must have exactly 2 dollar quote delimiters (opening and closing)');
    assert.equal(dollarMatches[0], '$function$', 'Opening delimiter must be $function$');
    assert.equal(dollarMatches[1], '$function$', 'Closing delimiter must be $function$');
    assert.equal(dollarMatches[0], dollarMatches[1], 'Opening and closing delimiter must match character-for-character');
  });

  await t.test('2. Parentheses, Brackets, and Braces are Balanced Across Entire File', () => {
    let parens = 0, brackets = 0, braces = 0;
    let inString = false;
    let inDollar = false;
    const dollarTag = '$function$';

    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      if (!inString && !inDollar) {
        if (ch === "'") inString = true;
        else if (sql.substring(i).startsWith(dollarTag)) {
          inDollar = true;
          i += dollarTag.length - 1;
        } else if (ch === '(') parens++;
        else if (ch === ')') parens--;
        else if (ch === '[') brackets++;
        else if (ch === ']') brackets--;
        else if (ch === '{') braces++;
        else if (ch === '}') braces--;
      } else if (inString) {
        if (ch === "'") {
          if (sql[i + 1] === "'") i++; // escaped
          else inString = false;
        }
      } else if (inDollar) {
        if (sql.substring(i).startsWith(dollarTag)) {
          inDollar = false;
          i += dollarTag.length - 1;
        }
      }
    }

    assert.equal(parens, 0, 'Outer parentheses must be balanced');
    assert.equal(brackets, 0, 'Outer brackets must be balanced');
    assert.equal(braces, 0, 'Outer braces must be balanced');
    assert.equal(inString, false, 'Must not be inside string at EOF');
    assert.equal(inDollar, false, 'Must not be inside dollar quote at EOF');
  });

  await t.test('3. Function Body Syntax, Blocks, and Balance', () => {
    const match = sql.match(/AS \$function\$([\s\S]+?)\$function\$/);
    assert.ok(match, 'Function body must exist between $function$ delimiters');
    const body = match[1];

    let parens = 0, brackets = 0, braces = 0;
    let inString = false;
    let inComment = false;

    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (inComment) {
        if (ch === '\n') inComment = false;
        continue;
      }
      if (!inString) {
        if (ch === '-' && body[i + 1] === '-') {
          inComment = true;
          i++;
          continue;
        }
        if (ch === "'") inString = true;
        else if (ch === '(') parens++;
        else if (ch === ')') parens--;
        else if (ch === '[') brackets++;
        else if (ch === ']') brackets--;
        else if (ch === '{') braces++;
        else if (ch === '}') braces--;
      } else {
        if (ch === "'") {
          if (body[i + 1] === "'") i++; // escaped ''
          else inString = false;
        }
      }
    }

    assert.equal(parens, 0, 'Function body parentheses must be balanced');
    assert.equal(brackets, 0, 'Function body brackets must be balanced');
    assert.equal(braces, 0, 'Function body braces must be balanced');
    assert.equal(inString, false, 'Function body single quotes must be balanced');
  });

  await t.test('4. Security & Safety Header Attributes', () => {
    assert.match(sql, /SECURITY\s+DEFINER/, 'Must be SECURITY DEFINER');
    assert.match(sql, /SET\s+search_path\s+TO\s+'pg_catalog',\s*'public',\s*'pg_temp'/, 'Must use strict search_path');
    assert.match(sql, /RETURNS\s+jsonb/, 'Return type must be jsonb');
    assert.match(sql, /LANGUAGE\s+plpgsql/, 'Language must be plpgsql');
  });

  await t.test('5. Owner and Explicit ACL Hardening Statements', () => {
    assert.match(sql, /ALTER\s+FUNCTION\s+public\.rpc_qb_list_questions\(uuid,\s*text,\s*jsonb\)\s+OWNER\s+TO\s+postgres;/, 'Owner must be postgres');
    assert.match(sql, /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rpc_qb_list_questions\(uuid,\s*text,\s*jsonb\)\s+FROM\s+PUBLIC;/, 'Must revoke from PUBLIC');
    assert.match(sql, /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rpc_qb_list_questions\(uuid,\s*text,\s*jsonb\)\s+FROM\s+anon;/, 'Must revoke from anon');
    assert.match(sql, /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rpc_qb_list_questions\(uuid,\s*text,\s*jsonb\)\s+FROM\s+authenticated;/, 'Must revoke from authenticated');
    assert.match(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rpc_qb_list_questions\(uuid,\s*text,\s*jsonb\)\s+TO\s+service_role;/, 'Must grant execute to service_role');
  });

  await t.test('6. Tri-State and Genesis Version 1 Integration', () => {
    assert.match(sql, /'origin_status',\s*i\.origin_status/, 'Must include origin_status in jsonb_build_object');
    assert.match(sql, /'forked_from_version_id',\s*i\.forked_from_version_id/, 'Must include forked_from_version_id in jsonb_build_object');
    assert.match(sql, /LEFT\s+JOIN\s+public\.question_bank_versions\s+v1\s+ON\s+\(i\.id\s*=\s*v1\.question_bank_item_id\s+AND\s+v1\.version_number\s*=\s*1\)/, 'Must join genesis version 1');
  });

  await t.test('7. UUID Cast Safety Nested Protection', () => {
    assert.match(sql, /jsonb_typeof\(i\.metadata->'forked_from_version_id'\)\s*=\s*'string'/, 'Must protect with jsonb_typeof check');
    assert.match(sql, /~[*]\s*'\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$'/, 'Must use strict 36-char UUID regex');
  });

  await t.test('8. Strict SQL Escape Guard: Block Literal Backslash Sequences', () => {
    // Blocks literal '\n', '\r', '\t' that cause Postgres 42601 syntax errors
    assert.doesNotMatch(sql, /\\n/, 'Must NOT contain literal \\n escape sequences');
    assert.doesNotMatch(sql, /\\r/, 'Must NOT contain literal \\r escape sequences');
    assert.doesNotMatch(sql, /\\t/, 'Must NOT contain literal \\t escape sequences');
    assert.equal(sql.includes('\\'), false, 'Must NOT contain any unexpected backslashes');
  });
});
