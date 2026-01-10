import { useState, useEffect } from 'react';
import { LoadingSpinner } from './LoadingSpinner';
import { ChatPanel } from './chat/ChatPanel';
import { MessageSquare, Settings } from 'lucide-react';

interface AIChatProps {
  selectedLeague: string | null;
}

interface ClaudeStatus {
  hasKey: boolean;
  provider?: string;
}

const AUTH_URL = 'https://auth.benloe.com';

export function AIChat({ selectedLeague }: AIChatProps) {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkClaudeStatus();
  }, []);

  async function checkClaudeStatus() {
    try {
      setLoading(true);
      const response = await fetch(`${AUTH_URL}/api/claude/status`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setClaudeStatus(data);
      } else {
        setClaudeStatus({ hasKey: false });
      }
    } catch (err) {
      console.error('Failed to check Claude status:', err);
      setClaudeStatus({ hasKey: false });
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <LoadingSpinner message="Checking AI configuration..." />;
  }

  if (!selectedLeague) {
    return (
      <div className="card text-center py-12" data-testid="chat-no-league">
        <MessageSquare className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">Select a league to start chatting</p>
      </div>
    );
  }

  if (!claudeStatus?.hasKey) {
    return (
      <div className="card text-center py-12" data-testid="chat-no-key">
        <div className="w-16 h-16 mx-auto mb-6 rounded-xl bg-hawk-indigo/20 flex items-center justify-center">
          <MessageSquare className="w-8 h-8 text-hawk-indigo" />
        </div>
        <h3 className="font-display text-xl font-semibold text-gray-100 mb-2">
          AI Chat Not Configured
        </h3>
        <p className="text-gray-400 mb-6 max-w-md mx-auto">
          Get personalized fantasy basketball advice powered by Claude AI.
          Add your Anthropic API key to enable this feature.
        </p>
        <a
          href={`${AUTH_URL}/dashboard`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary inline-flex items-center gap-2"
        >
          <Settings className="w-5 h-5" />
          Set Up API Key
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="chat-page">
      {/* Page Header */}
      <div>
        <h2 className="font-display text-2xl text-gray-100 flex items-center gap-3">
          <MessageSquare className="w-7 h-7 text-hawk-orange" />
          AI Strategy Chat
        </h2>
        <p className="text-gray-400 mt-1">
          Ask questions about your fantasy team and get AI-powered advice
        </p>
      </div>

      {/* Chat Panel */}
      <div className="card">
        <ChatPanel leagueKey={selectedLeague} />
      </div>
    </div>
  );
}
