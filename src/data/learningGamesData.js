// ============================================================================
// DỮ LIỆU CÂU HỎI NGUYÊN BẢN CHO 10 TRÒ CHƠI HỌC TẬP LỚP 1 VÀ LỚP 2
// Định hướng theo mạch kiến thức bộ sách Kết nối tri thức với cuộc sống
// Tự biên soạn 100%, không sao chép nguyên văn SGK, chuẩn chính tả Tiếng Việt
// ============================================================================

export const LEARNING_GAMES_DATA = {
  // --------------------------------------------------------------------------
  // 1. ĐOÀN TÀU SỐ HỌC (Lớp 1 - Toán: Số từ 0 đến 10)
  // --------------------------------------------------------------------------
  'train-numbers': {
    title: 'Đoàn Tàu Số Học',
    grade: 1,
    subject: 'Toán',
    instruction: 'Quan sát số lượng đồ vật/con vật và chọn toa tàu mang số đúng!',
    questions: [
      { id: 1, prompt: 'Có bao nhiêu quả táo chín đỏ trên cây?', items: ['🍎','🍎','🍎'], correctCount: 3, options: [2, 3, 4, 5] },
      { id: 2, prompt: 'Đếm số con thỏ trắng đang nhảy trên cỏ:', items: ['🐇','🐇','🐇','🐇','🐇'], correctCount: 5, options: [4, 5, 6, 7] },
      { id: 3, prompt: 'Đếm số ngôi sao vàng lấp lánh:', items: ['⭐️','⭐️','⭐️','⭐️','⭐️','⭐️','⭐️'], correctCount: 7, options: [6, 7, 8, 9] },
      { id: 4, prompt: 'Có bao nhiêu con cá vàng đang bơi?', items: ['🐟','🐟'], correctCount: 2, options: [1, 2, 3, 4] },
      { id: 5, prompt: 'Đếm số bông hoa cúc vàng rực rỡ:', items: ['🌻','🌻','🌻','🌻','🌻','🌻'], correctCount: 6, options: [5, 6, 7, 8] },
      { id: 6, prompt: 'Có bao nhiêu quả dâu tây ngọt ngào?', items: ['🍓','🍓','🍓','🍓'], correctCount: 4, options: [3, 4, 5, 6] },
      { id: 7, prompt: 'Đếm số con bướm rực rỡ sắc màu:', items: ['🦋','🦋','🦋','🦋','🦋','🦋','🦋','🦋'], correctCount: 8, options: [7, 8, 9, 10] },
      { id: 8, prompt: 'Có bao nhiêu chiếc xe ô tô?', items: ['🚗'], correctCount: 1, options: [0, 1, 2, 3] },
      { id: 9, prompt: 'Đếm số quả cam tròn xoe:', items: ['🍊','🍊','🍊','🍊','🍊','🍊','🍊','🍊','🍊'], correctCount: 9, options: [8, 9, 10, 7] },
      { id: 10, prompt: 'Có bao nhiêu chiếc bánh ngọt thơm ngon?', items: ['🍰','🍰','🍰','🍰','🍰','🍰','🍰','🍰','🍰','🍰'], correctCount: 10, options: [9, 10, 8, 7] },
      { id: 11, prompt: 'Trong giỏ không có quả bóng nào cả. Số thích hợp là:', items: [], correctCount: 0, options: [0, 1, 2, 3] },
      { id: 12, prompt: 'Đếm số con ong chăm chỉ đi hút mật:', items: ['🐝','🐝','🐝','🐝','🐝'], correctCount: 5, options: [3, 4, 5, 6] },
      { id: 13, prompt: 'Đếm số nấm nhỏ trong rừng xanh:', items: ['🍄','🍄','🍄','🍄','🍄','🍄','🍄'], correctCount: 7, options: [6, 7, 8, 9] },
      { id: 14, prompt: 'Có bao nhiêu chú gà con lông vàng?', items: ['🐥','🐥','🐥','🐥','🐥','🐥'], correctCount: 6, options: [5, 6, 7, 4] },
      { id: 15, prompt: 'Có bao nhiêu chiếc kẹo mút?', items: ['🍭','🍭','🍭'], correctCount: 3, options: [2, 3, 4, 5] },
      { id: 16, prompt: 'Đếm số chùm nho tím mọng nước:', items: ['🍇','🍇','🍇','🍇','🍇','🍇','🍇','🍇','🍇'], correctCount: 9, options: [8, 9, 10, 7] },
      { id: 17, prompt: 'Có bao nhiêu cái đĩa ăn cơm?', items: ['🍽️','🍽️'], correctCount: 2, options: [1, 2, 3, 4] },
      { id: 18, prompt: 'Đếm số chiếc ô che mưa:', items: ['☂️','☂️','☂️','☂️'], correctCount: 4, options: [3, 4, 5, 6] },
      { id: 19, prompt: 'Có bao nhiêu chiếc bút màu học tập?', items: ['✏️','✏️','✏️','✏️','✏️','✏️','✏️','✏️'], correctCount: 8, options: [7, 8, 9, 6] },
      { id: 20, prompt: 'Đếm số quả dưa hấu ngọt mát:', items: ['🍉','🍉','🍉','🍉','🍉','🍉','🍉','🍉','🍉','🍉'], correctCount: 10, options: [10, 9, 8, 7] }
    ]
  },

  // --------------------------------------------------------------------------
  // 2. ONG TÌM PHÉP TÍNH (Lớp 1 - Toán: Cộng trừ phạm vi 10)
  // --------------------------------------------------------------------------
  'bee-math': {
    title: 'Ong Tìm Phép Tính',
    grade: 1,
    subject: 'Toán',
    instruction: 'Chọn bông hoa có kết quả đúng để dẫn chú ong vàng hút mật!',
    questions: [
      { id: 1, question: 'Chú ong cần tìm bông hoa có kết quả: 3 + 4 = ?', options: ['5', '6', '7', '8'], answer: '7' },
      { id: 2, question: 'Kết quả của phép tính: 5 + 2 = ?', options: ['6', '7', '8', '9'], answer: '7' },
      { id: 3, question: 'Kết quả của phép tính: 9 - 4 = ?', options: ['4', '5', '6', '3'], answer: '5' },
      { id: 4, question: 'Kết quả của phép tính: 8 - 3 = ?', options: ['5', '6', '4', '7'], answer: '5' },
      { id: 5, question: 'Phép tính nào dưới đây có kết quả bằng 6?', options: ['4 + 2', '3 + 2', '5 + 2', '7 - 2'], answer: '4 + 2' },
      { id: 6, question: 'Kết quả của phép tính: 6 + 4 = ?', options: ['8', '9', '10', '7'], answer: '10' },
      { id: 7, question: 'Kết quả của phép tính: 10 - 6 = ?', options: ['3', '4', '5', '6'], answer: '4' },
      { id: 8, question: 'Phép tính: 2 + 6 = ?', options: ['7', '8', '9', '6'], answer: '8' },
      { id: 9, question: 'Phép tính: 7 - 5 = ?', options: ['1', '2', '3', '4'], answer: '2' },
      { id: 10, question: 'Kết quả của: 1 + 8 = ?', options: ['9', '8', '10', '7'], answer: '9' },
      { id: 11, question: 'Kết quả của: 9 - 7 = ?', options: ['1', '2', '3', '4'], answer: '2' },
      { id: 12, question: 'Phép tính: 4 + 4 = ?', options: ['6', '7', '8', '9'], answer: '8' },
      { id: 13, question: 'Kết quả của: 10 - 3 = ?', options: ['6', '7', '8', '5'], answer: '7' },
      { id: 14, question: 'Phép tính nào có kết quả bằng 9?', options: ['5 + 4', '4 + 4', '6 + 2', '10 - 2'], answer: '5 + 4' },
      { id: 15, question: 'Phép tính: 3 + 3 = ?', options: ['5', '6', '7', '4'], answer: '6' },
      { id: 16, question: 'Kết quả của: 8 - 8 = ?', options: ['0', '1', '2', '8'], answer: '0' },
      { id: 17, question: 'Phép tính: 5 + 5 = ?', options: ['9', '10', '8', '7'], answer: '10' },
      { id: 18, question: 'Kết quả của: 7 - 0 = ?', options: ['0', '7', '6', '1'], answer: '7' },
      { id: 19, question: 'Phép tính: 2 + 5 = ?', options: ['6', '7', '8', '9'], answer: '7' },
      { id: 20, question: 'Kết quả của: 10 - 8 = ?', options: ['1', '2', '3', '4'], answer: '2' },
      { id: 21, question: 'Phép tính: 6 - 3 = ?', options: ['2', '3', '4', '5'], answer: '3' },
      { id: 22, question: 'Kết quả của: 4 + 5 = ?', options: ['8', '9', '10', '7'], answer: '9' },
      { id: 23, question: 'Phép tính: 9 - 5 = ?', options: ['3', '4', '5', '6'], answer: '4' },
      { id: 24, question: 'Kết quả của: 1 + 6 = ?', options: ['6', '7', '8', '5'], answer: '7' },
      { id: 25, question: 'Phép tính: 8 - 4 = ?', options: ['3', '4', '5', '6'], answer: '4' }
    ]
  },

  // --------------------------------------------------------------------------
  // 3. CÁ CON SO SÁNH SỐ (Lớp 1 - Toán: So sánh số >, <, =)
  // --------------------------------------------------------------------------
  'fish-compare': {
    title: 'Cá Con So Sánh Số',
    grade: 1,
    subject: 'Toán',
    instruction: 'Giúp chú cá nhỏ chọn dấu đúng (>, < hoặc =) giữa hai số!',
    questions: [
      { id: 1, num1: 7, num2: 9, answer: '<' },
      { id: 2, num1: 15, num2: 12, answer: '>' },
      { id: 3, num1: 8, num2: 8, answer: '=' },
      { id: 4, num1: 10, num2: 14, answer: '<' },
      { id: 5, num1: 18, num2: 16, answer: '>' },
      { id: 6, num1: 20, num2: 20, answer: '=' },
      { id: 7, num1: 6, num2: 4, answer: '>' },
      { id: 8, num1: 11, num2: 13, answer: '<' },
      { id: 9, num1: 17, num2: 17, answer: '=' },
      { id: 10, num1: 19, num2: 14, answer: '>' },
      { id: 11, num1: 5, num2: 9, answer: '<' },
      { id: 12, num1: 13, num2: 10, answer: '>' },
      { id: 13, num1: 16, num2: 16, answer: '=' },
      { id: 14, num1: 12, num2: 15, answer: '<' },
      { id: 15, num1: 14, num2: 11, answer: '>' },
      { id: 16, num1: 9, num2: 9, answer: '=' },
      { id: 17, num1: 3, num2: 8, answer: '<' },
      { id: 18, num1: 18, num2: 19, answer: '<' },
      { id: 19, num1: 16, num2: 13, answer: '>' },
      { id: 20, num1: 10, num2: 10, answer: '=' }
    ]
  },

  // --------------------------------------------------------------------------
  // 4. KHU VƯỜN ÂM VẦN (Lớp 1 - Tiếng Việt: Ghép âm vần)
  // --------------------------------------------------------------------------
  'rhyme-garden': {
    title: 'Khu Vườn Âm Vần',
    grade: 1,
    subject: 'Tiếng Việt',
    instruction: 'Ghép âm đầu và vần phù hợp để tạo thành từ đúng chính tả!',
    questions: [
      { id: 1, prompt: 'Ghép âm "b" với vần "àn" ta được từ gì?', consonant: 'b', rhyme: 'àn', answer: 'bàn', options: ['bàn', 'bán', 'bạn', 'bà'] },
      { id: 2, prompt: 'Ghép âm "c" với vần "á" ta được từ gì?', consonant: 'c', rhyme: 'á', answer: 'cá', options: ['cá', 'cà', 'cả', 'cạ'] },
      { id: 3, prompt: 'Ghép âm "m" với vần "èo" ta được tiếng gì?', consonant: 'm', rhyme: 'èo', answer: 'mèo', options: ['mèo', 'méo', 'mẹo', 'meo'] },
      { id: 4, prompt: 'Ghép âm "th" với vần "ỏ" ta được tiếng gì?', consonant: 'th', rhyme: 'ỏ', answer: 'thỏ', options: ['thỏ', 'thọ', 'thó', 'thơ'] },
      { id: 5, prompt: 'Ghép âm "ch" với vần "im" ta được từ gì?', consonant: 'ch', rhyme: 'im', answer: 'chim', options: ['chim', 'chím', 'chìm', 'chỉm'] },
      { id: 6, prompt: 'Ghép âm "h" với vần "oa" ta được tiếng gì?', consonant: 'h', rhyme: 'oa', answer: 'hoa', options: ['hoa', 'hóa', 'họa', 'hòe'] },
      { id: 7, prompt: 'Ghép âm "g" với vần "à" ta được tiếng gì?', consonant: 'g', rhyme: 'à', answer: 'gà', options: ['gà', 'gá', 'gả', 'gạ'] },
      { id: 8, prompt: 'Ghép âm "n" với vần "ắng" ta được từ gì?', consonant: 'n', rhyme: 'ắng', answer: 'nắng', options: ['nắng', 'nặng', 'nẵng', 'năng'] },
      { id: 9, prompt: 'Ghép âm "m" với vần "ây" ta được từ gì?', consonant: 'm', rhyme: 'ây', answer: 'mây', options: ['mây', 'mấy', 'mầy', 'mẩy'] },
      { id: 10, prompt: 'Ghép âm "x" với vần "anh" ta được tiếng gì?', consonant: 'x', rhyme: 'anh', answer: 'xanh', options: ['xanh', 'sanh', 'xánh', 'xạnh'] },
      { id: 11, prompt: 'Ghép âm "đ" với vần "èn" ta được từ gì?', consonant: 'đ', rhyme: 'èn', answer: 'đèn', options: ['đèn', 'đén', 'đẻn', 'đẹn'] },
      { id: 12, prompt: 'Ghép âm "b" với vần "úp" ta được tiếng gì?', consonant: 'b', rhyme: 'úp', answer: 'búp', options: ['búp', 'búp bê', 'bụp', 'bùp'] },
      { id: 13, prompt: 'Ghép âm "c" với vần "ây" ta được từ gì?', consonant: 'c', rhyme: 'ây', answer: 'cây', options: ['cây', 'cấy', 'cầy', 'cẩy'] },
      { id: 14, prompt: 'Ghép âm "l" với vần "á" ta được tiếng gì?', consonant: 'l', rhyme: 'á', answer: 'lá', options: ['lá', 'là', 'lả', 'lạ'] },
      { id: 15, prompt: 'Ghép âm "nh" với vần "à" ta được tiếng gì?', consonant: 'nh', rhyme: 'à', answer: 'nhà', options: ['nhà', 'nhá', 'nhả', 'nhạ'] },
      { id: 16, prompt: 'Ghép âm "tr" với vần "ăng" ta được từ gì?', consonant: 'tr', rhyme: 'ăng', answer: 'trăng', options: ['trăng', 'chăng', 'trắng', 'trặng'] },
      { id: 17, prompt: 'Ghép âm "s" với vần "ao" ta được tiếng gì?', consonant: 's', rhyme: 'ao', answer: 'sao', options: ['sao', 'xao', 'sào', 'sáo'] },
      { id: 18, prompt: 'Ghép âm "v" với vần "oi" ta được từ gì?', consonant: 'v', rhyme: 'oi', answer: 'voi', options: ['voi', 'vói', 'vòi', 'vỏi'] },
      { id: 19, prompt: 'Ghép âm "t" với vần "áo" ta được tiếng gì?', consonant: 't', rhyme: 'áo', answer: 'táo', options: ['táo', 'tào', 'tảo', 'tạo'] },
      { id: 20, prompt: 'Ghép âm "ch" với vần "ó" ta được từ gì?', consonant: 'ch', rhyme: 'ó', answer: 'chó', options: ['chó', 'chò', 'chỏ', 'chọ'] }
    ]
  },

  // --------------------------------------------------------------------------
  // 5. SÓC CON ĐỌC HIỂU (Lớp 1 - Tiếng Việt: Đọc hiểu văn bản ngắn)
  // --------------------------------------------------------------------------
  'squirrel-reading': {
    title: 'Sóc Con Đọc Hiểu',
    grade: 1,
    subject: 'Tiếng Việt',
    instruction: 'Đọc kỹ đoạn văn ngắn và chọn đáp án trả lời câu hỏi chính xác nhé!',
    questions: [
      {
        id: 1,
        passage: 'Mèo con rất thích ăn cá tươi. Buổi sáng, mèo con ra sân nằm sưởi nắng.',
        question: 'Mèo con thích ăn món gì?',
        options: ['Cỏ tươi', 'Cá tươi', 'Bánh mì', 'Hạt ngô'],
        answer: 'Cá tươi'
      },
      {
        id: 2,
        passage: 'Bé Mai có một chiếc cặp sách màu xanh nõn chuối rất đẹp. Mẹ mua cho Mai nhân ngày khai trường.',
        question: 'Chiếc cặp sách của bé Mai có màu gì?',
        options: ['Màu đỏ', 'Màu xanh nõn chuối', 'Màu vàng', 'Màu hồng'],
        answer: 'Màu xanh nõn chuối'
      },
      {
        id: 3,
        passage: 'Chú thỏ trắng có đôi tai dài và đôi mắt hồng long lanh. Thỏ rất thích ăn củ cà rốt ngọt lịm.',
        question: 'Thỏ trắng rất thích ăn củ gì?',
        options: ['Củ khoai', 'Củ cà rốt', 'Củ cải', 'Củ hành'],
        answer: 'Củ cà rốt'
      },
      {
        id: 4,
        passage: 'Mùa xuân đến, cây cối đâm chồi nảy lộc. Những bông hoa cúc nở vàng rực cả góc vườn.',
        question: 'Mùa nào cây cối đâm chồi nảy lộc?',
        options: ['Mùa xuân', 'Mùa hạ', 'Mùa thu', 'Mùa đông'],
        answer: 'Mùa xuân'
      },
      {
        id: 5,
        passage: 'Gà trống cất tiếng gáy "Ó ó o" vào mỗi buổi sáng sớm để gọi mọi người thức dậy.',
        question: 'Gà trống gáy như thế nào?',
        options: ['Cục tác', 'Ó ó o', 'Chiếp chiếp', 'Gâu gâu'],
        answer: 'Ó ó o'
      },
      {
        id: 6,
        passage: 'Nam cùng bố trồng một cây bưởi nhỏ trước hiên nhà. Hằng ngày, Nam chăm chỉ tưới nước cho cây.',
        question: 'Nam làm gì hằng ngày cho cây bưởi?',
        options: ['Bẻ cành', 'Tưới nước', 'Hái lá', 'Nhổ cây'],
        answer: 'Tưới nước'
      },
      {
        id: 7,
        passage: 'Chim sẻ nhỏ chuyền cành hót véo von trong vòm lá xanh. Âm thanh nghe thật trong trẻo.',
        question: 'Con vật nào hót véo von trong vòm lá?',
        options: ['Chú mèo', 'Chim sẻ nhỏ', 'Chú chó', 'Con thỏ'],
        answer: 'Chim sẻ nhỏ'
      },
      {
        id: 8,
        passage: 'Hôm nay trời mưa to. Bé An đi học mang theo chiếc ô màu vàng ngộ nghĩnh.',
        question: 'Bé An mang theo vật gì khi đi học trời mưa?',
        options: ['Chiếc mũ', 'Chiếc ô màu vàng', 'Đôi dép', 'Chiếc áo khoác'],
        answer: 'Chiếc ô màu vàng'
      },
      {
        id: 9,
        passage: 'Đàn cá nhỏ bơi tung tăng dưới làn nước mát lành của mương nước đầu làng.',
        question: 'Đàn cá nhỏ bơi ở đâu?',
        options: ['Trên ngọn cây', 'Dưới làn nước mát lành', 'Trên bãi cỏ', 'Trong tổ'],
        answer: 'Dưới làn nước mát lành'
      },
      {
        id: 10,
        passage: 'Quả dưa hấu tròn xoe, vỏ màu xanh thẫm, ruột đỏ tươi và ăn rất ngọt mát.',
        question: 'Ruột quả dưa hấu có màu gì?',
        options: ['Màu vàng', 'Màu đỏ tươi', 'Màu xanh', 'Màu trắng'],
        answer: 'Màu đỏ tươi'
      },
      {
        id: 11,
        passage: 'Ông nội đang ngồi đọc báo ở bàn trà ngoài sân. Gió thu thổi nhẹ làm lá rơi xơ xác.',
        question: 'Ông nội đang làm gì ngoài sân?',
        options: ['Đọc báo', 'Tưới cây', 'Ngủ trưa', 'Uống nước'],
        answer: 'Đọc báo'
      },
      {
        id: 12,
        passage: 'Bé Lan gấp chiếc thuyền giấy màu đỏ rồi thả xuống chậu nước nhỏ.',
        question: 'Bé Lan gấp vật gì bằng giấy?',
        options: ['Máy bay', 'Chiếc thuyền', 'Ngôi sao', 'Bông hoa'],
        answer: 'Chiếc thuyền'
      },
      {
        id: 13,
        passage: 'Con cún con có bộ lông màu vàng óng. Mỗi khi thấy chủ về, cún lại vẫy đuôi mừng rỡ.',
        question: 'Cún con có bộ lông màu gì?',
        options: ['Màu đen', 'Màu vàng óng', 'Màu trắng', 'Màu xám'],
        answer: 'Màu vàng óng'
      },
      {
        id: 14,
        passage: 'Trên bầu trời đêm, mặt trăng tròn vạch sáng rực rỡ bên cạnh những ngôi sao nhỏ lấp lánh.',
        question: 'Vật nào sáng rực rỡ trên bầu trời đêm?',
        options: ['Mặt Trời', 'Mặt Trăng', 'Đèn đường', 'Cánh máy bay'],
        answer: 'Mặt Trăng'
      },
      {
        id: 15,
        passage: 'Bà ngoại đang đan cho bé chiếc áo len màu cam ấm áp để mặc vào mùa đông.',
        question: 'Bà ngoại đan cho bé vật gì?',
        options: ['Đôi tất', 'Chiếc áo len màu cam', 'Chiếc mũ vải', 'Chiếc khăn tay'],
        answer: 'Chiếc áo len màu cam'
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 6. ĐƯỜNG ĐUA TRONG PHẠM VI 100 (Lớp 2 - Toán: Cộng trừ phạm vi 100)
  // --------------------------------------------------------------------------
  'speed-racing-100': {
    title: 'Đường Đua Trong Phạm Vi 100',
    grade: 2,
    subject: 'Toán',
    instruction: 'Mỗi phép tính đúng giúp xe đua của bé tăng tốc tiến về đích!',
    questions: [
      { id: 1, question: '35 + 24 = ?', options: ['58', '59', '60', '69'], answer: '59' },
      { id: 2, question: '48 + 17 = ?', options: ['64', '65', '66', '55'], answer: '65' },
      { id: 3, question: '76 - 32 = ?', options: ['44', '42', '54', '34'], answer: '44' },
      { id: 4, question: '90 - 45 = ?', options: ['40', '45', '50', '55'], answer: '45' },
      { id: 5, question: '52 + 38 = ?', options: ['80', '88', '90', '92'], answer: '90' },
      { id: 6, question: '63 - 27 = ?', options: ['36', '35', '46', '37'], answer: '36' },
      { id: 7, question: '29 + 46 = ?', options: ['74', '75', '76', '65'], answer: '75' },
      { id: 8, question: '84 - 39 = ?', options: ['44', '45', '55', '46'], answer: '45' },
      { id: 9, question: '67 + 25 = ?', options: ['91', '92', '93', '82'], answer: '92' },
      { id: 10, question: '100 - 36 = ?', options: ['64', '63', '74', '54'], answer: '64' },
      { id: 11, question: '41 + 19 = ?', options: ['50', '59', '60', '61'], answer: '60' },
      { id: 12, question: '58 - 24 = ?', options: ['34', '33', '35', '44'], answer: '34' },
      { id: 13, question: '37 + 48 = ?', options: ['84', '85', '86', '75'], answer: '85' },
      { id: 14, question: '92 - 57 = ?', options: ['35', '36', '45', '25'], answer: '35' },
      { id: 15, question: '16 + 73 = ?', options: ['88', '89', '90', '79'], answer: '89' },
      { id: 16, question: '80 - 26 = ?', options: ['54', '53', '64', '44'], answer: '54' },
      { id: 17, question: '45 + 37 = ?', options: ['81', '82', '83', '72'], answer: '82' },
      { id: 18, question: '73 - 48 = ?', options: ['25', '24', '35', '26'], answer: '25' },
      { id: 19, question: '64 + 28 = ?', options: ['91', '92', '93', '82'], answer: '92' },
      { id: 20, question: '95 - 61 = ?', options: ['34', '33', '35', '44'], answer: '34' },
      { id: 21, question: '28 + 39 = ?', options: ['66', '67', '68', '57'], answer: '67' },
      { id: 22, question: '83 - 46 = ?', options: ['36', '37', '38', '47'], answer: '37' },
      { id: 23, question: '54 + 29 = ?', options: ['82', '83', '84', '73'], answer: '83' },
      { id: 24, question: '99 - 44 = ?', options: ['55', '54', '65', '45'], answer: '55' },
      { id: 25, question: '36 + 47 = ?', options: ['82', '83', '84', '73'], answer: '83' },
      { id: 26, question: '71 - 25 = ?', options: ['45', '46', '47', '36'], answer: '46' },
      { id: 27, question: '18 + 65 = ?', options: ['82', '83', '84', '73'], answer: '83' },
      { id: 28, question: '88 - 59 = ?', options: ['28', '29', '39', '30'], answer: '29' },
      { id: 29, question: '43 + 38 = ?', options: ['80', '81', '82', '71'], answer: '81' },
      { id: 30, question: '100 - 48 = ?', options: ['51', '52', '53', '62'], answer: '52' }
    ]
  },

  // --------------------------------------------------------------------------
  // 7. THÁM HIỂM BẢNG NHÂN (Lớp 2 - Toán: Bảng nhân 2 và 5)
  // --------------------------------------------------------------------------
  'multiplication-treasure': {
    title: 'Thám Hiểm Bảng Nhân',
    grade: 2,
    subject: 'Toán',
    instruction: 'Trả lời đúng các phép nhân 2 và 5 để mở rương kho báu vàng!',
    questions: [
      { id: 1, question: 'Phép tính: 2 x 6 = ?', options: ['10', '12', '14', '16'], answer: '12' },
      { id: 2, question: 'Phép tính: 5 x 4 = ?', options: ['15', '20', '25', '30'], answer: '20' },
      { id: 3, question: 'Phép tính: 2 x 9 = ?', options: ['16', '18', '20', '14'], answer: '18' },
      { id: 4, question: 'Phép tính: 5 x 7 = ?', options: ['30', '35', '40', '45'], answer: '35' },
      { id: 5, question: 'Phép tính: 2 x 4 = ?', options: ['6', '8', '10', '12'], answer: '8' },
      { id: 6, question: 'Phép tính: 5 x 9 = ?', options: ['40', '45', '50', '35'], answer: '45' },
      { id: 7, question: 'Tìm số còn thiếu: ? x 5 = 30', options: ['5', '6', '7', '8'], answer: '6' },
      { id: 8, question: 'Tìm số còn thiếu: 2 x ? = 14', options: ['6', '7', '8', '9'], answer: '7' },
      { id: 9, question: 'Phép tính: 5 x 5 = ?', options: ['20', '25', '30', '35'], answer: '25' },
      { id: 10, question: 'Phép tính: 2 x 8 = ?', options: ['14', '16', '18', '20'], answer: '16' },
      { id: 11, question: 'Phép tính: 5 x 3 = ?', options: ['10', '15', '20', '25'], answer: '15' },
      { id: 12, question: 'Phép tính: 2 x 5 = ?', options: ['8', '10', '12', '14'], answer: '10' },
      { id: 13, question: 'Tìm số còn thiếu: ? x 2 = 18', options: ['8', '9', '7', '10'], answer: '9' },
      { id: 14, question: 'Phép tính: 5 x 8 = ?', options: ['35', '40', '45', '50'], answer: '40' },
      { id: 15, question: 'Phép tính: 2 x 7 = ?', options: ['12', '14', '16', '18'], answer: '14' },
      { id: 16, question: 'Phép tính: 5 x 6 = ?', options: ['25', '30', '35', '40'], answer: '30' },
      { id: 17, question: 'Tìm số còn thiếu: 5 x ? = 45', options: ['7', '8', '9', '10'], answer: '9' },
      { id: 18, question: 'Phép tính: 2 x 3 = ?', options: ['4', '6', '8', '10'], answer: '6' },
      { id: 19, question: 'Phép tính: 5 x 2 = ?', options: ['8', '10', '12', '15'], answer: '10' },
      { id: 20, question: 'Phép tính: 2 x 10 = ?', options: ['18', '20', '22', '24'], answer: '20' },
      { id: 21, question: 'Phép tính: 5 x 10 = ?', options: ['45', '50', '55', '60'], answer: '50' },
      { id: 22, question: 'Tìm số còn thiếu: ? x 5 = 15', options: ['2', '3', '4', '5'], answer: '3' },
      { id: 23, question: 'Phép tính: 2 x 2 = ?', options: ['2', '4', '6', '8'], answer: '4' },
      { id: 24, question: 'Phép tính: 5 x 1 = ?', options: ['1', '5', '10', '0'], answer: '5' },
      { id: 25, question: 'Tìm số còn thiếu: 2 x ? = 10', options: ['4', '5', '6', '7'], answer: '5' }
    ]
  },

  // --------------------------------------------------------------------------
  // 8. ĐỒNG HỒ THÔNG MINH (Lớp 2 - Toán: Xem giờ đúng, 15 phút, 30 phút)
  // --------------------------------------------------------------------------
  'smart-clock': {
    title: 'Đồng Hồ Thông Minh',
    grade: 2,
    subject: 'Toán',
    instruction: 'Quan sát mặt đồng hồ kim và chọn đúng thời gian tương ứng!',
    questions: [
      { id: 1, hour: 7, minute: 0, options: ['7 giờ đúng', '8 giờ đúng', '7 giờ 30 phút', '6 giờ 30 phút'], answer: '7 giờ đúng' },
      { id: 2, hour: 8, minute: 30, options: ['8 giờ 15 phút', '8 giờ 30 phút', '9 giờ 30 phút', '8 giờ đúng'], answer: '8 giờ 30 phút' },
      { id: 3, hour: 9, minute: 15, options: ['9 giờ đúng', '9 giờ 15 phút', '9 giờ 30 phút', '10 giờ 15 phút'], answer: '9 giờ 15 phút' },
      { id: 4, hour: 10, minute: 0, options: ['10 giờ đúng', '9 giờ đúng', '10 giờ 30 phút', '11 giờ đúng'], answer: '10 giờ đúng' },
      { id: 5, hour: 2, minute: 30, options: ['2 giờ 15 phút', '2 giờ 30 phút', '3 giờ 30 phút', '2 giờ đúng'], answer: '2 giờ 30 phút' },
      { id: 6, hour: 4, minute: 15, options: ['4 giờ đúng', '4 giờ 15 phút', '4 giờ 30 phút', '5 giờ 15 phút'], answer: '4 giờ 15 phút' },
      { id: 7, hour: 6, minute: 0, options: ['6 giờ đúng', '5 giờ đúng', '6 giờ 30 phút', '7 giờ đúng'], answer: '6 giờ đúng' },
      { id: 8, hour: 1, minute: 30, options: ['1 giờ 15 phút', '1 giờ 30 phút', '2 giờ 30 phút', '12 giờ 30 phút'], answer: '1 giờ 30 phút' },
      { id: 9, hour: 3, minute: 15, options: ['3 giờ đúng', '3 giờ 15 phút', '3 giờ 30 phút', '4 giờ 15 phút'], answer: '3 giờ 15 phút' },
      { id: 10, hour: 11, minute: 0, options: ['11 giờ đúng', '10 giờ đúng', '11 giờ 30 phút', '12 giờ đúng'], answer: '11 giờ đúng' },
      { id: 11, hour: 5, minute: 30, options: ['5 giờ 15 phút', '5 giờ 30 phút', '6 giờ 30 phút', '5 giờ đúng'], answer: '5 giờ 30 phút' },
      { id: 12, hour: 12, minute: 15, options: ['12 giờ đúng', '12 giờ 15 phút', '12 giờ 30 phút', '1 giờ 15 phút'], answer: '12 giờ 15 phút' },
      { id: 13, hour: 8, minute: 0, options: ['8 giờ đúng', '7 giờ đúng', '8 giờ 30 phút', '9 giờ đúng'], answer: '8 giờ đúng' },
      { id: 14, hour: 10, minute: 30, options: ['10 giờ 15 phút', '10 giờ 30 phút', '11 giờ 30 phút', '10 giờ đúng'], answer: '10 giờ 30 phút' },
      { id: 15, hour: 1, minute: 15, options: ['1 giờ đúng', '1 giờ 15 phút', '1 giờ 30 phút', '2 giờ 15 phút'], answer: '1 giờ 15 phút' },
      { id: 16, hour: 9, minute: 0, options: ['9 giờ đúng', '8 giờ đúng', '9 giờ 30 phút', '10 giờ đúng'], answer: '9 giờ đúng' },
      { id: 17, hour: 3, minute: 30, options: ['3 giờ 15 phút', '3 giờ 30 phút', '4 giờ 30 phút', '3 giờ đúng'], answer: '3 giờ 30 phút' },
      { id: 18, hour: 6, minute: 15, options: ['6 giờ đúng', '6 giờ 15 phút', '6 giờ 30 phút', '7 giờ 15 phút'], answer: '6 giờ 15 phút' },
      { id: 19, hour: 2, minute: 0, options: ['2 giờ đúng', '1 giờ đúng', '2 giờ 30 phút', '3 giờ đúng'], answer: '2 giờ đúng' },
      { id: 20, hour: 7, minute: 30, options: ['7 giờ 15 phút', '7 giờ 30 phút', '8 giờ 30 phút', '7 giờ đúng'], answer: '7 giờ 30 phút' }
    ]
  },

  // --------------------------------------------------------------------------
  // 9. NHÀ MÁY CÂU VĂN (Lớp 2 - Tiếng Việt: Sắp xếp từ thành câu)
  // --------------------------------------------------------------------------
  'sentence-factory': {
    title: 'Nhà Máy Câu Văn',
    grade: 2,
    subject: 'Tiếng Việt',
    instruction: 'Bấm hoặc kéo các từ ngữ theo đúng thứ tự để tạo thành câu hoàn chỉnh!',
    questions: [
      { id: 1, words: ['Em', 'rất', 'yêu', 'mái', 'trường'], correct: ['Em', 'rất', 'yêu', 'mái', 'trường'] },
      { id: 2, words: ['Hoa', 'nở', 'rực', 'rỡ', 'trong', 'vườn'], correct: ['Hoa', 'nở', 'rực', 'rỡ', 'trong', 'vườn'] },
      { id: 3, words: ['Chú', 'chim', 'hót', 'líu', 'lo'], correct: ['Chú', 'chim', 'hót', 'líu', 'lo'] },
      { id: 4, words: ['Mặt', 'trời', 'mọc', 'ở', 'hướng', 'Đông'], correct: ['Mặt', 'trời', 'mọc', 'ở', 'hướng', 'Đông'] },
      { id: 5, words: ['Bé', 'chăm', 'chỉ', 'học', 'bài'], correct: ['Bé', 'chăm', 'chỉ', 'học', 'bài'] },
      { id: 6, words: ['Cây', 'cối', 'xanh', 'tươi', 'tốt'], correct: ['Cây', 'cối', 'xanh', 'tươi', 'tốt'] },
      { id: 7, words: ['Mẹ', 'đi', 'chợ', 'mua', 'cá'], correct: ['Mẹ', 'đi', 'chợ', 'mua', 'cá'] },
      { id: 8, words: ['Nắng', 'sớm', 'chiếu', 'qua', 'cửa', 'sổ'], correct: ['Nắng', 'sớm', 'chiếu', 'qua', 'cửa', 'sổ'] },
      { id: 9, words: ['Bầu', 'trời', 'mùa', 'thu', 'trong', 'xanh'], correct: ['Bầu', 'trời', 'mùa', 'thu', 'trong', 'xanh'] },
      { id: 10, words: ['Đàn', 'bướm', 'bay', 'dập', 'dờn'], correct: ['Đàn', 'bướm', 'bay', 'dập', 'dờn'] },
      { id: 11, words: ['Thầy', 'cô', 'dạy', 'dỗ', 'chúng', 'em'], correct: ['Thầy', 'cô', 'dạy', 'dỗ', 'chúng', 'em'] },
      { id: 12, words: ['Gió', 'thổi', 'mát', 'rượi', 'bên', 'sông'], correct: ['Gió', 'thổi', 'mát', 'rượi', 'bên', 'sông'] },
      { id: 13, words: ['Bé', 'giúp', 'bà', 'xâu', 'kim'], correct: ['Bé', 'giúp', 'bà', 'xâu', 'kim'] },
      { id: 14, words: ['Sách', 'vở', 'được', 'xếp', 'gọn', 'gàng'], correct: ['Sách', 'vở', 'được', 'xếp', 'gọn', 'gàng'] },
      { id: 15, words: ['Chú', 'mèo', 'nằm', 'sưởi', 'nắng'], correct: ['Chú', 'mèo', 'nằm', 'sưởi', 'nắng'] },
      { id: 16, words: ['Quả', 'cam', 'chín', 'vàng', 'mọng', 'nước'], correct: ['Quả', 'cam', 'chín', 'vàng', 'mọng', 'nước'] },
      { id: 17, words: ['Chúng', 'em', 'vui', 'chơi', 'ngoài', 'sân'], correct: ['Chúng', 'em', 'vui', 'chơi', 'ngoài', 'sân'] },
      { id: 18, words: ['Dòng', 'sông', 'chảy', 'hiền', 'hòa'], correct: ['Dòng', 'sông', 'chảy', 'hiền', 'hòa'] },
      { id: 19, words: ['Bạn', 'Nam', 'viết', 'chữ', 'rất', 'đẹp'], correct: ['Bạn', 'Nam', 'viết', 'chữ', 'rất', 'đẹp'] },
      { id: 20, words: ['Tổ', 'quốc', 'Việt', 'Nam', 'tươi', 'đẹp'], correct: ['Tổ', 'quốc', 'Việt', 'Nam', 'tươi', 'đẹp'] }
    ]
  },

  // --------------------------------------------------------------------------
  // 10. RỪNG XANH KỲ THÚ (Lớp 2 - Tự Nhiên & Xã Hội: Phân loại Động/Thực vật)
  // --------------------------------------------------------------------------
  'jungle-discovery': {
    title: 'Rừng Xanh Kỳ Thú',
    grade: 2,
    subject: 'Tự nhiên & Xã hội',
    instruction: 'Phân loại các loài động vật và thực vật vào đúng nhóm thích hợp!',
    questions: [
      { id: 1, item: 'Con chim sẻ', prompt: 'Con chim sẻ thuộc nhóm nào?', options: ['Loài chim (Bay trên trời)', 'Động vật sống dưới nước', 'Cây cho bóng mát'], answer: 'Loài chim (Bay trên trời)' },
      { id: 2, item: 'Cây bàng', prompt: 'Cây bàng thuộc nhóm thực vật nào?', options: ['Cây cho bóng mát', 'Rau ăn lá', 'Động vật sống dưới nước'], answer: 'Cây cho bóng mát' },
      { id: 3, item: 'Con cá chép', prompt: 'Con cá chép thuộc nhóm nào?', options: ['Động vật sống dưới nước', 'Loài chim (Bay trên trời)', 'Cây ăn quả'], answer: 'Động vật sống dưới nước' },
      { id: 4, item: 'Cây dưa hấu', prompt: 'Cây dưa hấu thuộc nhóm thực vật nào?', options: ['Cây ăn quả', 'Cây cho bóng mát', 'Côn trùng'], answer: 'Cây ăn quả' },
      { id: 5, item: 'Con hổ', prompt: 'Con hổ thuộc nhóm động vật nào?', options: ['Động vật sống trên cạn', 'Loài chim', 'Động vật sống dưới nước'], answer: 'Động vật sống trên cạn' },
      { id: 6, item: 'Hoa hồng', prompt: 'Hoa hồng thuộc nhóm nào?', options: ['Cây hoa trang trí', 'Động vật sống trên cạn', 'Côn trùng hút mật'], answer: 'Cây hoa trang trí' },
      { id: 7, item: 'Con ong', prompt: 'Con ong thuộc nhóm nào?', options: ['Côn trùng', 'Động vật sống dưới nước', 'Cây ăn quả'], answer: 'Côn trùng' },
      { id: 8, item: 'Cây lúa', prompt: 'Cây lúa cung cấp sản phẩm nào?', options: ['Hạt gạo', 'Củ cà rốt', 'Quả cam'], answer: 'Hạt gạo' },
      { id: 9, item: 'Con voi', prompt: 'Con voi thuộc nhóm động vật nào?', options: ['Động vật sống trên cạn', 'Loài chim', 'Động vật sống dưới nước'], answer: 'Động vật sống trên cạn' },
      { id: 10, item: 'Cây xoài', prompt: 'Cây xoài thuộc nhóm nào?', options: ['Cây ăn quả', 'Loài chim', 'Côn trùng'], answer: 'Cây ăn quả' },
      { id: 11, item: 'Con én', prompt: 'Con én thường xuất hiện báo hiệu mùa nào?', options: ['Mùa xuân', 'Mùa đông', 'Mùa thu'], answer: 'Mùa xuân' },
      { id: 12, item: 'Củ cà rốt', prompt: 'Củ cà rốt là bộ phận nào của cây?', options: ['Rễ củ', 'Lá cây', 'Bông hoa'], answer: 'Rễ củ' },
      { id: 13, item: 'Con thỏ', prompt: 'Con thỏ thuộc nhóm động vật nào?', options: ['Động vật sống trên cạn', 'Động vật sống dưới nước', 'Côn trùng'], answer: 'Động vật sống trên cạn' },
      { id: 14, item: 'Cây phượng', prompt: 'Cây phượng thường nở hoa đỏ rực vào mùa nào?', options: ['Mùa hạ', 'Mùa đông', 'Mùa xuân'], answer: 'Mùa hạ' },
      { id: 15, item: 'Con tôm', prompt: 'Con tôm thuộc nhóm động vật nào?', options: ['Động vật sống dưới nước', 'Loài chim (Bay trên trời)', 'Động vật sống trên cạn'], answer: 'Động vật sống dưới nước' },
      { id: 16, item: 'Cây thông', prompt: 'Cây thông thuộc nhóm thực vật nào?', options: ['Cây cho bóng mát', 'Cây ăn quả', 'Rau ăn lá'], answer: 'Cây cho bóng mát' },
      { id: 17, item: 'Con bướm', prompt: 'Con bướm thuộc nhóm nào?', options: ['Côn trùng', 'Động vật sống dưới nước', 'Động vật sống trên cạn'], answer: 'Côn trùng' },
      { id: 18, item: 'Rau muống', prompt: 'Rau muống thuộc nhóm thực vật nào?', options: ['Rau ăn lá', 'Cây cho bóng mát', 'Cây ăn quả'], answer: 'Rau ăn lá' },
      { id: 19, item: 'Con rùa', prompt: 'Con rùa thuộc nhóm động vật nào?', options: ['Bò sát (Động vật)', 'Loài chim', 'Côn trùng'], answer: 'Bò sát (Động vật)' },
      { id: 20, item: 'Cây chuối', prompt: 'Cây chuối cho chúng ta sản phẩm nào?', options: ['Quả chuối ngọt lịm', 'Củ cải', 'Hạt gạo'], answer: 'Quả chuối ngọt lịm' }
    ]
  }
};

// Hàm xáo trộn mảng ngẫu nhiên (Fisher-Yates Shuffle) - không làm biến đổi mảng gốc
export function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Lấy ngẫu nhiên N câu hỏi từ bộ dữ liệu game
export function getGameQuestions(gameKey, count = 12) {
  const gameData = LEARNING_GAMES_DATA[gameKey];
  if (!gameData || !gameData.questions) return [];
  
  const shuffled = shuffleArray(gameData.questions);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
