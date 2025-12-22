import { useState, useEffect, useRef } from 'react';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

interface StrategyCornerProps {
  selectedLeague: string | null;
}

interface ClaudeStatus {
  hasKey: boolean;
  provider?: string;
}

type AnalysisType = 'matchup' | 'categories' | 'streaming';

const AUTH_URL = 'https://auth.benloe.com';
const API_BASE = '/api';

export function StrategyCorner({ selectedLeague }: StrategyCornerProps) {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisType, setAnalysisType] = useState<AnalysisType>('matchup');
  const [analysisResult, setAnalysisResult] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

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

  async function runAnalysis() {
    if (!selectedLeague) return;

    setAnalyzing(true);
    setAnalysisResult('');
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE}/fantasy/leagues/${selectedLeague}/analyze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ analysisType }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Analysis failed');
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        // Parse SSE events from chunk
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              // Handle different event types from Claude streaming API
              if (data.type === 'content_block_delta' && data.delta?.text) {
                fullText += data.delta.text;
                setAnalysisResult(fullText);

                // Auto-scroll to bottom
                if (resultRef.current) {
                  resultRef.current.scrollTop = resultRef.current.scrollHeight;
                }
              }

              if (data.type === 'message_stop') {
                break;
              }
            } catch {
              // Ignore parsing errors for non-JSON lines
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Analysis error:', err);
      setError(err.message || 'Failed to run analysis');
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) {
    return <LoadingSpinner message="Checking AI configuration..." />;
  }

  if (!claudeStatus?.hasKey) {
    return (
      <div className="card text-center py-12">
        <div className="mb-6">
          <svg
            className="w-16 h-16 mx-auto text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">
          AI-Powered Strategy Coming Soon
        </h3>
        <p className="text-gray-600 mb-6 max-w-md mx-auto">
          Get personalized fantasy basketball strategy, matchup analysis, and streaming
          recommendations powered by Claude AI.
        </p>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            To enable AI features, add your Anthropic API key in your account settings.
          </p>
          <a
            href={`${AUTH_URL}/dashboard`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Set Up API Key
          </a>
        </div>
      </div>
    );
  }

  const analysisOptions: { value: AnalysisType; label: string; description: string }[] = [
    {
      value: 'matchup',
      label: 'Matchup Analysis',
      description: 'Get insights on your current matchup and which categories to target',
    },
    {
      value: 'categories',
      label: 'Category Breakdown',
      description: 'Understand your team strengths and weaknesses across all categories',
    },
    {
      value: 'streaming',
      label: 'Streaming Suggestions',
      description: 'Get recommendations for players to stream this week',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-xl font-bold text-gray-900 mb-2">AI Strategy Corner</h2>
        <p className="text-gray-600 mb-6">
          Get AI-powered insights and recommendations for your fantasy basketball team.
        </p>

        {/* Analysis Type Selection */}
        <div className="space-y-3 mb-6">
          {analysisOptions.map((option) => (
            <label
              key={option.value}
              className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
                analysisType === option.value
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="analysisType"
                value={option.value}
                checked={analysisType === option.value}
                onChange={(e) => setAnalysisType(e.target.value as AnalysisType)}
                className="mt-1 text-primary-600 focus:ring-primary-500"
              />
              <div className="ml-3">
                <div className="font-medium text-gray-900">{option.label}</div>
                <div className="text-sm text-gray-500">{option.description}</div>
              </div>
            </label>
          ))}
        </div>

        <button
          onClick={runAnalysis}
          disabled={analyzing || !selectedLeague}
          className="w-full py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {analyzing ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Analyzing...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
              Run Analysis
            </>
          )}
        </button>
      </div>

      {/* Error Message */}
      {error && <ErrorMessage message={error} />}

      {/* Analysis Result */}
      {analysisResult && (
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            Analysis Results
          </h3>
          <div
            ref={resultRef}
            className="prose prose-sm max-w-none bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto"
          >
            <pre className="whitespace-pre-wrap font-sans text-gray-800">{analysisResult}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
