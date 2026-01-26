const API_BASE = '/api';

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

export const api = {
  // Auth
  auth: {
    me: () => fetchApi<{ user: User }>('/user/me'),
  },

  // Profile
  profile: {
    get: () => fetchApi<{ profile: UserProfile }>('/profile'),
    update: (data: Partial<UserProfile>) =>
      fetchApi<{ profile: UserProfile }>('/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  // Workouts
  workouts: {
    getAll: () => fetchApi<{ workouts: WorkoutTemplate[] }>('/workouts'),
    getDay: (day: number) => fetchApi<{ workout: WorkoutTemplate | null }>(`/workouts/${day}`),
    updateDay: (day: number, data: { name: string; description?: string; isActive?: boolean }) =>
      fetchApi<{ workout: WorkoutTemplate }>(`/workouts/${day}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteDay: (day: number) =>
      fetchApi<{ message: string }>(`/workouts/${day}`, { method: 'DELETE' }),
    addExercise: (day: number, data: { name: string; sets?: number; reps?: string; duration?: string; notes?: string }) =>
      fetchApi<{ exercise: WorkoutExercise }>(`/workouts/${day}/exercises`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateExercise: (id: string, data: Partial<WorkoutExercise>) =>
      fetchApi<{ exercise: WorkoutExercise }>(`/workouts/exercises/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteExercise: (id: string) =>
      fetchApi<{ message: string }>(`/workouts/exercises/${id}`, { method: 'DELETE' }),
  },

  // Exercises library
  exercises: {
    getAll: () => fetchApi<{ exercises: ExerciseDetail[] }>('/exercises'),
    get: (id: string) => fetchApi<{ exercise: ExerciseDetail }>(`/exercises/${id}`),
    getByName: (name: string) => fetchApi<{ exercise: ExerciseDetail }>(`/exercises/by-name/${encodeURIComponent(name)}`),
    create: (data: Partial<ExerciseDetail>) =>
      fetchApi<{ exercise: ExerciseDetail }>('/exercises', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<ExerciseDetail>) =>
      fetchApi<{ exercise: ExerciseDetail }>(`/exercises/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<{ message: string }>(`/exercises/${id}`, { method: 'DELETE' }),
  },

  // Completions
  completions: {
    getAll: (params?: { startDate?: string; endDate?: string; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.startDate) query.set('startDate', params.startDate);
      if (params?.endDate) query.set('endDate', params.endDate);
      if (params?.limit) query.set('limit', params.limit.toString());
      return fetchApi<{ completions: WorkoutCompletion[] }>(`/completions?${query}`);
    },
    getStreaks: () => fetchApi<StreakInfo>('/completions/streaks'),
    getCalendar: (year: number, month: number) =>
      fetchApi<{ calendarData: Record<string, WorkoutCompletion[]>; year: number; month: number }>(
        `/completions/calendar/${year}/${month}`
      ),
    create: (data: { workoutName: string; completedDate?: string; notes?: string; duration?: number; rating?: number }) =>
      fetchApi<{ completion: WorkoutCompletion }>('/completions', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<{ message: string }>(`/completions/${id}`, { method: 'DELETE' }),
  },

  // Metrics
  metrics: {
    getAll: () => fetchApi<{ metrics: MetricWithLatest[] }>('/metrics'),
    create: (data: { name: string; unit?: string }) =>
      fetchApi<{ metric: MetricDefinition }>('/metrics', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getValues: (id: string, params?: { limit?: number; startDate?: string; endDate?: string }) => {
      const query = new URLSearchParams();
      if (params?.limit) query.set('limit', params.limit.toString());
      if (params?.startDate) query.set('startDate', params.startDate);
      if (params?.endDate) query.set('endDate', params.endDate);
      return fetchApi<{ values: MetricValue[] }>(`/metrics/${id}/values?${query}`);
    },
    logValue: (id: string, data: { value: number; recordedDate?: string; notes?: string }) =>
      fetchApi<{ value: MetricValue }>(`/metrics/${id}/values`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    logByName: (data: { name: string; value: number; unit?: string; recordedDate?: string; notes?: string }) =>
      fetchApi<{ metric: MetricDefinition; value: MetricValue }>('/metrics/by-name', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<{ message: string }>(`/metrics/${id}`, { method: 'DELETE' }),
  },

  // Milestones
  milestones: {
    getAll: (includeCompleted = true) =>
      fetchApi<{ milestones: Milestone[] }>(`/milestones?includeCompleted=${includeCompleted}`),
    create: (data: { title: string; description?: string; targetDate?: string }) =>
      fetchApi<{ milestone: Milestone }>('/milestones', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Milestone>) =>
      fetchApi<{ milestone: Milestone }>(`/milestones/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    complete: (id: string) =>
      fetchApi<{ milestone: Milestone }>(`/milestones/${id}/complete`, { method: 'PUT' }),
    delete: (id: string) =>
      fetchApi<{ message: string }>(`/milestones/${id}`, { method: 'DELETE' }),
  },

  // Weights (read-only proxy)
  weights: {
    getPRs: () => fetchApi<{ prs: WeightPR[] }>('/weights/prs'),
    getExercises: () => fetchApi<{ exercises: WeightExercise[] }>('/weights/exercises'),
  },

  // Chat
  chat: {
    sendMessage: (message: string, includeHistory = true) =>
      fetchApi<{ message: string; toolCalls: ToolCallResult[] }>('/chat/message', {
        method: 'POST',
        body: JSON.stringify({ message, includeHistory }),
      }),
    getHistory: (limit = 50) =>
      fetchApi<{ messages: ChatMessage[] }>(`/chat/history?limit=${limit}`),
    clearHistory: () =>
      fetchApi<{ message: string }>('/chat/history', { method: 'DELETE' }),
  },
};

// Types
export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface UserProfile {
  id: string;
  userId: string;
  primaryGoalSummary: string | null;
  goalType: string;
  targetDate: string | null;
  constraints: Record<string, any> | null;
  notes: string | null;
}

export interface WorkoutTemplate {
  id: string;
  userId: string;
  dayOfWeek: number;
  name: string;
  description: string | null;
  isActive: boolean;
  exercises: WorkoutExercise[];
}

export interface WorkoutExercise {
  id: string;
  workoutTemplateId: string;
  name: string;
  sets: number | null;
  reps: string | null;
  duration: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface ExerciseDetail {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  focusPoints: string[] | null;
  equipmentNeeded: string[] | null;
  modifications: Record<string, any> | null;
  videoUrl: string | null;
}

export interface WorkoutCompletion {
  id: string;
  userId: string;
  workoutName: string;
  completedDate: string;
  notes: string | null;
  duration: number | null;
  rating: number | null;
}

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  totalWorkouts: number;
  lastWorkoutDate: string | null;
}

export interface MetricDefinition {
  id: string;
  userId: string;
  name: string;
  unit: string | null;
}

export interface MetricValue {
  id: string;
  metricDefinitionId: string;
  value: number;
  recordedDate: string;
  notes: string | null;
}

export interface MetricWithLatest extends MetricDefinition {
  latestValue: MetricValue | null;
}

export interface Milestone {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  targetDate: string | null;
  completed: boolean;
  completedAt: string | null;
}

export interface WeightPR {
  exerciseId: string;
  exerciseName: string;
  weight: number;
}

export interface WeightExercise {
  id: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ToolCallResult {
  tool: string;
  input: Record<string, any>;
  result: any;
}
