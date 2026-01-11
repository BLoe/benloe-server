import { GraduationCap } from 'lucide-react';
import { useLearningMode } from '../../contexts/LearningModeContext';

interface LearningModeToggleProps {
  compact?: boolean;
}

export function LearningModeToggle({ compact = false }: LearningModeToggleProps) {
  const { isEnabled, toggle } = useLearningMode();

  if (compact) {
    return (
      <button
        onClick={toggle}
        className={`p-2 rounded-lg transition-colors ${
          isEnabled
            ? 'bg-hawk-teal/20 text-hawk-teal hover:bg-hawk-teal/30'
            : 'bg-court-base text-gray-400 hover:text-gray-300'
        }`}
        title={isEnabled ? 'Disable Learning Mode' : 'Enable Learning Mode'}
        data-testid="learning-mode-toggle"
      >
        <GraduationCap className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between p-4 bg-court-base rounded-lg" data-testid="learning-mode-toggle">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isEnabled ? 'bg-hawk-teal/20' : 'bg-gray-700'}`}>
          <GraduationCap className={`w-5 h-5 ${isEnabled ? 'text-hawk-teal' : 'text-gray-400'}`} />
        </div>
        <div>
          <div className="font-medium text-gray-200">Learning Mode</div>
          <div className="text-sm text-gray-400">
            Show helpful tooltips explaining fantasy terms
          </div>
        </div>
      </div>

      <button
        onClick={toggle}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          isEnabled ? 'bg-hawk-teal' : 'bg-gray-600'
        }`}
        aria-checked={isEnabled}
        role="switch"
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            isEnabled ? 'translate-x-6' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
