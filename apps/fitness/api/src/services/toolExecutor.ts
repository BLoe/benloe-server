import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const WEIGHTS_API_URL = process.env.WEIGHTS_API_URL || 'http://localhost:3003';

export async function executeToolCall(
  toolName: string,
  input: any,
  userId: string,
  token: string
): Promise<any> {
  try {
    switch (toolName) {
      // READ TOOLS
      case 'get_user_profile':
        return await getUserProfile(userId);

      case 'get_weekly_schedule':
        return await getWeeklySchedule(userId, input.day_of_week);

      case 'get_exercise_details':
        return await getExerciseDetails(userId, input.exercise_name);

      case 'get_prs':
        return await getPRs(token);

      case 'get_completions':
        return await getCompletions(userId, input.days_back || 30);

      case 'get_streaks':
        return await getStreaks(userId);

      case 'get_metrics':
        return await getMetrics(userId, input.metric_name, input.days_back || 30);

      case 'get_milestones':
        return await getMilestones(userId, input.include_completed !== false);

      // WRITE TOOLS
      case 'update_profile':
        return await updateProfile(userId, input);

      case 'update_workout':
        return await updateWorkout(userId, input);

      case 'add_exercise':
        return await addExercise(userId, input);

      case 'remove_exercise':
        return await removeExercise(userId, input);

      case 'update_exercise_detail':
        return await updateExerciseDetail(userId, input);

      case 'mark_complete':
        return await markComplete(userId, input);

      case 'log_metric':
        return await logMetric(userId, input);

      case 'create_milestone':
        return await createMilestone(userId, input);

      case 'complete_milestone':
        return await completeMilestone(userId, input);

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (error: any) {
    console.error(`Tool execution error (${toolName}):`, error);
    return { error: error.message || 'Tool execution failed' };
  }
}

// READ TOOL IMPLEMENTATIONS

async function getUserProfile(userId: string) {
  let profile = await prisma.userProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    profile = await prisma.userProfile.create({
      data: { userId },
    });
  }

  return {
    ...profile,
    constraints: profile.constraints ? JSON.parse(profile.constraints) : null,
  };
}

async function getWeeklySchedule(userId: string, dayOfWeek?: number) {
  if (dayOfWeek !== undefined) {
    const workout = await prisma.workoutTemplate.findUnique({
      where: { userId_dayOfWeek: { userId, dayOfWeek } },
      include: { exercises: { orderBy: { sortOrder: 'asc' } } },
    });
    return { workout };
  }

  const workouts = await prisma.workoutTemplate.findMany({
    where: { userId },
    include: { exercises: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { dayOfWeek: 'asc' },
  });
  return { workouts };
}

async function getExerciseDetails(userId: string, exerciseName?: string) {
  if (exerciseName) {
    const exercise = await prisma.exerciseDetail.findUnique({
      where: { userId_name: { userId, name: exerciseName } },
    });
    if (!exercise) {
      return { error: 'Exercise not found' };
    }
    return {
      exercise: {
        ...exercise,
        focusPoints: exercise.focusPoints ? JSON.parse(exercise.focusPoints) : null,
        equipmentNeeded: exercise.equipmentNeeded ? JSON.parse(exercise.equipmentNeeded) : null,
        modifications: exercise.modifications ? JSON.parse(exercise.modifications) : null,
      },
    };
  }

  const exercises = await prisma.exerciseDetail.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
  });

  return {
    exercises: exercises.map((e) => ({
      ...e,
      focusPoints: e.focusPoints ? JSON.parse(e.focusPoints) : null,
      equipmentNeeded: e.equipmentNeeded ? JSON.parse(e.equipmentNeeded) : null,
      modifications: e.modifications ? JSON.parse(e.modifications) : null,
    })),
  };
}

async function getPRs(token: string) {
  const response = await fetch(`${WEIGHTS_API_URL}/api/prs`, {
    headers: { Cookie: `token=${token}` },
  });
  if (!response.ok) {
    return { error: 'Failed to fetch PRs' };
  }
  return await response.json();
}

async function getCompletions(userId: string, daysBack: number) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const completions = await prisma.workoutCompletion.findMany({
    where: {
      userId,
      completedDate: { gte: startDate },
    },
    orderBy: { completedDate: 'desc' },
  });

  return { completions };
}

async function getStreaks(userId: string) {
  const completions = await prisma.workoutCompletion.findMany({
    where: { userId },
    orderBy: { completedDate: 'desc' },
    select: { completedDate: true },
  });

  if (completions.length === 0) {
    return { currentStreak: 0, longestStreak: 0, totalWorkouts: 0 };
  }

  const uniqueDates = [...new Set(completions.map((c) => c.completedDate.toISOString().split('T')[0]))];
  uniqueDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  let currentStreak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < uniqueDates.length; i++) {
    const date = new Date(uniqueDates[i]);
    date.setHours(0, 0, 0, 0);

    const expectedDate = new Date(today);
    expectedDate.setDate(expectedDate.getDate() - i);

    if (i === 0) {
      const daysDiff = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 1) break;
    }

    if (date.getTime() === expectedDate.getTime() || (i === 0 && date.getTime() === expectedDate.getTime() - 86400000)) {
      currentStreak++;
    } else if (i > 0) {
      break;
    }
  }

  let longestStreak = 0;
  let tempStreak = 1;

  for (let i = 1; i < uniqueDates.length; i++) {
    const prevDate = new Date(uniqueDates[i - 1]);
    const currDate = new Date(uniqueDates[i]);
    const daysDiff = Math.floor((prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff === 1) {
      tempStreak++;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak, currentStreak);

  return { currentStreak, longestStreak, totalWorkouts: completions.length };
}

async function getMetrics(userId: string, metricName?: string, daysBack: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  if (metricName) {
    const metric = await prisma.metricDefinition.findUnique({
      where: { userId_name: { userId, name: metricName } },
      include: {
        values: {
          where: { recordedDate: { gte: startDate } },
          orderBy: { recordedDate: 'desc' },
        },
      },
    });
    return { metric };
  }

  const metrics = await prisma.metricDefinition.findMany({
    where: { userId },
    include: {
      values: {
        where: { recordedDate: { gte: startDate } },
        orderBy: { recordedDate: 'desc' },
      },
    },
  });

  return { metrics };
}

async function getMilestones(userId: string, includeCompleted: boolean) {
  const milestones = await prisma.milestone.findMany({
    where: {
      userId,
      ...(includeCompleted ? {} : { completed: false }),
    },
    orderBy: [{ completed: 'asc' }, { createdAt: 'desc' }],
  });

  return { milestones };
}

// WRITE TOOL IMPLEMENTATIONS

async function updateProfile(userId: string, input: any) {
  const profile = await prisma.userProfile.upsert({
    where: { userId },
    update: {
      ...(input.primary_goal_summary !== undefined && { primaryGoalSummary: input.primary_goal_summary }),
      ...(input.goal_type !== undefined && { goalType: input.goal_type }),
      ...(input.target_date !== undefined && { targetDate: input.target_date ? new Date(input.target_date) : null }),
      ...(input.constraints !== undefined && { constraints: JSON.stringify(input.constraints) }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
    create: {
      userId,
      primaryGoalSummary: input.primary_goal_summary,
      goalType: input.goal_type || 'general',
      targetDate: input.target_date ? new Date(input.target_date) : null,
      constraints: input.constraints ? JSON.stringify(input.constraints) : null,
      notes: input.notes,
    },
  });

  return { success: true, profile };
}

async function updateWorkout(userId: string, input: any) {
  const workout = await prisma.workoutTemplate.upsert({
    where: { userId_dayOfWeek: { userId, dayOfWeek: input.day_of_week } },
    update: {
      name: input.name,
      ...(input.description !== undefined && { description: input.description }),
      ...(input.is_active !== undefined && { isActive: input.is_active }),
    },
    create: {
      userId,
      dayOfWeek: input.day_of_week,
      name: input.name,
      description: input.description,
      isActive: input.is_active ?? true,
    },
    include: { exercises: { orderBy: { sortOrder: 'asc' } } },
  });

  return { success: true, workout };
}

async function addExercise(userId: string, input: any) {
  let workout = await prisma.workoutTemplate.findUnique({
    where: { userId_dayOfWeek: { userId, dayOfWeek: input.day_of_week } },
  });

  if (!workout) {
    return { error: 'Workout template not found for this day. Create the workout first.' };
  }

  const maxSort = await prisma.workoutExercise.aggregate({
    where: { workoutTemplateId: workout.id },
    _max: { sortOrder: true },
  });

  const exercise = await prisma.workoutExercise.create({
    data: {
      workoutTemplateId: workout.id,
      name: input.name,
      sets: input.sets,
      reps: input.reps,
      duration: input.duration,
      notes: input.notes,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });

  return { success: true, exercise };
}

async function removeExercise(userId: string, input: any) {
  const workout = await prisma.workoutTemplate.findUnique({
    where: { userId_dayOfWeek: { userId, dayOfWeek: input.day_of_week } },
  });

  if (!workout) {
    return { error: 'Workout not found for this day' };
  }

  const deleted = await prisma.workoutExercise.deleteMany({
    where: {
      workoutTemplateId: workout.id,
      name: input.exercise_name,
    },
  });

  return { success: true, deletedCount: deleted.count };
}

async function updateExerciseDetail(userId: string, input: any) {
  const exercise = await prisma.exerciseDetail.upsert({
    where: { userId_name: { userId, name: input.name } },
    update: {
      ...(input.description !== undefined && { description: input.description }),
      ...(input.focus_points !== undefined && { focusPoints: JSON.stringify(input.focus_points) }),
      ...(input.equipment_needed !== undefined && { equipmentNeeded: JSON.stringify(input.equipment_needed) }),
      ...(input.modifications !== undefined && { modifications: JSON.stringify(input.modifications) }),
    },
    create: {
      userId,
      name: input.name,
      description: input.description,
      focusPoints: input.focus_points ? JSON.stringify(input.focus_points) : null,
      equipmentNeeded: input.equipment_needed ? JSON.stringify(input.equipment_needed) : null,
      modifications: input.modifications ? JSON.stringify(input.modifications) : null,
    },
  });

  return { success: true, exercise };
}

async function markComplete(userId: string, input: any) {
  const date = input.date ? new Date(input.date) : new Date();
  date.setHours(0, 0, 0, 0);

  try {
    const completion = await prisma.workoutCompletion.create({
      data: {
        userId,
        workoutName: input.workout_name,
        completedDate: date,
        notes: input.notes,
        duration: input.duration_minutes,
        rating: input.rating,
      },
    });

    return { success: true, completion };
  } catch (error: any) {
    if (error.code === 'P2002') {
      return { error: 'This workout is already marked complete for this date' };
    }
    throw error;
  }
}

async function logMetric(userId: string, input: any) {
  let metric = await prisma.metricDefinition.findUnique({
    where: { userId_name: { userId, name: input.metric_name } },
  });

  if (!metric) {
    metric = await prisma.metricDefinition.create({
      data: { userId, name: input.metric_name, unit: input.unit },
    });
  }

  const date = input.date ? new Date(input.date) : new Date();

  const value = await prisma.metricValue.create({
    data: {
      metricDefinitionId: metric.id,
      value: input.value,
      recordedDate: date,
      notes: input.notes,
    },
  });

  return { success: true, metric, value };
}

async function createMilestone(userId: string, input: any) {
  const milestone = await prisma.milestone.create({
    data: {
      userId,
      title: input.title,
      description: input.description,
      targetDate: input.target_date ? new Date(input.target_date) : null,
    },
  });

  return { success: true, milestone };
}

async function completeMilestone(userId: string, input: any) {
  const milestone = await prisma.milestone.findFirst({
    where: { userId, title: input.title, completed: false },
  });

  if (!milestone) {
    return { error: 'Active milestone with this title not found' };
  }

  const updated = await prisma.milestone.update({
    where: { id: milestone.id },
    data: { completed: true, completedAt: new Date() },
  });

  return { success: true, milestone: updated };
}
