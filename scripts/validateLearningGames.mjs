import fs from 'fs';
import path from 'path';
import { LEARNING_GAMES_DATA } from '../src/data/learningGamesData.js';

console.log('🔍 Bắt đầu kiểm tra toàn diện 10 trò chơi học tập và tài nguyên ảnh WebP...\n');

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
// 1. KIỂM TRA DỮ LIỆU CÂU HỎI TRONG LEARNINGGAMESDATA
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

    // 2. Check trùng câu hỏi cho từng loại game
    let uniqueKey = '';
    if (gameKey === 'smart-clock') {
      // Khóa độc nhất cho game Đồng Hồ dựa trên giờ:phút và đáp án
      uniqueKey = `${q.hour}:${q.minute}|${q.answer}`;
      if (q.hour < 1 || q.hour > 12 || ![0, 15, 30].includes(q.minute)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (smart-clock): Giờ (${q.hour}) hoặc phút (${q.minute}) không thuộc mốc hợp lệ.`);
        hasError = true;
      }
    } else if (gameKey === 'sentence-factory') {
      // Khóa độc nhất cho Nhà Máy Câu Văn dựa trên câu chuẩn
      uniqueKey = q.correct ? q.correct.join(' ') : '';
      if (!Array.isArray(q.words) || !Array.isArray(q.correct)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (sentence-factory): words hoặc correct không phải mảng.`);
        hasError = true;
      } else {
        if (q.words.length !== q.correct.length) {
          console.error(`  ❌ LỖI ở câu ID ${q.id} (sentence-factory): Số từ xáo trộn (${q.words.length}) != Số từ câu chuẩn (${q.correct.length}).`);
          hasError = true;
        }
        // Kiểm tra tập từ xáo trộn khớp tập từ trong câu chuẩn (kể cả từ xuất hiện nhiều lần)
        const countMap = (arr) => arr.reduce((acc, w) => { acc[w] = (acc[w] || 0) + 1; return acc; }, {});
        const wordsMap = countMap(q.words);
        const correctMap = countMap(q.correct);
        if (JSON.stringify(wordsMap) !== JSON.stringify(correctMap)) {
          console.error(`  ❌ LỖI ở câu ID ${q.id} (sentence-factory): Từ ngữ xáo trộn không khớp với câu chuẩn.`);
          hasError = true;
        }
      }
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

    // 3. Check đáp án và lựa chọn
    if (gameKey === 'train-numbers') {
      if (q.items === undefined || q.correctCount === undefined || !Array.isArray(q.options)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (train-numbers): Thiếu items/correctCount/options.`);
        hasError = true;
      }
      if (q.items.length !== q.correctCount) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (train-numbers): items.length (${q.items.length}) != correctCount (${q.correctCount}).`);
        hasError = true;
      }
      if (!q.options.includes(q.correctCount)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (train-numbers): correctCount (${q.correctCount}) không có trong options.`);
        hasError = true;
      }
    } else if (gameKey !== 'sentence-factory') {
      if (!Array.isArray(q.options) || !q.answer) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (${gameKey}): Thiếu options hoặc answer.`);
        hasError = true;
      }
      if (q.options && !q.options.includes(q.answer)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (${gameKey}): Đáp án "${q.answer}" không nằm trong options [${q.options.join(', ')}].`);
        hasError = true;
      }
      if (q.options) {
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
      console.error(`  ❌ LỖI BÁO CHÍNH TẢ ở câu ID ${q.id} (${gameKey}): Chứa từ sai chính tả hoặc cụm từ lỗi.`);
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
// 2. KIỂM TRA VẬT LÝ 10 FILE ĐỊNH DẠNG WEBP BINARY THẬT
// ============================================================================
console.log('\n🖼️  Kiểm tra 10 ảnh đại diện WebP binary thật trong public/images/games/...');

expectedGames.forEach((gameKey) => {
  const imgPath = path.join(process.cwd(), 'public', 'images', 'games', `${gameKey}.webp`);
  if (!fs.existsSync(imgPath)) {
    console.error(`❌ LỖI: Thiếu file ảnh WebP: public/images/games/${gameKey}.webp`);
    hasError = true;
    return;
  }

  const stat = fs.statSync(imgPath);
  if (stat.size < 500) {
    console.error(`❌ LỖI: File public/images/games/${gameKey}.webp quá nhỏ (${stat.size} bytes).`);
    hasError = true;
  }

  const buffer = fs.readFileSync(imgPath);
  const headAscii = buffer.toString('ascii', 0, 12);
  const headStr = buffer.toString('utf8', 0, Math.min(200, buffer.length));

  // Magic bytes check RIFF....WEBP
  if (!headAscii.startsWith('RIFF') || !headAscii.endsWith('WEBP')) {
    console.error(`❌ LỖI: File ${gameKey}.webp không phải WebP binary thật! Magic bytes header: "${headAscii}"`);
    hasError = true;
  }

  // Chống giả mạo SVG / XML đổi đuôi
  if (headStr.includes('<svg') || headStr.includes('<?xml') || headStr.includes('<SVG')) {
    console.error(`❌ LỖI: File ${gameKey}.webp là file SVG text bị đổi đuôi!`);
    hasError = true;
  }

  console.log(`  ✅ ${gameKey}.webp: ${stat.size} bytes | Header magic bytes: RIFF....WEBP [Đạt chuẩn Binary WebP]`);
});

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
  console.log('\n✅ KIỂM TRA THÀNH CÔNG RỰC RỠ: 10 game học tập và 10 ảnh WebP binary thật đạt chuẩn 100%!');
  process.exit(0);
}
