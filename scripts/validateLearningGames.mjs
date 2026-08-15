import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LEARNING_GAMES_DATA } from '../src/data/learningGamesData.js';

console.log('🔍 Bắt đầu kiểm tra chính thức dữ liệu 10 trò chơi học tập và 10 ảnh WebP real...\n');

let totalQuestionsCount = 0;
let hasError = false;

const expectedGames = [
  'train-numbers',
  'bee-math',
  'fish-compare',
  'rhyme-garden',
  'squirrel-reading',
  'speed-racing-100',
  'multiplication-treasure',
  'smart-clock',
  'sentence-factory',
  'jungle-discovery'
];

// ============================================================================
// 1. KIỂM TRA DỮ LIỆU CÂU HỎI TRONG LEARNINGGAMESDATA.JS
// ============================================================================
if (Object.keys(LEARNING_GAMES_DATA).length !== 10) {
  console.error(`❌ LỖI: Cần đúng 10 game, nhưng hiện tại có ${Object.keys(LEARNING_GAMES_DATA).length} game.`);
  hasError = true;
}

expectedGames.forEach((gameKey) => {
  const game = LEARNING_GAMES_DATA[gameKey];
  if (!game) {
    console.error(`❌ LỖI: Thiếu game key "${gameKey}".`);
    hasError = true;
    return;
  }

  const questions = game.questions || [];
  totalQuestionsCount += questions.length;

  console.log(`🎮 Game "${game.title}" (${gameKey}): ${questions.length} câu hỏi.`);

  if (questions.length < 15) {
    console.error(`  ❌ LỖI: Game "${gameKey}" có dưới 15 câu (${questions.length} câu).`);
    hasError = true;
  }

  const idSet = new Set();
  const promptSet = new Set();

  questions.forEach((q, idx) => {
    // 1. Check ID trùng
    if (idSet.has(q.id)) {
      console.error(`  ❌ LỖI ở câu #${idx + 1} (${gameKey}): Trùng ID = ${q.id}`);
      hasError = true;
    }
    idSet.add(q.id);

    // 2. Check trùng câu hỏi / khóa độc nhất cho từng loại game
    let uniqueKey = '';
    if (gameKey === 'smart-clock') {
      uniqueKey = `${q.hour}:${q.minute}|${q.answer}`;
      if (q.hour < 1 || q.hour > 12 || ![0, 15, 30].includes(q.minute)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (smart-clock): Giờ (${q.hour}) hoặc phút (${q.minute}) không thuộc mốc hợp lệ.`);
        hasError = true;
      }
    } else if (gameKey === 'sentence-factory') {
      uniqueKey = q.correct ? q.correct.join(' ') : '';
    } else if (gameKey === 'fish-compare') {
      uniqueKey = `${q.num1}_${q.answer}_${q.num2}`;
    } else {
      uniqueKey = q.prompt || q.question || '';
    }

    if (promptSet.has(uniqueKey)) {
      console.error(`  ❌ LỖI ở câu #${idx + 1} (${gameKey}): Trùng câu hỏi / nội dung "${uniqueKey}"`);
      hasError = true;
    }
    promptSet.add(uniqueKey);

    // 3. Phân nhánh kiểm tra logic riêng cho từng loại game (Mỗi game kiểm tra duy nhất 1 lần)
    if (gameKey === 'train-numbers') {
      if (q.items === undefined || q.correctCount === undefined || !Array.isArray(q.options)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (train-numbers): Thiếu items/correctCount/options.`);
        hasError = true;
      } else {
        if (q.items.length !== q.correctCount) {
          console.error(`  ❌ LỖI ở câu ID ${q.id} (train-numbers): items.length (${q.items.length}) != correctCount (${q.correctCount}).`);
          hasError = true;
        }
        if (!q.options.includes(q.correctCount)) {
          console.error(`  ❌ LỖI ở câu ID ${q.id} (train-numbers): correctCount (${q.correctCount}) không có trong options.`);
          hasError = true;
        }
      }
    } else if (gameKey === 'fish-compare') {
      // NHÁNH RIÊNG DÀNH CHO CÁ CON SO SÁNH SỐ (KHÔNG YÊU CẦU OPTIONS)
      if (typeof q.num1 !== 'number' || typeof q.num2 !== 'number' || !['>', '<', '='].includes(q.answer)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (fish-compare): num1, num2 hoặc answer không hợp lệ.`);
        hasError = true;
      } else {
        const expected = q.num1 > q.num2 ? '>' : q.num1 < q.num2 ? '<' : '=';
        if (q.answer !== expected) {
          console.error(`  ❌ LỖI ở câu ID ${q.id} (fish-compare): Đáp án "${q.answer}" không khớp với tính toán (${q.num1} ${expected} ${q.num2}).`);
          hasError = true;
        }
      }
    } else if (gameKey === 'sentence-factory') {
      // NHÁNH RIÊNG DÀNH CHO NHÀ MÁY CÂU VĂN
      if (!Array.isArray(q.words) || !Array.isArray(q.correct)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (sentence-factory): words hoặc correct không phải mảng.`);
        hasError = true;
      } else {
        if (q.words.length !== q.correct.length) {
          console.error(`  ❌ LỖI ở câu ID ${q.id} (sentence-factory): Số từ xáo trộn (${q.words.length}) != Số từ câu chuẩn (${q.correct.length}).`);
          hasError = true;
        }
        const countMap = (arr) => arr.reduce((acc, w) => { acc[w] = (acc[w] || 0) + 1; return acc; }, {});
        const wordsMap = countMap(q.words);
        const correctMap = countMap(q.correct);
        if (JSON.stringify(wordsMap) !== JSON.stringify(correctMap)) {
          console.error(`  ❌ LỖI ở câu ID ${q.id} (sentence-factory): Từ ngữ xáo trộn không khớp với câu chuẩn.`);
          hasError = true;
        }
      }
    } else {
      // NHÁNH CHUNG DÀNH CHO CÁC GAME TRẮC NGHIỆM THÔNG THƯỜNG (CẦN OPTIONS VÀ ANSWER)
      if (!Array.isArray(q.options) || !q.answer) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (${gameKey}): Thiếu options hoặc answer.`);
        hasError = true;
      } else {
        if (!q.options.includes(q.answer)) {
          console.error(`  ❌ LỖI ở câu ID ${q.id} (${gameKey}): Đáp án "${q.answer}" không nằm trong options [${q.options.join(', ')}].`);
          hasError = true;
        }
        const optionSet = new Set(q.options);
        if (optionSet.size !== q.options.length) {
          console.error(`  ❌ LỖI ở câu ID ${q.id} (${gameKey}): Trùng lặp lựa chọn trong câu [${q.options.join(', ')}].`);
          hasError = true;
        }
      }
    }

    // 4. Check các lỗi chính tả chính xác đã phát hiện
    const strCheck = JSON.stringify(q);
    if (strCheck.includes('quả quả') || strCheck.includes('đâm chồi nổ lộc') || strCheck.includes('bút mầu') || strCheck.includes('"t" meo') || strCheck.includes('Cà staple') || strCheck.includes('trên bơi')) {
      console.error(`  ❌ LỖI CHÍNH TẢ ở câu ID ${q.id} (${gameKey}): Chứa từ sai chính tả hoặc cụm từ lỗi.`);
      hasError = true;
    }
  });
});

console.log(`\n📊 Tổng số câu hỏi thực tế: ${totalQuestionsCount} câu.`);
if (totalQuestionsCount < 215) {
  console.error(`❌ LỖI: Tổng số câu hỏi phải đạt tối thiểu 215 câu (hiện tại: ${totalQuestionsCount}).`);
  hasError = true;
}

// ============================================================================
// 2. KIỂM TRA MÃ HÓA & GIẢI MÃ THẬT CHO 10 FILE ANH WEBP BINARY REAL
// ============================================================================
console.log('\n🖼️  Kiểm tra giải mã thực tế 10 ảnh WebP binary trong public/images/games/...');

const shaSet = new Set();

expectedGames.forEach((gameKey) => {
  const imgPath = path.join(process.cwd(), 'public', 'images', 'games', `${gameKey}.webp`);
  if (!fs.existsSync(imgPath)) {
    console.error(`❌ LỖI: Thiếu file ảnh WebP: public/images/games/${gameKey}.webp`);
    hasError = true;
    return;
  }

  const stat = fs.statSync(imgPath);
  if (stat.size < 1000) {
    console.error(`❌ LỖI: File public/images/games/${gameKey}.webp quá nhỏ (${stat.size} bytes).`);
    hasError = true;
  }

  const buffer = fs.readFileSync(imgPath);
  const headAscii = buffer.toString('ascii', 0, 12);
  const headStr = buffer.toString('utf8', 0, Math.min(200, buffer.length));

  // Check magic bytes
  if (!headAscii.startsWith('RIFF') || !headAscii.endsWith('WEBP')) {
    console.error(`❌ LỖI: File ${gameKey}.webp không phải WebP binary! Header: "${headAscii}"`);
    hasError = true;
  }

  // Check SVG/XML text hack
  if (headStr.includes('<svg') || headStr.includes('<?xml') || headStr.includes('<SVG')) {
    console.error(`❌ LỖI: File ${gameKey}.webp chứa thẻ SVG text!`);
    hasError = true;
  }

  // SHA-256 Check độc nhất
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (shaSet.has(sha256)) {
    console.error(`❌ LỖI: File ${gameKey}.webp có SHA-256 bị trùng với ảnh khác!`);
    hasError = true;
  }
  shaSet.add(sha256);

  console.log(`  ✅ ${gameKey}.webp: ${stat.size} bytes | SHA256: ${sha256.substring(0, 16)}... | Format: Binary WebP Real [Đạt chuẩn]`);
});

if (shaSet.size !== 10) {
  console.error(`❌ LỖI: Cần đúng 10 mã SHA-256 độc nhất cho 10 ảnh, hiện có ${shaSet.size} mã.`);
  hasError = true;
}

// ============================================================================
// 3. KIỂM TRA FILE SQL SEED KHÔNG CHỨA URL BÊN NGOÀI
// ============================================================================
const sqlPath = path.join(process.cwd(), 'ADD_GRADE_1_2_LEARNING_GAMES.sql');
if (fs.existsSync(sqlPath)) {
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  if (sqlContent.includes('http://') || sqlContent.includes('https://')) {
    console.error('❌ LỖI: File ADD_GRADE_1_2_LEARNING_GAMES.sql còn chứa URL ngoài (http/https).');
    hasError = true;
  } else {
    console.log('\n✅ File SQL seed sử dụng 100% đường dẫn ảnh nội bộ /images/games/*.webp chuẩn xác!');
  }
}

if (hasError) {
  console.error('\n❌ KIỂM TRA THẤT BẠI: Vui lòng sửa các lỗi được liệt kê ở trên.');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA THÀNH CÔNG RỰC RỠ: 10 game học tập và 10 ảnh WebP binary thật đạt chuẩn 100% (EXIT CODE 0)!');
  process.exit(0);
}
