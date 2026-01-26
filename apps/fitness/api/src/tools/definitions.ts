export const FITNESS_TOOLS = [
  // READ TOOLS
  {
    name: 'get_user_profile',
    description: "Get the user's fitness profile including goals, constraints, and notes",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_weekly_schedule',
    description: "Get the user's weekly workout schedule with all exercises",
    input_schema: {
      type: 'object',
      properties: {
        day_of_week: {
          type: 'integer',
          description: 'Optional: specific day (0=Sunday, 6=Saturday). If omitted, returns full week.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_exercise_details',
    description: "Get detailed information about exercises in the user's library",
    input_schema: {
      type: 'object',
      properties: {
        exercise_name: {
          type: 'string',
          description: 'Optional: specific exercise name. If omitted, returns all exercises.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_prs',
    description: "Get the user's personal records from the weights tracking system (read-only)",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_completions',
    description: 'Get workout completion history',
    input_schema: {
      type: 'object',
      properties: {
        days_back: {
          type: 'integer',
          description: 'Number of days to look back. Default 30.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_streaks',
    description: 'Get current and longest workout streaks',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_metrics',
    description: 'Get user-defined metrics and their recent values',
    input_schema: {
      type: 'object',
      properties: {
        metric_name: {
          type: 'string',
          description: 'Optional: specific metric name',
        },
        days_back: {
          type: 'integer',
          description: 'Number of days of values to retrieve. Default 30.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_milestones',
    description: "Get user's milestones",
    input_schema: {
      type: 'object',
      properties: {
        include_completed: {
          type: 'boolean',
          description: 'Whether to include completed milestones. Default true.',
        },
      },
      required: [],
    },
  },

  // WRITE TOOLS
  {
    name: 'update_profile',
    description: "Update the user's fitness profile",
    input_schema: {
      type: 'object',
      properties: {
        primary_goal_summary: {
          type: 'string',
          description: "AI-written summary of user's primary fitness goal",
        },
        goal_type: {
          type: 'string',
          enum: ['weight_loss', 'strength', 'sport', 'consistency', 'health', 'general'],
          description: 'Category of fitness goal',
        },
        target_date: {
          type: 'string',
          description: 'Target date in ISO format (YYYY-MM-DD)',
        },
        constraints: {
          type: 'object',
          description: 'Object containing injuries, equipment, schedule, preferences',
        },
        notes: {
          type: 'string',
          description: "Freeform notes about the user's fitness journey",
        },
      },
      required: [],
    },
  },
  {
    name: 'update_workout',
    description: 'Create or update a workout template for a specific day',
    input_schema: {
      type: 'object',
      properties: {
        day_of_week: {
          type: 'integer',
          description: 'Day of week (0=Sunday, 6=Saturday)',
        },
        name: {
          type: 'string',
          description: "Name of the workout (e.g., 'Upper Body Strength')",
        },
        description: {
          type: 'string',
          description: 'Description of the workout',
        },
        is_active: {
          type: 'boolean',
          description: 'Whether this workout is active in the schedule',
        },
      },
      required: ['day_of_week', 'name'],
    },
  },
  {
    name: 'add_exercise',
    description: 'Add an exercise to a workout template',
    input_schema: {
      type: 'object',
      properties: {
        day_of_week: {
          type: 'integer',
          description: 'Day of week for the workout',
        },
        name: {
          type: 'string',
          description: 'Exercise name',
        },
        sets: {
          type: 'integer',
          description: 'Number of sets',
        },
        reps: {
          type: 'string',
          description: "Reps (can be '8-12' or 'AMRAP')",
        },
        duration: {
          type: 'string',
          description: "Duration (e.g., '30 seconds')",
        },
        notes: {
          type: 'string',
          description: 'Notes about the exercise',
        },
      },
      required: ['day_of_week', 'name'],
    },
  },
  {
    name: 'remove_exercise',
    description: 'Remove an exercise from a workout template',
    input_schema: {
      type: 'object',
      properties: {
        day_of_week: {
          type: 'integer',
          description: 'Day of week for the workout',
        },
        exercise_name: {
          type: 'string',
          description: 'Name of the exercise to remove',
        },
      },
      required: ['day_of_week', 'exercise_name'],
    },
  },
  {
    name: 'update_exercise_detail',
    description: 'Create or update an exercise in the exercise library',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Exercise name',
        },
        description: {
          type: 'string',
          description: 'How to perform the exercise',
        },
        focus_points: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key points to focus on',
        },
        equipment_needed: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required equipment',
        },
        modifications: {
          type: 'object',
          description: 'Easier/harder modifications',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'mark_complete',
    description: 'Mark a workout as completed for a specific date',
    input_schema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format. Defaults to today.',
        },
        workout_name: {
          type: 'string',
          description: 'Name of the completed workout',
        },
        notes: {
          type: 'string',
          description: 'Notes about the workout',
        },
        duration_minutes: {
          type: 'integer',
          description: 'How long the workout took',
        },
        rating: {
          type: 'integer',
          description: 'Rating 1-5 of how it went',
        },
      },
      required: ['workout_name'],
    },
  },
  {
    name: 'log_metric',
    description: 'Log a value for a user-defined metric (creates metric if needed)',
    input_schema: {
      type: 'object',
      properties: {
        metric_name: {
          type: 'string',
          description: 'Name of the metric',
        },
        value: {
          type: 'number',
          description: 'The value to log',
        },
        unit: {
          type: 'string',
          description: 'Unit of measurement (only needed when creating new metric)',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format. Defaults to today.',
        },
        notes: {
          type: 'string',
          description: 'Optional notes',
        },
      },
      required: ['metric_name', 'value'],
    },
  },
  {
    name: 'create_milestone',
    description: 'Create a new fitness milestone',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Milestone title',
        },
        description: {
          type: 'string',
          description: 'Detailed description',
        },
        target_date: {
          type: 'string',
          description: 'Target date in YYYY-MM-DD format',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_milestone',
    description: 'Mark a milestone as completed',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the milestone to complete',
        },
      },
      required: ['title'],
    },
  },
];
