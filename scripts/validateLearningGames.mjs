import { LEARNING_GAMES_DATA } from '../src/data/learningGamesData.js';

console.log('🔍 Bắt đầu kiểm tra dữ liệu 10 trò chơi học tập...\n');

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

// 1. Kiểm tra đủ 10 game
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
    // Check ID trùng
    if (idSet.has(q.id)) {
      console.error(`  ❌ LỖI ở câu #${idx + 1} (${gameKey}): Trùng ID = ${q.id}`);
      hasError = true;
    }
    idSet.add(q.id);

    // Check Prompt/Question trùng
    const textPrompt = q.prompt || q.question || (q.num1 !== undefined ? `${q.num1}_${q.num2}` : '');
    if (promptSet.has(textPrompt)) {
      console.error(`  ❌ LỖI ở câu #${idx + 1} (${gameKey}): Trùng câu hỏi "${textPrompt}"`);
      hasError = true;
    }
    promptSet.add(textPrompt);

    // Check game cụ thể
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
    } else if (gameKey === 'fish-compare') {
      if (q.num1 === undefined || q.num2 === undefined || !['>', '<', '='].includes(q.answer)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (fish-compare): num1/num2 hoặc answer không hợp lệ.`);
        hasError = true;
      }
    } else if (gameKey === 'sentence-factory') {
      if (!Array.isArray(q.words) || !Array.isArray(q.correct)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (sentence-factory): words/correct không phải mảng.`);
        hasError = true;
      }
      if (q.words.length !== q.correct.length) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (sentence-factory): số từ xáo trộn khác số từ trong câu chuẩn.`);
        hasError = true;
      }
    } else if (gameKey === 'smart-clock') {
      if (q.hour === undefined || q.minute === undefined || !Array.isArray(q.options) || !q.answer) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (smart-clock): hour/minute/options/answer không hợp lệ.`);
        hasError = true;
      }
      if (!q.options.includes(q.answer)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (smart-clock): answer "${q.answer}" không có trong options.`);
        hasError = true;
      }
    } else {
      if (!Array.isArray(q.options) || !q.answer) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (${gameKey}): Thiếu options hoặc answer.`);
        hasError = true;
      }
      if (q.options && !q.options.includes(q.answer)) {
        console.error(`  ❌ LỖI ở câu ID ${q.id} (${gameKey}): Đáp án "${q.answer}" không nằm trong options [${q.options.join(', ')}].`);
        hasError = true;
      }
      // Check trùng lặp option
      if (q.options) {
        const optionSet = new Set(q.options);
        if (optionSet.size !== q.options.length) {
          console.error(`  ❌ LỖI ở câu ID ${q.id} (${gameKey}): Trùng lặp lựa chọn [${q.options.join(', ')}].`);
          hasError = true;
        }
      }
    }

    // Check chuỗi sai chính tả đã phát hiện
    const strCheck = JSON.stringify(q);
    if (strCheck.includes('quả quả') || strCheck.includes('đâm chồi nổ lộc') || strCheck.includes('bút mầu') || strCheck.includes('meo') || strCheck.includes('Cà staple') || strCheck.includes('trên bơi')) {
      console.error(`  ❌ LỖI BÁO CHÍNH TẢ ở câu ID ${q.id} (${gameKey}): Chứa từ sai chính tả hoặc câu vô nghĩa.`);
      hasError = true;
    }
  });
});

console.log(`\n📊 Tổng số câu hỏi thực tế: ${totalQuestionsCount} câu.`);

if (totalQuestionsCount < 215) {
  console.error(`❌ LỖI: Tổng số câu hỏi phải đạt tối thiểu 215 câu (hiện tại: ${totalQuestionsCount}).`);
  hasError = true;
}

if (hasError) {
  console.error('\n❌ KIỂM TRA THẤT BẠI: Vui lòng sửa các lỗi dữ liệu được liệt kê ở trên.');
  process.exit(1);
} else {
  console.log('\n✅ KIỂM TRA THÀNH CÔNG: Dữ liệu 10 trò chơi đạt chuẩn sư phạm, chính tả và cấu trúc!');
  process.exit(0);
}
