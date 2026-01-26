import { useEffect, useState } from 'react';
import {
  Save,
  Loader2,
  User,
  Target,
  Calendar,
  CheckCircle2,
  LogOut,
  Dumbbell,
  ExternalLink,
  Trash2,
  Plus,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { api } from '../services/api';
import type { UserProfile, Milestone } from '../services/api';
import { useAuthStore } from '../store/authStore';

const GOAL_TYPES = [
  { value: 'weight_loss', label: 'Weight Loss', description: 'Focus on losing body fat' },
  { value: 'strength', label: 'Strength', description: 'Build muscle and increase PRs' },
  { value: 'sport', label: 'Sport Performance', description: 'Train for a specific sport or event' },
  { value: 'consistency', label: 'Consistency', description: 'Build a regular workout habit' },
  { value: 'health', label: 'General Health', description: 'Improve overall fitness and wellbeing' },
  { value: 'general', label: 'General', description: 'Mixed goals' },
];

function ProfileSection({ profile, onSave }: {
  profile: UserProfile | null;
  onSave: (data: Partial<UserProfile>) => Promise<void>;
}) {
  const [goalType, setGoalType] = useState(profile?.goalType || 'general');
  const [targetDate, setTargetDate] = useState(
    profile?.targetDate ? profile.targetDate.split('T')[0] : ''
  );
  const [notes, setNotes] = useState(profile?.notes || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        goalType,
        targetDate: targetDate || null,
        notes: notes || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save profile:', error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Target size={20} className="text-emerald-400" />
        Fitness Goals
      </h3>

      <div className="space-y-5">
        {/* Goal Type */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Primary Goal
          </label>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {GOAL_TYPES.map((type) => (
              <button
                key={type.value}
                onClick={() => setGoalType(type.value)}
                className={`p-3 rounded-xl text-left transition-all ${
                  goalType === type.value
                    ? 'bg-emerald-500/20 border-2 border-emerald-500'
                    : 'bg-slate-800/50 border-2 border-transparent hover:border-slate-700'
                }`}
              >
                <p className={`font-medium text-sm ${
                  goalType === type.value ? 'text-emerald-400' : 'text-white'
                }`}>
                  {type.label}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{type.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Target Date */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Target Date (Optional)
          </label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Any notes about your fitness journey, constraints, or preferences..."
            className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 resize-none"
          />
        </div>

        {/* Goal Summary */}
        {profile?.primaryGoalSummary && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
            <p className="text-xs text-emerald-400 font-medium mb-1">AI Goal Summary</p>
            <p className="text-sm text-slate-300">{profile.primaryGoalSummary}</p>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary w-full"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : saved ? (
            <CheckCircle2 size={16} />
          ) : (
            <Save size={16} />
          )}
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

function MilestoneItem({ milestone, onComplete, onDelete }: {
  milestone: Milestone;
  onComplete: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`flex items-start gap-3 py-3 px-4 rounded-xl ${
      milestone.completed ? 'bg-slate-800/30' : 'bg-slate-800/50'
    }`}>
      <button
        onClick={onComplete}
        disabled={milestone.completed}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors ${
          milestone.completed
            ? 'bg-emerald-500 border-emerald-500'
            : 'border-slate-600 hover:border-emerald-500'
        }`}
      >
        {milestone.completed && <CheckCircle2 size={12} className="text-white" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`font-medium text-sm ${
          milestone.completed ? 'text-slate-500 line-through' : 'text-white'
        }`}>
          {milestone.title}
        </p>
        {milestone.description && (
          <p className="text-xs text-slate-500 mt-0.5">{milestone.description}</p>
        )}
        {milestone.targetDate && (
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
            <Calendar size={12} />
            {new Date(milestone.targetDate).toLocaleDateString()}
          </p>
        )}
      </div>
      <button
        onClick={onDelete}
        className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function MilestonesSection() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    async function loadMilestones() {
      try {
        const { milestones: data } = await api.milestones.getAll();
        setMilestones(data);
      } catch (error) {
        console.error('Failed to load milestones:', error);
      } finally {
        setLoading(false);
      }
    }

    loadMilestones();
  }, []);

  async function handleAdd() {
    if (!newTitle.trim()) return;

    setAdding(true);
    try {
      const { milestone } = await api.milestones.create({
        title: newTitle.trim(),
        targetDate: newDate || undefined,
      });
      setMilestones((prev) => [milestone, ...prev]);
      setNewTitle('');
      setNewDate('');
      setShowAdd(false);
    } catch (error) {
      console.error('Failed to create milestone:', error);
    } finally {
      setAdding(false);
    }
  }

  async function handleComplete(id: string) {
    try {
      const { milestone } = await api.milestones.complete(id);
      setMilestones((prev) =>
        prev.map((m) => (m.id === id ? milestone : m))
      );
    } catch (error) {
      console.error('Failed to complete milestone:', error);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.milestones.delete(id);
      setMilestones((prev) => prev.filter((m) => m.id !== id));
    } catch (error) {
      console.error('Failed to delete milestone:', error);
    }
  }

  return (
    <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <CheckCircle2 size={20} className="text-emerald-400" />
          Milestones
        </h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="btn btn-ghost text-sm"
        >
          <Plus size={16} />
          Add
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 bg-slate-800/50 rounded-xl space-y-3">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Milestone title"
            className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="flex-1 btn btn-secondary text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={adding || !newTitle.trim()}
              className="flex-1 btn btn-primary text-sm"
            >
              {adding ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : milestones.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">
          No milestones yet. Add one or ask your coach to help set goals.
        </p>
      ) : (
        <div className="space-y-2">
          {milestones.map((milestone) => (
            <MilestoneItem
              key={milestone.id}
              milestone={milestone}
              onComplete={() => handleComplete(milestone.id)}
              onDelete={() => handleDelete(milestone.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountSection() {
  const { user, logout } = useAuthStore();

  return (
    <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <User size={20} className="text-emerald-400" />
        Account
      </h3>

      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-xl font-semibold text-white">
            {user?.name?.[0] || user?.email?.[0] || '?'}
          </div>
          <div>
            <p className="font-medium text-white">{user?.name || 'User'}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800/50 space-y-3">
          <a
            href="https://weights.benloe.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <Dumbbell size={18} className="text-amber-400" />
              <span className="text-sm text-white">PR Tracker</span>
            </div>
            <ExternalLink size={14} className="text-slate-500 group-hover:text-slate-400" />
          </a>

          <a
            href="https://auth.benloe.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <User size={18} className="text-slate-400" />
              <span className="text-sm text-white">Account Settings</span>
            </div>
            <ExternalLink size={14} className="text-slate-500 group-hover:text-slate-400" />
          </a>

          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <LogOut size={18} />
            <span className="text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function Settings() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      try {
        const { profile: data } = await api.profile.get();
        setProfile(data);
      } catch (error) {
        console.error('Failed to load profile:', error);
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, []);

  async function handleSaveProfile(data: Partial<UserProfile>) {
    const { profile: updated } = await api.profile.update(data);
    setProfile(updated);
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your profile and preferences" />

      <div className="px-4 lg:px-8 pb-8 space-y-6 max-w-2xl">
        {loading ? (
          <>
            <div className="skeleton h-64 rounded-2xl" />
            <div className="skeleton h-48 rounded-2xl" />
            <div className="skeleton h-48 rounded-2xl" />
          </>
        ) : (
          <>
            <ProfileSection profile={profile} onSave={handleSaveProfile} />
            <MilestonesSection />
            <AccountSection />
          </>
        )}
      </div>
    </>
  );
}
