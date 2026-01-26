import { useEffect, useState, useRef } from 'react';
import {
  Send,
  Loader2,
  Trash2,
  Bot,
  User,
  Wrench,
  ChevronDown,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { api } from '../services/api';
import type { ChatMessage, ToolCallResult } from '../services/api';

function MessageBubble({ message, isLast }: { message: ChatMessage; isLast: boolean }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''} ${
        isLast ? 'animate-slide-up' : ''
      }`}
    >
      <div
        className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${
          isUser
            ? 'bg-slate-700'
            : 'bg-gradient-to-br from-emerald-400 to-emerald-600'
        }`}
      >
        {isUser ? (
          <User size={16} className="text-slate-300" />
        ) : (
          <Bot size={16} className="text-white" />
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-emerald-500/20 text-white'
            : 'bg-slate-800/80 text-slate-100'
        }`}
      >
        <div className="text-sm whitespace-pre-wrap leading-relaxed">
          {message.content}
        </div>
        <p className="text-[10px] text-slate-500 mt-2">
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
}

function ToolCallIndicator({ toolCalls }: { toolCalls: ToolCallResult[] }) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex-shrink-0 flex items-center justify-center">
        <Wrench size={14} className="text-amber-400" />
      </div>
      <div className="flex-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs text-amber-400 hover:text-amber-300 transition-colors"
        >
          <span>
            {toolCalls.length} tool{toolCalls.length !== 1 ? 's' : ''} executed
          </span>
          <ChevronDown
            size={14}
            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        {expanded && (
          <div className="mt-2 space-y-2">
            {toolCalls.map((call, i) => (
              <div
                key={i}
                className="text-xs bg-slate-800/50 rounded-lg p-3 font-mono"
              >
                <p className="text-amber-400 font-semibold">{call.tool}</p>
                <pre className="text-slate-400 mt-1 overflow-x-auto">
                  {JSON.stringify(call.input, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-400/20 to-emerald-600/10 flex items-center justify-center mb-6">
        <Bot size={40} className="text-emerald-400" />
      </div>
      <h3 className="text-xl font-semibold text-white mb-2">
        Executive Fitness Director
      </h3>
      <p className="text-slate-400 max-w-md mb-6">
        Your AI-powered fitness coach. I can help you design workouts, track
        progress, set goals, and adapt your training to your needs.
      </p>
      <div className="grid gap-2 text-sm text-left max-w-sm">
        <SuggestionChip text="Set up my weekly workout schedule" />
        <SuggestionChip text="What should I focus on this week?" />
        <SuggestionChip text="Help me define my fitness goals" />
        <SuggestionChip text="Log my workout as complete" />
      </div>
    </div>
  );
}

function SuggestionChip({ text }: { text: string }) {
  return (
    <div className="px-4 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-300 cursor-default">
      "{text}"
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex-shrink-0 flex items-center justify-center">
        <Bot size={16} className="text-white" />
      </div>
      <div className="bg-slate-800/80 rounded-2xl px-4 py-3 flex items-center gap-2">
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <span className="text-sm text-slate-400">Thinking...</span>
      </div>
    </div>
  );
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastToolCalls, setLastToolCalls] = useState<ToolCallResult[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      try {
        const { messages: history } = await api.chat.getHistory();
        setMessages(history);
      } catch (error) {
        console.error('Failed to load chat history:', error);
      } finally {
        setLoading(false);
      }
    }

    loadHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function handleSend() {
    if (!input.trim() || sending) return;

    const userMessage = input.trim();
    setInput('');
    setSending(true);
    setLastToolCalls([]);

    // Optimistic update with user message
    const tempUserMsg: ChatMessage = {
      id: 'temp-user',
      role: 'user',
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const response = await api.chat.sendMessage(userMessage);

      // Replace temp message and add assistant response
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== 'temp-user');
        return [
          ...withoutTemp,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content: userMessage,
            createdAt: new Date().toISOString(),
          },
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: response.message,
            createdAt: new Date().toISOString(),
          },
        ];
      });

      if (response.toolCalls.length > 0) {
        setLastToolCalls(response.toolCalls);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic update on error
      setMessages((prev) => prev.filter((m) => m.id !== 'temp-user'));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function handleClearHistory() {
    if (!confirm('Clear all chat history? This cannot be undone.')) return;

    try {
      await api.chat.clearHistory();
      setMessages([]);
      setLastToolCalls([]);
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] lg:h-screen">
      <PageHeader
        title="Coach"
        subtitle="Your Executive Fitness Director"
        action={
          messages.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="btn btn-ghost text-slate-500 hover:text-red-400"
            >
              <Trash2 size={16} />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )
        }
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 lg:px-8">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
          </div>
        ) : messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4 pb-4 max-w-3xl mx-auto">
            {messages.map((message, i) => (
              <MessageBubble
                key={message.id}
                message={message}
                isLast={i === messages.length - 1}
              />
            ))}
            {sending && <LoadingIndicator />}
            {lastToolCalls.length > 0 && !sending && (
              <ToolCallIndicator toolCalls={lastToolCalls} />
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-800/50 bg-slate-900/50 backdrop-blur-xl p-4 lg:px-8">
        <div className="max-w-3xl mx-auto flex gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your coach anything..."
              rows={1}
              className="w-full px-4 py-3 pr-12 bg-slate-800/80 border border-slate-700/50 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 resize-none"
              disabled={sending}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="btn btn-primary px-4"
          >
            {sending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
        <p className="text-xs text-slate-500 text-center mt-2 max-w-3xl mx-auto">
          Your coach can manage your workouts, track progress, and help you reach your goals
        </p>
      </div>
    </div>
  );
}
