// Web Audio API Sound FX Engine cho phản hồi âm thanh tương tác trẻ em và Đấu trường V1

let audioCtx = null;

export const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

export const playSound = (type = 'click', isSoundEnabled = true, volume = 1.0) => {
  if (!isSoundEnabled) return;
  
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const vol = Math.max(0, Math.min(1, typeof volume === 'number' ? volume : 1.0));

    switch (type) {
      case 'click': {
        // Âm thanh click nhẹ nhàng vui tươi
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
        
        gain.gain.setValueAtTime(0.2 * vol, now);
        gain.gain.exponentialRampToValueAtTime(0.01 * vol, now + 0.08);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
        break;
      }

      case 'correct': {
        // Âm thanh trả lời đúng dạng hợp âm ngân vang (C5 - E5 - G5)
        const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const startTime = now + idx * 0.08;
          
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, startTime);
          
          gain.gain.setValueAtTime(0.25 * vol, startTime);
          gain.gain.exponentialRampToValueAtTime(0.01 * vol, startTime + 0.25);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.25);
        });
        break;
      }

      case 'wrong': {
        // Âm thanh báo sai trầm nhẹ (không gây ức chế tâm lý cho trẻ)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now); // A3
        osc.frequency.linearRampToValueAtTime(150, now + 0.2);
        
        gain.gain.setValueAtTime(0.15 * vol, now);
        gain.gain.exponentialRampToValueAtTime(0.01 * vol, now + 0.2);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }

      case 'victory': {
        // Âm thanh hoàn thành xuất sắc bài học / chiến thắng
        const fanfare = [
          { f: 523.25, d: 0.12 }, // C5
          { f: 659.25, d: 0.12 }, // E5
          { f: 783.99, d: 0.12 }, // G5
          { f: 1046.50, d: 0.4 }  // C6
        ];
        let offset = 0;
        fanfare.forEach((note) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const startTime = now + offset;
          
          osc.type = 'sine';
          osc.frequency.setValueAtTime(note.f, startTime);
          
          gain.gain.setValueAtTime(0.3 * vol, startTime);
          gain.gain.exponentialRampToValueAtTime(0.01 * vol, startTime + note.d);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + note.d);
          
          offset += note.d * 0.8;
        });
        break;
      }

      case 'flip': {
        // Âm thanh lật thẻ bài
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(250, now + 0.05);
        
        gain.gain.setValueAtTime(0.15 * vol, now);
        gain.gain.exponentialRampToValueAtTime(0.01 * vol, now + 0.05);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
        break;
      }

      // =====================================================================
      // COMPETITION V1 SYNTHESIZED SOUND EFFECTS
      // =====================================================================

      case 'competition_question_open':
      case 'question_open': {
        // Hợp âm mở câu hỏi tươi mới, sinh động (D5 -> F#5 -> A5)
        const notes = [587.33, 739.99, 880.00];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const startTime = now + idx * 0.06;
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, startTime);

          gain.gain.setValueAtTime(0.25 * vol, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001 * vol, startTime + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.35);
        });
        break;
      }

      case 'competition_countdown_tick':
      case 'countdown_tick': {
        // Tiếng tích tắc đếm ngược ngắn gọn, dứt khoát (880Hz -> 660Hz)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.05);

        gain.gain.setValueAtTime(0.3 * vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001 * vol, now + 0.05);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
        break;
      }

      case 'competition_countdown_final':
      case 'countdown_final': {
        // Tiếng báo giây cuối cùng (1320Hz cao độ báo động khẩn cấp)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1320, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

        gain.gain.setValueAtTime(0.35 * vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001 * vol, now + 0.12);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
        break;
      }

      case 'competition_time_up':
      case 'time_up': {
        // Âm thanh hết giờ làm bài trầm ấm, dứt khoát (440Hz -> 220Hz)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.linearRampToValueAtTime(220, now + 0.3);

        gain.gain.setValueAtTime(0.2 * vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001 * vol, now + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      }

      case 'competition_results_reveal':
      case 'results_reveal': {
        // Âm thanh mở kết quả câu hỏi dạng arpeggio lấp lánh (C5 -> E5 -> G5 -> C6)
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const startTime = now + idx * 0.07;
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, startTime);

          gain.gain.setValueAtTime(0.22 * vol, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001 * vol, startTime + 0.45);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.45);
        });
        break;
      }

      case 'competition_leaderboard':
      case 'leaderboard': {
        // Âm thanh vút bay mở bảng xếp hạng (E5 -> G#5 -> B5 -> E6)
        const notes = [659.25, 830.61, 987.77, 1318.51];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const startTime = now + idx * 0.05;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, startTime);

          gain.gain.setValueAtTime(0.25 * vol, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001 * vol, startTime + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.35);
        });
        break;
      }

      case 'competition_podium':
      case 'podium': {
        // Khúc ca khải hoàn vinh danh bục nhận giải (fanfare rực rỡ C5, E5, G5, C6)
        const fanfare = [
          { f: 523.25, d: 0.15 }, // C5
          { f: 523.25, d: 0.15 }, // C5
          { f: 659.25, d: 0.15 }, // E5
          { f: 783.99, d: 0.25 }, // G5
          { f: 659.25, d: 0.15 }, // E5
          { f: 1046.50, d: 0.6 }  // C6
        ];
        let offset = 0;
        fanfare.forEach((note) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const startTime = now + offset;

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(note.f, startTime);

          gain.gain.setValueAtTime(0.3 * vol, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001 * vol, startTime + note.d);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + note.d);

          offset += note.d * 0.75;
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.warn('Audio play warning:', err);
  }
};

