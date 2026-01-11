import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface LearningModeContextType {
  isEnabled: boolean;
  toggle: () => void;
  enable: () => void;
  disable: () => void;
}

const LearningModeContext = createContext<LearningModeContextType | undefined>(undefined);

const STORAGE_KEY = 'fantasy-hawk-learning-mode';

export function LearningModeProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage, default to true for new users
  const [isEnabled, setIsEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isEnabled));
  }, [isEnabled]);

  const toggle = () => setIsEnabled(prev => !prev);
  const enable = () => setIsEnabled(true);
  const disable = () => setIsEnabled(false);

  return (
    <LearningModeContext.Provider value={{ isEnabled, toggle, enable, disable }}>
      {children}
    </LearningModeContext.Provider>
  );
}

export function useLearningMode() {
  const context = useContext(LearningModeContext);
  if (context === undefined) {
    // Return default values if used outside provider
    return {
      isEnabled: false,
      toggle: () => {},
      enable: () => {},
      disable: () => {},
    };
  }
  return context;
}
