import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Flame,
  Trophy,
  Target,
  ChevronRight,
  Dumbbell,
  Clock,
  CheckCircle2,
  Play,
  TrendingUp,
  Calendar,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { api } from '../services/api';
import type {
  WorkoutTemplate,
  StreakInfo,
  MetricWithLatest,
  Milestone,
} from '../services/api';

function StreakRing({ current, longest }: { current: number; longest: number }) {
  const percentage = longest > 0 ? Math.min((current / longest) * 100, 100) : 0;
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative w-32 h-32">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="45"
          className="stroke-slate-800"
          strokeWidth="8"
          fill="none"
        />
        <circle
          cx="50"
          cy="50"
          r="45"
          className="stroke-emerald-500 data-ring"
          strokeWidth="8"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <Flame className="text-emerald-400 mb-1" size={24} />
        <span className="text-3xl font-bold text-white">{current}</span>
        <span className="text-xs text-slate-500">day streak</span>
      </div>
    </div>
  );
}

function TodayWorkoutCard({ workout, dayName }: { workout: WorkoutTemplate | null; dayName: string }) {
  if (!workout) {
    return (
      <div className="bg-slate-900/50 border border-slate-800/50 rounded-2xl p-6 animate-slide-up stagger-1">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
            <Calendar size={20} className="text-slate-500" />
          </div>
          <div>
            <h3 className="font-semibold text-white">{dayName}</h3>
            <p className="text-sm text-slate-500">Rest Day</p>
          </div>
        </div>
        <p className="text-slate-400 text-sm">
          No workout scheduled. Take time to recover and recharge.
        </p>
        <Link
          to="/schedule"
          className="mt-4 inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          Add a workout
          <ChevronRight size={16} />
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 rounded-2xl p-6 animate-slide-up stagger-1">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <Dumbbell size={20} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">{workout.name}</h3>
            <p className="text-sm text-emerald-400/80">{dayName} Workout</p>
          </div>
        </div>
        <button className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-500/30">
          <Play size={18} className="text-white ml-0.5" fill="white" />
        </button>
      </div>

      <div className="space-y-2">
        {workout.exercises.slice(0, 4).map((exercise, idx) => (
          <div
            key={exercise.id}
            className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-900/30"
          >
            <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-xs font-medium text-slate-400">
              {idx + 1}
            </div>
            <span className="flex-1 text-sm text-slate-200">{exercise.name}</span>
            {exercise.sets && exercise.reps && (
              <span className="text-xs text-slate-500">
                {exercise.sets} × {exercise.reps}
              </span>
            )}
          </div>
        ))}
        {workout.exercises.length > 4 && (
          <p className="text-xs text-slate-500 pl-12">
            +{workout.exercises.length - 4} more exercises
          </p>
        )}
      </div>

      <Link
        to="/schedule"
        className="mt-4 inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
      >
        View full workout
        <ChevronRight size={16} />
      </Link>
    </div>
  );
}

function StatsCard({ icon: Icon, label, value, subtext, color = 'emerald' }: {
  icon: typeof Trophy;
  label: string;
  value: string | number;
  subtext?: string;
  color?: 'emerald' | 'blue' | 'amber';
}) {
  const colorClasses = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };

  return (
    <div className={`rounded-xl p-4 border ${colorClasses[color]} card-hover`}>
      <Icon size={20} className="mb-2" />
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-sm text-slate-400">{label}</p>
      {subtext && <p className="text-xs text-slate-500 mt-1">{subtext}</p>}
    </div>
  );
}

function MetricCard({ metric }: { metric: MetricWithLatest }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 card-hover">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-400">{metric.name}</span>
        <TrendingUp size={14} className="text-emerald-400" />
      </div>
      <p className="text-xl font-semibold text-white">
        {metric.latestValue?.value ?? '—'}
        {metric.unit && <span className="text-sm text-slate-500 ml-1">{metric.unit}</span>}
      </p>
    </div>
  );
}

function MilestoneItem({ milestone }: { milestone: Milestone }) {
  const isOverdue = milestone.targetDate && new Date(milestone.targetDate) < new Date() && !milestone.completed;

  return (
    <div className="flex items-start gap-3 py-3">
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
        milestone.completed
          ? 'bg-emerald-500 border-emerald-500'
          : isOverdue
          ? 'border-amber-500'
          : 'border-slate-600'
      }`}>
        {milestone.completed && <CheckCircle2 size={12} className="text-white" />}
      </div>
      <div className="flex-1">
        <p className={`text-sm font-medium ${milestone.completed ? 'text-slate-500 line-through' : 'text-white'}`}>
          {milestone.title}
        </p>
        {milestone.targetDate && !milestone.completed && (
          <p className={`text-xs ${isOverdue ? 'text-amber-400' : 'text-slate-500'}`}>
            {isOverdue ? 'Overdue' : `Target: ${new Date(milestone.targetDate).toLocaleDateString()}`}
          </p>
        )}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 px-4 lg:px-8">
      <div className="skeleton h-32 rounded-2xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="skeleton h-64 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    </div>
  );
}

export function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [todayWorkout, setTodayWorkout] = useState<WorkoutTemplate | null>(null);
  const [streaks, setStreaks] = useState<StreakInfo | null>(null);
  const [metrics, setMetrics] = useState<MetricWithLatest[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  const today = new Date();
  const dayOfWeek = today.getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  useEffect(() => {
    async function loadData() {
      try {
        const [workoutRes, streakRes, metricsRes, milestonesRes] = await Promise.all([
          api.workouts.getDay(dayOfWeek),
          api.completions.getStreaks(),
          api.metrics.getAll(),
          api.milestones.getAll(false),
        ]);

        setTodayWorkout(workoutRes.workout);
        setStreaks(streakRes);
        setMetrics(metricsRes.metrics);
        setMilestones(milestonesRes.milestones.filter((m) => !m.completed).slice(0, 5));
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [dayOfWeek]);

  if (loading) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle={`Happy ${dayNames[dayOfWeek]}!`} />
        <LoadingSkeleton />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Happy ${dayNames[dayOfWeek]}! Let's make it count.`}
      />

      <div className="px-4 lg:px-8 space-y-6 pb-8">
        {/* Today's Workout */}
        <TodayWorkoutCard workout={todayWorkout} dayName={dayNames[dayOfWeek]} />

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-slide-up stagger-2">
          <div className="col-span-2 lg:col-span-1 flex items-center justify-center bg-slate-900/50 border border-slate-800/50 rounded-xl p-4">
            <StreakRing
              current={streaks?.currentStreak ?? 0}
              longest={streaks?.longestStreak ?? 0}
            />
          </div>
          <StatsCard
            icon={Trophy}
            label="Best Streak"
            value={streaks?.longestStreak ?? 0}
            subtext="days"
            color="amber"
          />
          <StatsCard
            icon={Target}
            label="Total Workouts"
            value={streaks?.totalWorkouts ?? 0}
            subtext="completed"
            color="blue"
          />
          <StatsCard
            icon={Clock}
            label="Last Workout"
            value={streaks?.lastWorkoutDate
              ? new Date(streaks.lastWorkoutDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '—'}
            color="emerald"
          />
        </div>

        {/* Metrics & Milestones */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Metrics */}
          <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6 animate-slide-up stagger-3">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Recent Metrics</h2>
              <Link
                to="/progress"
                className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
              >
                View all
                <ChevronRight size={16} />
              </Link>
            </div>
            {metrics.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {metrics.slice(0, 4).map((metric) => (
                  <MetricCard key={metric.id} metric={metric} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <TrendingUp size={32} className="text-slate-700 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">No metrics tracked yet</p>
                <Link
                  to="/chat"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-400"
                >
                  Ask your coach to set some up
                </Link>
              </div>
            )}
          </div>

          {/* Milestones */}
          <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6 animate-slide-up stagger-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Active Milestones</h2>
              <Link
                to="/settings"
                className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
              >
                Manage
                <ChevronRight size={16} />
              </Link>
            </div>
            {milestones.length > 0 ? (
              <div className="divide-y divide-slate-800/50">
                {milestones.map((milestone) => (
                  <MilestoneItem key={milestone.id} milestone={milestone} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Target size={32} className="text-slate-700 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">No active milestones</p>
                <Link
                  to="/chat"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-400"
                >
                  Set goals with your coach
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
