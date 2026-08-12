import React, { createContext, useContext, useState, useEffect } from 'react';
import { playSound } from '../utils/soundEffects';

const SoundContext = createContext({
  isSoundEnabled: true,
  toggleSound: () => {},
  triggerSound: (type) => {}
});

export const SoundProvider = ({ children }) => {
  const [isSoundEnabled, setIsSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('sound_enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });

  useEffect(() => {
    localStorage.setItem('sound_enabled', JSON.stringify(isSoundEnabled));
  }, [isSoundEnabled]);

  const toggleSound = () => {
    setIsSoundEnabled(prev => !prev);
  };

  const triggerSound = (type = 'click') => {
    playSound(type, isSoundEnabled);
  };

  return (
    <SoundContext.Provider value={{ isSoundEnabled, toggleSound, triggerSound }}>
      {children}
    </SoundContext.Provider>
  );
};

export const useSound = () => useContext(SoundContext);
