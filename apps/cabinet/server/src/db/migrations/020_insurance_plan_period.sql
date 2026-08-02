-- Mid-year carrier switches (2026-08-02).
--
-- insurance_plan was written with a one-plan-per-calendar-year assumption:
-- seedInsurancePlan() looks a plan up by `WHERE plan_year = ?` and every
-- accumulator sums claims by plan_id. That held right up until Summus moved
-- PEOs from JustWorks to Extensis mid-2026 and Ben's coverage went Aetna ->
-- Anthem on a calendar-year plan. Now 2026 has TWO plans, each with its own
-- deductible clock, and the year alone no longer identifies one.
--
-- Jamming both carriers into a single row would have been the fast move and
-- it would have produced a number that is wrong in the most dangerous way:
-- an accumulator that silently blends spend under a dead plan with spend
-- under the live one, and reports a deductible as partly met when the payer
-- says $0. A wrong deductible reading is worse than no reading — it is the
-- number you'd use to decide whether a procedure is affordable this year.
--
-- So plans get an effective PERIOD. plan_year stays (nothing needs to break,
-- and it is still the right grouping for tax-year and HSA questions), but
-- the identity of "which plan covers this date of service" is now
-- effective_from/effective_to, and claims attach by service date.
--
-- ## Why the out-of-network columns are separate columns, not a second row
-- INN and OON are not two plans; they are two accumulators inside one plan,
-- and on Ben's Anthem plan they explicitly DO NOT feed each other
-- ("Deductible Cross Accumulation Rule: In Network & Out Of Network Do Not
-- Apply To Each Other"). Modelling OON as its own plan row would make every
-- "which plan is live" lookup ambiguous again. `cross_accumulates` records
-- the rule itself so the reasoning layer never has to assume the common
-- case, which is not Ben's case.
--
-- ## Why claim_filing_limit_days lives here
-- It is a per-plan contractual clock (Anthem: 180 days from date of
-- service) and it is the difference between a reimbursable out-of-network
-- session and a donated one. Storing it on the plan lets a claim's age be
-- checked against the rule that actually governs it rather than a default.
--
-- member_id deliberately does NOT appear in this table. It is PII that would
-- be one `SELECT *` from an agent prompt; it belongs in `credential`
-- (encrypted at rest, key outside the agent's reach). `group_no` is fine —
-- it identifies the employer group, not the person.

ALTER TABLE insurance_plan ADD COLUMN carrier TEXT;
ALTER TABLE insurance_plan ADD COLUMN plan_type TEXT;
ALTER TABLE insurance_plan ADD COLUMN group_no TEXT;
ALTER TABLE insurance_plan ADD COLUMN effective_from TEXT;
ALTER TABLE insurance_plan ADD COLUMN effective_to TEXT;
ALTER TABLE insurance_plan ADD COLUMN oon_deductible_individual REAL;
ALTER TABLE insurance_plan ADD COLUMN oon_oop_max_individual REAL;
ALTER TABLE insurance_plan ADD COLUMN oon_coinsurance_pct REAL;

-- 1 = HSA-qualified HDHP. Drives contribution-headroom math and the
-- last-month-rule question, which is worth real money in a switch year.
ALTER TABLE insurance_plan ADD COLUMN hsa_eligible INTEGER;

-- 1 = INN and OON spend feed each other's accumulators. 0 = they are
-- strictly separate (Ben's Anthem plan). NULL = not yet read off the SPD;
-- callers must not assume.
ALTER TABLE insurance_plan ADD COLUMN cross_accumulates INTEGER;

-- Days from date of service to file a claim. Anthem: 180.
ALTER TABLE insurance_plan ADD COLUMN claim_filing_limit_days INTEGER;

ALTER TABLE insurance_plan ADD COLUMN notes TEXT;

-- Claims need to record WHICH accumulator they hit, because on a
-- no-cross-accumulation plan an out-of-network dollar is worth exactly zero
-- against the in-network deductible. Without this column every claim looks
-- like it counts, which is the single easiest way to overstate progress.
ALTER TABLE claim ADD COLUMN network TEXT CHECK(network IN ('in','out','unknown'));

-- Lets a claim be traced to the carrier that actually adjudicated it even
-- after plan rows are reorganised; also the join-free answer to "what did
-- Aetna pay in 2026".
CREATE INDEX IF NOT EXISTS idx_claim_service_date ON claim(service_date);
CREATE INDEX IF NOT EXISTS idx_insurance_plan_effective ON insurance_plan(effective_from, effective_to);
