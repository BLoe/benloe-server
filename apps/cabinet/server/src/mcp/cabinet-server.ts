import { EventEmitter } from 'node:events';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { queryReadonly, QueryGuardError } from '../db/index.js';
import type { Embedder } from '../embeddings/index.js';
import type { EpisodicStore } from '../episodic/index.js';
import { logRetrieval } from '../episodic/retrieval-log.js';
import type { MemoryStore } from '../memory/index.js';
import type { ApprovalQueue } from '../tiers/approvals.js';
import { addLesson, promotableLessons, promoteLesson, recallLessons, retireLesson } from '../memory/lessons.js';
import { dailyTotals, logFood, updatePantry, addRecipe, decrementPantryFor } from '../domains/food.js';
import { planMeal, listMealPlan, updatePlanEntry, removePlanEntry, consumePlanEntry } from '../domains/mealplan.js';
import { generateShoppingList, listGroceryList } from '../domains/shopping.js';
import { planActivity, listActivityPlan, updateActivityEntry, removeActivityEntry, seedTrainerAnchors } from '../domains/activity.js';
import { logBodyMetric, logWorkout } from '../domains/training.js';
import { accumulators as claimAccumulators, logClaim, logHsaContribution, logLab, logMedication, seedInsurancePlan } from '../domains/healthcare.js';
import {
  addJournal, addPriceWatch, importTransactionsCsv, listConstraints, logMood,
  upsertConstraint, upsertContact, upsertGoal, upsertTask,
} from '../domains/misc.js';
import { truncateForModel } from '../runtime/toolTruncate.js';

export interface CabinetToolContext {
  db: Database.Database;
  readonlyDb: Database.Database;
  episodic: EpisodicStore;
  embedder: Embedder;
  memory: MemoryStore;
  approvals: ApprovalQueue;
  /** render_widget / proactive cards flow to the gateway through this bus. */
  widgetBus: EventEmitter;
}

// Step 3 (2026-07-16, token-cost work w/ benji): source-truncate large MCP
// tool payloads the same way the PostToolUse hook truncates built-in
// Bash/Read results (see runtime/toolTruncate.ts) — a uniform backstop
// across all mcp__cabinet__* tools rather than special-casing the handful
// (search_episodic, search_documents, query_db) that can return big results.
const ok = (data: unknown) => {
  const { text } = truncateForModel(JSON.stringify(data), 'tool result');
  return { content: [{ type: 'text' as const, text }] };
};
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: `ERROR: ${message}` }], isError: true });

export const WIDGET_TYPES = ['macro-ring', 'weight-chart', 'briefing', 'grocery', 'checkin', 'diff', 'usage'] as const;

/** Every mcp__cabinet__* tool is Tier 4 by design — writes go to Cabinet's own data. */
export function buildCabinetTools(ctx: CabinetToolContext) {
  return [
    tool(
      'log_food',
      'Log a food/meal entry with estimated macros. Returns running daily totals. Always include your confidence.',
      {
        description: z.string(),
        meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
        kcal: z.number().optional(),
        protein_g: z.number().optional(),
        carbs_g: z.number().optional(),
        fat_g: z.number().optional(),
        fiber_g: z.number().optional(),
        confidence: z.enum(['high', 'medium', 'low']).optional(),
        source: z.enum(['text', 'photo', 'recipe', 'restaurant']).optional(),
      },
      async (args) => ok(logFood(ctx.db, args)),
    ),
    tool(
      'log_workout',
      "Log a workout with sets. Flags PRs against history. localDay backdates it (defaults to now) — e.g. logging a session you forgot to record yesterday.",
      {
        name: z.string().optional(),
        notes: z.string().optional(),
        rpe_session: z.number().optional(),
        sets: z.array(
          z.object({
            exercise: z.string(),
            reps: z.number().optional(),
            weight_lb: z.number().optional(),
            rpe: z.number().optional(),
          }),
        ),
        localDay: z.string().optional(),
      },
      async ({ localDay, ...args }) =>
        ok(logWorkout(ctx.db, { ...args, when: localDay ? new Date(`${localDay}T12:00:00Z`) : undefined })),
    ),
    tool(
      'plan_activity',
      "Add a planned activity to the activity plan (a date range of entries — there is no separate \"plan\" object, mirrors the meal plan). kind='rest' is a legitimate planned entry, not an absence.",
      {
        localDay: z.string(),
        kind: z.enum(['strength', 'cardio', 'mobility', 'sport', 'rest']),
        title: z.string().optional(),
        notes: z.string().optional(),
        isAnchor: z.boolean().optional(),
        status: z.enum(['planned', 'done', 'skipped']).optional(),
      },
      async (args) => ok({ id: planActivity(ctx.db, args) }),
    ),
    tool(
      'list_activity_plan',
      'List planned activity in [fromDay, toDay] (inclusive), ordered by day then kind (strength<cardio<mobility<sport<rest), with the linked workout name once performed.',
      { fromDay: z.string(), toDay: z.string() },
      async ({ fromDay, toDay }) => ok({ entries: listActivityPlan(ctx.db, { fromDay, toDay }) }),
    ),
    tool(
      'update_activity_entry',
      "Patch an activity-plan entry — mark it 'done' or 'skipped', attach the workoutId once logged, or adjust kind/title/notes.",
      {
        id: z.number(),
        kind: z.enum(['strength', 'cardio', 'mobility', 'sport', 'rest']).optional(),
        title: z.string().optional(),
        notes: z.string().optional(),
        status: z.enum(['planned', 'done', 'skipped']).optional(),
        workoutId: z.number().optional(),
      },
      async ({ id, ...patch }) => ok(updateActivityEntry(ctx.db, id, patch)),
    ),
    tool(
      'remove_activity_entry',
      'Delete an activity-plan entry outright (e.g. the plan changed before anything was done).',
      { id: z.number() },
      async ({ id }) => ok(removeActivityEntry(ctx.db, id)),
    ),
    tool(
      'seed_trainer_anchors',
      'Top up the fixed trainer-session anchors (Tue/Thu strength, is_anchor=1) into the activity plan for the next N weeks. Idempotent — safe to call repeatedly, never duplicates a day that already has one.',
      { weeks: z.number().optional() },
      async ({ weeks }) => ok(seedTrainerAnchors(ctx.db, { weeks })),
    ),
    tool(
      'log_body_metric',
      'Log a body metric (weight_lb, bodyfat_pct, ...). Weight returns the EWMA trend.',
      { metric: z.string(), value: z.number() },
      async (args) => ok(logBodyMetric(ctx.db, args)),
    ),
    tool(
      'log_mood',
      'Log a 1-5 mood/energy/stress check-in.',
      {
        mood: z.number().int().min(1).max(5).optional(),
        energy: z.number().int().min(1).max(5).optional(),
        stress: z.number().int().min(1).max(5).optional(),
        note: z.string().optional(),
      },
      async (args) => ok({ id: logMood(ctx.db, args) }),
    ),
    tool(
      'add_journal',
      'Append a free-form journal entry (embedded for later semantic recall).',
      { body: z.string().min(1) },
      async ({ body }) => {
        const id = addJournal(ctx.db, body);
        try {
          await ctx.episodic.indexText(ctx.embedder, 'journal', `journal:${id}`, null, body);
          ctx.db.prepare('UPDATE journal_entry SET embedded = 1 WHERE id = ?').run(id);
        } catch (err) {
          // Embedder down or crashed mid-embed: leave embedded=0, the nightly
          // backfill (jobs.ts, §14) will retry. Must not fail silently — this
          // warn is the only signal anyone gets before that backfill runs.
          console.warn(`add_journal: embed failed for journal_entry id=${id}: ${(err as Error).message}`);
        }
        return ok({ id });
      },
    ),
    tool(
      'log_claim',
      'Log an insurance claim/EOB. Returns updated deductible/OOP accumulators.',
      {
        service_date: z.string().optional(),
        provider: z.string().optional(),
        description: z.string().optional(),
        billed: z.number().optional(),
        allowed: z.number().optional(),
        plan_paid: z.number().optional(),
        patient_owed: z.number().optional(),
        applied_to_deductible: z.number().optional(),
        applied_to_oop: z.number().optional(),
        status: z.enum(['submitted', 'processed', 'paid', 'denied', 'appeal']).optional(),
      },
      async (args) => ok(logClaim(ctx.db, { planId: seedInsurancePlan(ctx.db), ...args })),
    ),
    tool(
      'log_lab',
      'Log a lab result; flags out-of-range values.',
      {
        drawn_on: z.string(),
        panel: z.string().optional(),
        analyte: z.string(),
        value: z.number().optional(),
        unit: z.string().optional(),
        ref_low: z.number().optional(),
        ref_high: z.number().optional(),
      },
      async (args) => ok(logLab(ctx.db, args)),
    ),
    tool(
      'log_medication',
      'Add a medication/supplement with schedule and supply for refill nudges.',
      {
        name: z.string(),
        dose: z.string().optional(),
        schedule: z.string().optional(),
        is_supplement: z.boolean().optional(),
        days_supply: z.number().optional(),
        last_filled_on: z.string().optional(),
        refills_left: z.number().optional(),
      },
      async (args) => ok({ id: logMedication(ctx.db, args) }),
    ),
    tool(
      'log_hsa_contribution',
      'Record an HSA contribution; returns YTD vs IRS limit headroom.',
      { amount: z.number(), taxYear: z.number().int(), source: z.enum(['payroll', 'manual']).optional() },
      async (args) => ok(logHsaContribution(ctx.db, args)),
    ),
    tool(
      'import_transactions_csv',
      'Import transactions from CSV text (date,amount,merchant[,category]). Idempotent.',
      { csv: z.string(), account_id: z.number().optional() },
      async ({ csv, account_id }) => ok(importTransactionsCsv(ctx.db, csv, account_id ?? null)),
    ),
    tool(
      'update_pantry',
      'Upsert a pantry item; use quantityDelta when consuming or restocking.',
      {
        name: z.string(),
        location: z.enum(['pantry', 'fridge', 'freezer']).optional(),
        quantity: z.number().optional(),
        quantityDelta: z.number().optional(),
        unit: z.string().optional(),
        expires_on: z.string().optional(),
        is_staple: z.boolean().optional(),
      },
      async (args) => ok(updatePantry(ctx.db, args)),
    ),
    tool(
      'decrement_pantry_for',
      "Decrement a pantry item by (quantity, unit), converting into the pantry row's own stored unit first — for ad-hoc food-from-stock ('I ate 200ml of milk' against a pantry row stored in litres) without doing the unit math yourself. Never guesses: no matching row, no recorded unit, or an unconvertible unit returns a reason and leaves the row untouched. For a plain add/subtract already in the pantry row's own unit, use update_pantry's quantityDelta instead.",
      { name: z.string(), quantity: z.number(), unit: z.string() },
      async (args) => ok(decrementPantryFor(ctx.db, args)),
    ),
    tool(
      'add_recipe',
      'Save a recipe with per-serving macros and ingredients.',
      {
        title: z.string(),
        instructions: z.string().optional(),
        servings: z.number().optional(),
        kcal_per_serving: z.number().optional(),
        protein_g: z.number().optional(),
        carbs_g: z.number().optional(),
        fat_g: z.number().optional(),
        tags: z.array(z.string()).optional(),
        ingredients: z.array(z.object({ name: z.string(), quantity: z.number().optional(), unit: z.string().optional() })).optional(),
      },
      async (args) => ok({ id: addRecipe(ctx.db, args) }),
    ),
    tool(
      'plan_meal',
      'Add a planned meal to the meal plan (a date range of entries — there is no separate "plan" object). Exactly one of recipeId or adHocDescription.',
      {
        localDay: z.string(),
        meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
        recipeId: z.number().optional(),
        adHocDescription: z.string().optional(),
        servings: z.number().optional(),
      },
      async (args) => ok({ id: planMeal(ctx.db, args) }),
    ),
    tool(
      'list_meal_plan',
      'List planned meals in [fromDay, toDay] (inclusive), ordered by day then meal slot, with joined recipe title + per-serving macros.',
      { fromDay: z.string(), toDay: z.string() },
      async ({ fromDay, toDay }) => ok({ entries: listMealPlan(ctx.db, { fromDay, toDay }) }),
    ),
    tool(
      'update_plan_entry',
      "Patch a meal-plan entry — mark it 'eaten' or 'skipped', adjust servings, or move its meal slot.",
      {
        id: z.number(),
        servings: z.number().optional(),
        status: z.enum(['planned', 'eaten', 'skipped']).optional(),
        meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
      },
      async ({ id, ...patch }) => ok(updatePlanEntry(ctx.db, id, patch)),
    ),
    tool(
      'remove_plan_entry',
      'Delete a meal-plan entry outright (e.g. the plan changed before anything was eaten).',
      { id: z.number() },
      async ({ id }) => ok(removePlanEntry(ctx.db, id)),
    ),
    tool(
      'consume_plan_entry',
      "Consume a planned meal: log the food entry, decrement matching pantry stock (unit-converted), and mark it 'eaten' — atomically, so a failure never leaves food logged without the pantry decremented or vice versa. Calling this twice on the same entry is a safe no-op (alreadyEaten). Ingredients that can't be auto-decremented (no pantry match, no density, unit mismatch) come back in notDecremented, not a guess.",
      { entryId: z.number(), localDay: z.string().optional() },
      async ({ entryId, localDay }) => ok(consumePlanEntry(ctx.db, entryId, { localDay })),
    ),
    tool(
      'generate_shopping_list',
      "Compute meal-plan ingredient requirements over [fromDay, toDay] minus current pantry stock, and REPLACE the plan-derived rows in the grocery list with the shortfalls ('staple'/'manual' rows are untouched). Never guesses across unit families — anything it can't cleanly convert (missing density, count-unit mismatch, ...) comes back in needsReview instead of a wrong number.",
      { fromDay: z.string(), toDay: z.string() },
      async ({ fromDay, toDay }) => ok(generateShoppingList(ctx.db, { fromDay, toDay })),
    ),
    tool(
      'list_grocery_list',
      'List the full grocery list (mealplan-derived + staple + manual rows), ordered by source then name.',
      {},
      async () => ok({ items: listGroceryList(ctx.db) }),
    ),
    tool(
      'upsert_task',
      'Create or update a task/reminder (recur_rule for recurring maintenance).',
      {
        id: z.number().optional(),
        title: z.string(),
        notes: z.string().optional(),
        domain: z.string().optional(),
        due_on: z.string().optional(),
        recur_rule: z.string().optional(),
        priority: z.number().optional(),
        status: z.enum(['open', 'done', 'snoozed', 'cancelled']).optional(),
      },
      async (args) => ok({ id: upsertTask(ctx.db, args) }),
    ),
    tool(
      'upsert_contact',
      'Create or update a contact (birthday, keep-in-touch cadence, gift ideas).',
      {
        name: z.string(),
        relationship: z.string().optional(),
        birthday: z.string().optional(),
        keep_in_touch_days: z.number().optional(),
        last_contacted_on: z.string().optional(),
        gift_ideas: z.string().optional(),
        notes: z.string().optional(),
      },
      async (args) => ok({ id: upsertContact(ctx.db, args) }),
    ),
    tool(
      'upsert_goal',
      'Set a structured, measurable goal (target_value+unit and/or cadence) — the number a Vitals dial tracks against, e.g. "protein >= 185 g/day". ' +
        'Matches an existing goal by (domain, title) exact match and supersedes it (old row kept, deactivated — full history preserved) rather than overwriting. ' +
        'For narrative/qualitative goals ("get back to consistent lifting after the injury"), use update_memory on GOALS.md instead — this tool is for numbers a dial can compare against, not prose.',
      {
        domain: z.string(),
        title: z.string(),
        target_value: z.number().optional(),
        unit: z.string().optional(),
        cadence: z.string().optional(),
      },
      async (args) => {
        try {
          return ok(upsertGoal(ctx.db, args));
        } catch (err) {
          return fail((err as Error).message);
        }
      },
    ),
    tool(
      'upsert_constraint',
      'Record a HARD planning constraint — an allergen/substance to never suggest (kind: dietary) or a movement/load to never program (kind: physical). ' +
        'This is for machine-durable safety gates, NOT soft preferences — "dislikes cilantro" or "wants to get back to heavy lifting eventually" belongs in ' +
        'update_memory on domains/nutrition.md or domains/health.md instead (narrative, fine to lose nuance in a rewrite). A hard constraint is not. ' +
        'Two ways to call this: (1) give `subject` (+ optional severity/note) to record a real constraint — matches an existing active one for the same ' +
        '(kind, subject) and supersedes it, full history preserved. (2) pass confirmedNone: true (no subject) after explicitly asking and confirming Ben has ' +
        'no constraints of that kind — idempotent, and distinguishable from never having asked at all via list_constraints.',
      {
        kind: z.enum(['dietary', 'physical']),
        subject: z.string().optional(),
        severity: z.string().optional(),
        note: z.string().optional(),
        confirmedNone: z.boolean().optional(),
        source: z.string().optional(),
      },
      async (args) => {
        try {
          return ok(upsertConstraint(ctx.db, args));
        } catch (err) {
          return fail((err as Error).message);
        }
      },
    ),
    tool(
      'list_constraints',
      'List active hard constraints (dietary and/or physical) — what a plan must respect. Omit kind for both. Reading this is how you tell apart three ' +
        'states: no rows for a kind = never asked; one row with is_none_confirmation=true = asked, confirmed none; rows with real subjects = must-respect constraints.',
      { kind: z.enum(['dietary', 'physical']).optional() },
      async ({ kind }) => ok(listConstraints(ctx.db, kind)),
    ),
    tool(
      'add_price_watch',
      'Watch an item/URL for a target price.',
      { item: z.string(), url: z.string().optional(), target_price: z.number().optional() },
      async (args) => ok({ id: addPriceWatch(ctx.db, args) }),
    ),
    tool(
      'query_db',
      'Run a read-only SELECT against cabinet.db (all quantified-self data). The workhorse for totals, trends, and accumulators.',
      { sql: z.string(), params: z.array(z.union([z.string(), z.number(), z.null()])).optional() },
      async ({ sql, params }) => {
        try {
          return ok(queryReadonly(ctx.readonlyDb, sql, params ?? []));
        } catch (err) {
          if (err instanceof QueryGuardError) return fail(err.message);
          throw err;
        }
      },
    ),
    tool(
      'search_episodic',
      'Semantic recall over past conversations, journals, and documents.',
      { query: z.string(), kind: z.enum(['conversation', 'journal', 'document']).optional(), k: z.number().int().max(20).optional() },
      async ({ query, kind, k }) => {
        const [v] = await ctx.embedder.embed([query]);
        const kEff = k ?? 6;
        const hits = ctx.episodic.searchChunks(v!, kEff, kind);
        logRetrieval(ctx.db, {
          caller: 'search_episodic',
          queryText: query,
          k: kEff,
          results: hits.map((h) => ({ id: h.id, distance: h.distance, kind: h.kind })),
        });
        return ok(hits);
      },
    ),
    tool(
      'search_documents',
      'RAG over the document vault (uploaded PDFs: insurance SPD, lease, tax docs).',
      { query: z.string(), k: z.number().int().max(20).optional() },
      async ({ query, k }) => {
        const [v] = await ctx.embedder.embed([query]);
        const kEff = k ?? 6;
        const hits = ctx.episodic.searchChunks(v!, kEff, 'document');
        logRetrieval(ctx.db, {
          caller: 'search_documents',
          queryText: query,
          k: kEff,
          results: hits.map((h) => ({ id: h.id, distance: h.distance, kind: h.kind })),
        });
        return ok(hits);
      },
    ),
    tool(
      'recall_lessons',
      'Recall the most relevant active lessons for the current context.',
      { context: z.string(), k: z.number().int().max(10).optional() },
      async ({ context, k }) => ok(await recallLessons(ctx.episodic, ctx.embedder, context, k ?? 4, ctx.db)),
    ),
    tool(
      'add_lesson',
      'Store a governed lesson (needs evidence + confidence >= 0.6; autonomy escalations are rejected).',
      { text: z.string(), domain: z.string().nullable().optional(), evidence: z.string(), confidence: z.number().min(0).max(1) },
      async (args) => {
        const res = await addLesson(ctx.episodic, ctx.embedder, { ...args, domain: args.domain ?? null });
        return 'rejected' in res ? fail(res.rejected) : ok(res);
      },
    ),
    tool(
      'retire_lesson',
      'Retire (or mark superseded) a lesson that proved wrong or stale.',
      { id: z.number().int(), superseded: z.boolean().optional() },
      async ({ id, superseded }) => {
        retireLesson(ctx.episodic, id, superseded ?? false);
        return ok({ id, status: superseded ? 'superseded' : 'retired' });
      },
    ),
    tool(
      'list_promotable_lessons',
      'List active lessons proven durable enough to graduate into always-on memory (confidence, times_applied, and age all past threshold — see promotableLessons).',
      {},
      async () => ok(promotableLessons(ctx.episodic)),
    ),
    tool(
      'promote_lesson',
      "Mark a lesson graduated after you've written its content into a memory file (PREFERENCES.md/PLATFORM.md). Excludes it from all future recall — call this only after the update_memory write succeeds, not before.",
      { id: z.number().int() },
      async ({ id }) => {
        promoteLesson(ctx.episodic, id);
        return ok({ id, status: 'promoted' });
      },
    ),
    tool(
      'update_memory',
      'Rewrite a curated memory file (GOALS.md, PREFERENCES.md, domains/*.md, ...). Git-committed. STANDING_ORDERS.md is Ben-only.',
      { file: z.string(), content: z.string(), reason: z.string() },
      async ({ file, content, reason }) => {
        try {
          ctx.memory.update(file, content, reason);
          return ok({ file, committed: true });
        } catch (err) {
          // Every refusal (STANDING_ORDERS, path traversal, the drift guard)
          // is worth a paper trail — this is the only place that learns
          // update_memory was called AND failed. The tier-gate's own audit
          // row (tiers/gate.ts) only records that the call was allowed to
          // run at Tier 4, not what happened once it did.
          const message = (err as Error).message;
          ctx.db
            .prepare("INSERT INTO action_audit (tool, decision, args, result) VALUES ('update_memory', 'REFUSED', ?, ?)")
            .run(JSON.stringify({ file }).slice(0, 4000), message.slice(0, 4000));
          return fail(message);
        }
      },
    ),
    tool(
      'render_widget',
      'Render a rich card inline in the chat (macro-ring, weight-chart, briefing, grocery, checkin, diff, usage).',
      { widgetType: z.enum(WIDGET_TYPES), data: z.record(z.string(), z.unknown()) },
      async ({ widgetType, data }) => {
        ctx.widgetBus.emit('widget', { widgetType, data });
        return ok({ rendered: widgetType });
      },
    ),
    tool(
      'enqueue_approval',
      'Proactively propose a Tier-2 action for Ben to approve (returns the packet id; do NOT wait).',
      {
        action: z.string(),
        payload: z.string(),
        reasoning: z.string(),
        confidence: z.number().min(0).max(1).optional(),
        reversibility: z.string().optional(),
      },
      async (args) => {
        const { id } = ctx.approvals.enqueue({
          tier: 2,
          action: args.action,
          payload: args.payload,
          reasoning: args.reasoning,
          confidence: args.confidence ?? null,
          reversibility: args.reversibility ?? null,
          chatId: null,
        });
        return ok({ approvalId: id, status: 'pending' });
      },
    ),
  ];
}

export function buildCabinetMcpServer(ctx: CabinetToolContext) {
  return createSdkMcpServer({ name: 'cabinet', version: '1.0.0', tools: buildCabinetTools(ctx) });
}

/** allowedTools entries for the runtime — cabinet tools are the ONLY ungated names (Appendix B). */
export function cabinetAllowedTools(): string[] {
  return buildCabinetTools(dummyCtx()).map((t) => `mcp__cabinet__${(t as { name: string }).name}`);
}

// A throwaway context for name extraction only — handlers are never called on it.
function dummyCtx(): CabinetToolContext {
  return new Proxy({}, { get: () => new Proxy({}, { get: () => () => undefined }) }) as CabinetToolContext;
}
