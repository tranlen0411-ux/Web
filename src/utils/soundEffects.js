// Web Audio API Sound FX Engine cho phản hồi âm thanh tương tác trẻ em

let audioCtx = null;

const getAudioContext = () => {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
};

export const playSound = (type = 'click', isSoundEnabled = true) => {
  if (!isSoundEnabled) return;
  
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    switch (type) {
      case 'click': {
        // Âm thanh click nhẹ nhàng vui tươi
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
        
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        
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
          
          gain.gain.setValueAtTime(0.25, startTime);
          gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.25);
          
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
        
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        
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
          
          gain.gain.setValueAtTime(0.3, startTime);
          gain.gain.exponentialRampToValueAtTime(0.01, startTime + note.d);
          
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
        
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.warn('Audio play warning:', err);
  }
};
