import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Plus,
  Dumbbell,
  ExternalLink,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { api } from '../services/api';
import type { WorkoutCompletion, MetricWithLatest, StreakInfo } from '../services/api';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SHORT_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function CalendarView({ year, month, completions, onMonthChange }: {
  year: number;
  month: number;
  completions: Record<string, WorkoutCompletion[]>;
  onMonthChange: (year: number, month: number) => void;
}) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  function prevMonth() {
    if (month === 1) {
      onMonthChange(year - 1, 12);
    } else {
      onMonthChange(year, month - 1);
    }
  }

  function nextMonth() {
    if (month === 12) {
      onMonthChange(year + 1, 1);
    } else {
      onMonthChange(year, month + 1);
    }
  }

  function getDateKey(day: number) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return (
    <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={prevMonth}
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <h3 className="text-lg font-semibold text-white">
          {MONTHS[month - 1]} {year}
        </h3>
        <button
          onClick={nextMonth}
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {SHORT_DAYS.map((day, i) => (
          <div key={i} className="text-center text-xs font-medium text-slate-500 py-2">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          if (day === null) {
            return <div key={i} className="aspect-square" />;
          }

          const dateKey = getDateKey(day);
          const dayCompletions = completions[dateKey] || [];
          const hasWorkout = dayCompletions.length > 0;
          const isToday = isCurrentMonth && day === today.getDate();
          const isFuture = new Date(year, month - 1, day) > today;

          return (
            <div
              key={i}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center relative transition-colors ${
                isToday
                  ? 'bg-emerald-500/20 ring-2 ring-emerald-500'
                  : hasWorkout
                  ? 'bg-emerald-500/10'
                  : 'hover:bg-slate-800/50'
              } ${isFuture ? 'opacity-40' : ''}`}
            >
              <span className={`text-sm ${
                isToday ? 'text-emerald-400 font-semibold' : hasWorkout ? 'text-white' : 'text-slate-400'
              }`}>
                {day}
              </span>
              {hasWorkout && (
                <div className="absolute bottom-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-slate-800/50 flex items-center justify-center gap-6 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-emerald-500/20 ring-1 ring-emerald-500" />
          <span>Today</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-emerald-500/10 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </div>
          <span>Workout completed</span>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ metric, onLogValue }: { metric: MetricWithLatest; onLogValue: () => void }) {
  return (
    <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-4 card-hover">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-white">{metric.name}</h4>
        <button
          onClick={onLogValue}
          className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-white">
          {metric.latestValue?.value ?? '—'}
        </span>
        {metric.unit && (
          <span className="text-sm text-slate-500 mb-1">{metric.unit}</span>
        )}
      </div>
      {metric.latestValue && (
        <p className="text-xs text-slate-500 mt-2">
          Last logged: {new Date(metric.latestValue.recordedDate).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

function LogMetricModal({ metric, onClose, onLog }: {
  metric: MetricWithLatest;
  onClose: () => void;
  onLog: (value: number) => void;
}) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;

    setLoading(true);
    try {
      await api.metrics.logValue(metric.id, { value: parseFloat(value) });
      onLog(parseFloat(value));
    } catch (error) {
      console.error('Failed to log metric:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6 animate-slide-up">
        <h3 className="text-lg font-semibold text-white mb-4">Log {metric.name}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter value"
              className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-lg placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              autoFocus
            />
            {metric.unit && (
              <span className="text-slate-400">{metric.unit}</span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn btn-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 btn btn-primary"
              disabled={loading || !value}
            >
              <Check size={16} />
              Log
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PRCard() {
  return (
    <a
      href="https://weights.benloe.com"
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 rounded-xl p-4 card-hover group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Dumbbell size={18} className="text-amber-400" />
          <h4 className="font-medium text-white">Personal Records</h4>
        </div>
        <ExternalLink size={14} className="text-slate-500 group-hover:text-amber-400 transition-colors" />
      </div>
      <p className="text-sm text-slate-400">
        Track your lifting PRs in the dedicated weights app
      </p>
    </a>
  );
}

function StatsRow({ streaks }: { streaks: StreakInfo }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-4 text-center">
        <p className="text-2xl font-bold text-emerald-400">{streaks.currentStreak}</p>
        <p className="text-xs text-slate-500">Current Streak</p>
      </div>
      <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-4 text-center">
        <p className="text-2xl font-bold text-amber-400">{streaks.longestStreak}</p>
        <p className="text-xs text-slate-500">Best Streak</p>
      </div>
      <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-4 text-center">
        <p className="text-2xl font-bold text-white">{streaks.totalWorkouts}</p>
        <p className="text-xs text-slate-500">Total Workouts</p>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="px-4 lg:px-8 space-y-6">
      <div className="skeleton h-80 rounded-2xl" />
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-20 rounded-xl" />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function Progress() {
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [completions, setCompletions] = useState<Record<string, WorkoutCompletion[]>>({});
  const [metrics, setMetrics] = useState<MetricWithLatest[]>([]);
  const [streaks, setStreaks] = useState<StreakInfo | null>(null);
  const [logMetric, setLogMetric] = useState<MetricWithLatest | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [calRes, metricsRes, streakRes] = await Promise.all([
          api.completions.getCalendar(year, month),
          api.metrics.getAll(),
          api.completions.getStreaks(),
        ]);

        setCompletions(calRes.calendarData);
        setMetrics(metricsRes.metrics);
        setStreaks(streakRes);
      } catch (error) {
        console.error('Failed to load progress data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [year, month]);

  async function handleMonthChange(newYear: number, newMonth: number) {
    setYear(newYear);
    setMonth(newMonth);
    try {
      const { calendarData } = await api.completions.getCalendar(newYear, newMonth);
      setCompletions(calendarData);
    } catch (error) {
      console.error('Failed to load calendar:', error);
    }
  }

  function handleMetricLogged(metricId: string, value: number) {
    setMetrics((prev) =>
      prev.map((m) =>
        m.id === metricId
          ? {
              ...m,
              latestValue: {
                id: 'temp',
                metricDefinitionId: metricId,
                value,
                recordedDate: new Date().toISOString(),
                notes: null,
              },
            }
          : m
      )
    );
    setLogMetric(null);
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Progress" subtitle="Track your fitness journey" />
        <LoadingSkeleton />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Progress" subtitle="Track your fitness journey" />

      <div className="px-4 lg:px-8 pb-8 space-y-6">
        {/* Calendar */}
        <CalendarView
          year={year}
          month={month}
          completions={completions}
          onMonthChange={handleMonthChange}
        />

        {/* Stats */}
        {streaks && <StatsRow streaks={streaks} />}

        {/* Metrics */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">Metrics</h3>
          <div className="grid lg:grid-cols-2 gap-4">
            {metrics.map((metric) => (
              <MetricCard
                key={metric.id}
                metric={metric}
                onLogValue={() => setLogMetric(metric)}
              />
            ))}
            <PRCard />
          </div>
        </div>
      </div>

      {/* Log Metric Modal */}
      {logMetric && (
        <LogMetricModal
          metric={logMetric}
          onClose={() => setLogMetric(null)}
          onLog={(value) => handleMetricLogged(logMetric.id, value)}
        />
      )}
    </>
  );
}
