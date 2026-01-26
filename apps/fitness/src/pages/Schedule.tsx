import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Plus,
  MoreVertical,
  Check,
  X,
  Trash2,
  Dumbbell,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { api } from '../services/api';
import type { WorkoutTemplate, WorkoutExercise } from '../services/api';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ExerciseItem({ exercise, onDelete }: { exercise: WorkoutExercise; onDelete: () => void }) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="group flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-800/30 hover:bg-slate-800/50 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
        <Dumbbell size={16} className="text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{exercise.name}</p>
        <p className="text-xs text-slate-500">
          {exercise.sets && exercise.reps
            ? `${exercise.sets} sets × ${exercise.reps}`
            : exercise.duration || 'No details'}
        </p>
      </div>
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 opacity-0 group-hover:opacity-100 transition-all"
        >
          <MoreVertical size={16} />
        </button>
        {showMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
            <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 py-1 min-w-32">
              <button
                onClick={() => {
                  onDelete();
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-slate-700/50"
              >
                <Trash2 size={14} />
                Remove
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AddExerciseForm({ dayOfWeek, onAdd, onCancel }: {
  dayOfWeek: number;
  onAdd: (exercise: WorkoutExercise) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [sets, setSets] = useState('');
  const [reps, setReps] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const { exercise } = await api.workouts.addExercise(dayOfWeek, {
        name: name.trim(),
        sets: sets ? parseInt(sets) : undefined,
        reps: reps || undefined,
      });
      onAdd(exercise);
    } catch (error) {
      console.error('Failed to add exercise:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 space-y-3">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Exercise name"
        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
        autoFocus
      />
      <div className="flex gap-2">
        <input
          type="number"
          value={sets}
          onChange={(e) => setSets(e.target.value)}
          placeholder="Sets"
          className="flex-1 px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
        />
        <input
          type="text"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          placeholder="Reps (e.g., 8-12)"
          className="flex-1 px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 btn btn-secondary"
          disabled={loading}
        >
          <X size={16} />
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 btn btn-primary"
          disabled={loading || !name.trim()}
        >
          <Check size={16} />
          Add
        </button>
      </div>
    </form>
  );
}

function DayCard({ dayOfWeek, workout, isToday, isSelected, onClick, onUpdate }: {
  dayOfWeek: number;
  workout: WorkoutTemplate | null;
  isToday: boolean;
  isSelected: boolean;
  onClick: () => void;
  onUpdate: (workout: WorkoutTemplate) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [workoutName, setWorkoutName] = useState('');

  async function createWorkout(e: React.FormEvent) {
    e.preventDefault();
    if (!workoutName.trim()) return;

    setIsCreating(true);
    try {
      const { workout: newWorkout } = await api.workouts.updateDay(dayOfWeek, {
        name: workoutName.trim(),
      });
      onUpdate(newWorkout);
      setWorkoutName('');
    } catch (error) {
      console.error('Failed to create workout:', error);
    } finally {
      setIsCreating(false);
    }
  }

  async function deleteExercise(exerciseId: string) {
    try {
      await api.workouts.deleteExercise(exerciseId);
      if (workout) {
        onUpdate({
          ...workout,
          exercises: workout.exercises.filter((e) => e.id !== exerciseId),
        });
      }
    } catch (error) {
      console.error('Failed to delete exercise:', error);
    }
  }

  function handleAddExercise(exercise: WorkoutExercise) {
    if (workout) {
      onUpdate({
        ...workout,
        exercises: [...workout.exercises, exercise],
      });
    }
    setShowAddForm(false);
  }

  // Mobile: Compact card
  // Desktop: Full detail
  return (
    <div
      className={`rounded-2xl border transition-all ${
        isSelected
          ? 'bg-emerald-500/5 border-emerald-500/30'
          : 'bg-slate-900/30 border-slate-800/50 hover:border-slate-700/50'
      } ${isToday ? 'ring-2 ring-emerald-500/20' : ''}`}
    >
      {/* Header - clickable on mobile */}
      <button
        onClick={onClick}
        className="w-full p-4 text-left lg:cursor-default"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-semibold ${
              isToday
                ? 'bg-emerald-500 text-white'
                : workout
                ? 'bg-slate-700 text-white'
                : 'bg-slate-800 text-slate-500'
            }`}>
              {SHORT_DAYS[dayOfWeek][0]}
            </div>
            <div>
              <p className="font-medium text-white">{DAYS[dayOfWeek]}</p>
              <p className="text-sm text-slate-500">
                {workout ? workout.name : 'Rest Day'}
              </p>
            </div>
          </div>
          <div className="lg:hidden">
            <ChevronRight size={20} className={`text-slate-500 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
          </div>
          {isToday && (
            <span className="hidden lg:inline-flex px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium">
              Today
            </span>
          )}
        </div>
      </button>

      {/* Expanded content (always visible on desktop, toggleable on mobile) */}
      <div className={`lg:block ${isSelected ? 'block' : 'hidden'}`}>
        <div className="px-4 pb-4 space-y-3">
          {workout ? (
            <>
              {workout.exercises.length > 0 ? (
                <div className="space-y-2">
                  {workout.exercises.map((exercise) => (
                    <ExerciseItem
                      key={exercise.id}
                      exercise={exercise}
                      onDelete={() => deleteExercise(exercise.id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 text-center py-4">
                  No exercises added yet
                </p>
              )}

              {showAddForm ? (
                <AddExerciseForm
                  dayOfWeek={dayOfWeek}
                  onAdd={handleAddExercise}
                  onCancel={() => setShowAddForm(false)}
                />
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full py-2.5 rounded-xl border border-dashed border-slate-700 text-sm text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50 transition-colors flex items-center justify-center gap-2"
                >
                  <Plus size={16} />
                  Add Exercise
                </button>
              )}
            </>
          ) : (
            <form onSubmit={createWorkout} className="space-y-3">
              <input
                type="text"
                value={workoutName}
                onChange={(e) => setWorkoutName(e.target.value)}
                placeholder="Name this workout..."
                className="w-full px-3 py-2.5 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={isCreating || !workoutName.trim()}
                className="w-full btn btn-primary"
              >
                <Plus size={16} />
                Create Workout
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="px-4 lg:px-8 space-y-4">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="skeleton h-24 rounded-2xl" />
      ))}
    </div>
  );
}

export function Schedule() {
  const [loading, setLoading] = useState(true);
  const [workouts, setWorkouts] = useState<Map<number, WorkoutTemplate>>(new Map());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const today = new Date().getDay();

  useEffect(() => {
    async function loadWorkouts() {
      try {
        const { workouts: data } = await api.workouts.getAll();
        const workoutMap = new Map<number, WorkoutTemplate>();
        data.forEach((w) => workoutMap.set(w.dayOfWeek, w));
        setWorkouts(workoutMap);
      } catch (error) {
        console.error('Failed to load workouts:', error);
      } finally {
        setLoading(false);
      }
    }

    loadWorkouts();
  }, []);

  function handleWorkoutUpdate(dayOfWeek: number, workout: WorkoutTemplate) {
    setWorkouts((prev) => new Map(prev).set(dayOfWeek, workout));
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Weekly Schedule" subtitle="Plan your training week" />
        <LoadingSkeleton />
      </>
    );
  }

  // Reorder days starting from today
  const orderedDays = [...Array(7)].map((_, i) => (today + i) % 7);

  return (
    <>
      <PageHeader
        title="Weekly Schedule"
        subtitle="Plan your training week"
      />

      <div className="px-4 lg:px-8 pb-8">
        {/* Desktop: Grid view */}
        <div className="hidden lg:grid lg:grid-cols-7 gap-4">
          {[0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => (
            <DayCard
              key={dayOfWeek}
              dayOfWeek={dayOfWeek}
              workout={workouts.get(dayOfWeek) || null}
              isToday={dayOfWeek === today}
              isSelected={true}
              onClick={() => {}}
              onUpdate={(w) => handleWorkoutUpdate(dayOfWeek, w)}
            />
          ))}
        </div>

        {/* Mobile: List view starting from today */}
        <div className="lg:hidden space-y-3">
          {orderedDays.map((dayOfWeek) => (
            <DayCard
              key={dayOfWeek}
              dayOfWeek={dayOfWeek}
              workout={workouts.get(dayOfWeek) || null}
              isToday={dayOfWeek === today}
              isSelected={selectedDay === dayOfWeek}
              onClick={() => setSelectedDay(selectedDay === dayOfWeek ? null : dayOfWeek)}
              onUpdate={(w) => handleWorkoutUpdate(dayOfWeek, w)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
