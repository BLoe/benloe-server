import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Trash2, User, Bot, AlertCircle } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  error?: boolean;
}

interface ChatPanelProps {
  leagueKey: string;
}

const API_BASE = '/api';

export function ChatPanel({ leagueKey }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || isLoading) return;

    setInput('');
    setError(null);

    // Add user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Create placeholder for assistant message
    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, assistantMessage]);
    setIsLoading(true);

    try {
      // Build messages for API (include history)
      const apiMessages = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch(
        `${API_BASE}/fantasy/leagues/${leagueKey}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ messages: apiMessages }),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(data.error || 'Failed to send message');
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
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId ? { ...m, content: fullText } : m
                  )
                );
              }

              if (data.type === 'message_stop') {
                break;
              }

              if (data.type === 'error') {
                throw new Error(data.error?.message || 'Stream error');
              }
            } catch (parseError) {
              // Ignore parsing errors for non-JSON lines
            }
          }
        }
      }

      // If no content was received, show error
      if (!fullText) {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: 'Sorry, I couldn\'t generate a response. Please try again.', error: true }
              : m
          )
        );
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      setError(err.message);
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `Error: ${err.message}`, error: true }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-[600px]" data-testid="chat-panel">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-hawk-orange" />
          <h3 className="font-semibold text-gray-100">AI Strategy Assistant</h3>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            title="Clear conversation"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Ask me anything about your fantasy basketball team!</p>
            <p className="text-sm mt-2 text-gray-600">
              Try: "How should I approach this week's matchup?"
            </p>
          </div>
        ) : (
          messages.map(message => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.role === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-hawk-orange/20 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-hawk-orange" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  message.role === 'user'
                    ? 'bg-hawk-teal/20 text-gray-100'
                    : message.error
                    ? 'bg-red-900/20 text-red-300 border border-red-500/20'
                    : 'bg-gray-800 text-gray-200'
                }`}
              >
                {message.role === 'assistant' && !message.content && isLoading ? (
                  <div className="flex items-center gap-2 text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )}
              </div>
              {message.role === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-hawk-teal/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-hawk-teal" />
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 text-red-400 text-sm rounded-lg mb-3">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Input */}
      <div className="pt-4 border-t border-gray-700">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your fantasy team..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-hawk-orange focus:border-transparent resize-none"
            rows={2}
            disabled={isLoading}
            data-testid="chat-input"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-4 py-2 bg-hawk-orange text-white rounded-lg hover:bg-hawk-orange/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="chat-send"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
