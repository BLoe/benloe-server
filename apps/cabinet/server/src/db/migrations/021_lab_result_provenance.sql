-- Lab results that can represent what labs actually report (2026-08-02).
--
-- lab_result was built assuming every analyte is a number: `value REAL`, plus
-- ref_low/ref_high to derive a flag. Ingesting a real full-spectrum panel
-- (100+ markers from a consumer lab) broke that assumption in three ways.
--
-- NOTE: this repo is PUBLIC. The rationale below is deliberately written with
-- invented illustrative values — never with results from the actual panel that
-- prompted it. Real results live only in the database and in the gitignored
-- data/ tree. A migration comment is still a published document.
--
-- ## 1. value_text — a large share of real results are not numbers
-- Roughly a fifth of markers on a broad panel cannot be stored as a REAL
-- without destroying them:
--   * Censored values at an assay's detection limit: "<10 nmol/L",
--     "<1.0 mcg/dL", "<2 IU/mL".
--   * Qualitative results: "Negative", "None Seen", "Clear", "Yellow",
--     blood group "O", "Rh(d) Positive", LDL pattern "A".
-- Coercing "<10" to the number 10 is the dangerous option, not the lossy one.
-- A below-detection result and a measured value sitting exactly at the
-- detection threshold mean opposite things clinically, and for the
-- genetically-fixed cardiac markers that difference is the whole signal.
-- Results get stored as what the lab actually said.
--
-- ## 2. flag comes from the lab, not from recomputation
-- Consumer panels routinely report a per-marker verdict ("In Range" / "Above
-- Range" / "Below Range" / "Error") while publishing NO numeric reference
-- interval in the patient export. logLab() derived flag by comparing value
-- against ref_low/ref_high — with both NULL that derivation returns null for
-- every marker, silently rendering an entire abnormal panel as normal. That
-- is the most expensive false negative this table can produce.
-- Inventing plausible reference ranges to make the derivation work would be
-- exactly the hardcoded-denominator failure already on the books: a number
-- nobody set, wearing the face of a measurement. The lab's own classification
-- IS the datum. ref_low/ref_high stay NULL and honest.
--
-- ## 3. date_precision — draw dates are often known only to the month
-- Exports frequently carry an export timestamp and no collection date, leaving
-- the month recoverable from memory and the day not. drawn_on is NOT NULL, so
-- something must go there. Writing a placeholder day and *remembering* that it
-- is approximate is how a guess becomes a fact three sessions later — so the
-- imprecision lives in the row, next to the date, where any future trend
-- calculation has to confront it.
-- 'day' = exact. 'month' = the day component is a placeholder; compare months,
-- not days. NULL on legacy rows means unknown provenance.
--
-- document_id ties each result back to its source file, so "where did this
-- number come from" is answerable without trusting a chat transcript.

ALTER TABLE lab_result ADD COLUMN value_text TEXT;
ALTER TABLE lab_result ADD COLUMN date_precision TEXT CHECK(date_precision IN ('day','month'));
ALTER TABLE lab_result ADD COLUMN document_id INTEGER REFERENCES document(id);
ALTER TABLE lab_result ADD COLUMN source TEXT;

-- Same panel re-imported twice would otherwise silently double every marker,
-- and a duplicated lab value is indistinguishable from a real repeat draw.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_unique ON lab_result(drawn_on, analyte, COALESCE(panel,''));

-- Documents need enough identity to answer "is this the file I already
-- ingested?" without re-reading it, and a place to record that a file is
-- deliberately outside the git repo.
ALTER TABLE document ADD COLUMN sha256 TEXT;
ALTER TABLE document ADD COLUMN bytes INTEGER;
ALTER TABLE document ADD COLUMN doc_date TEXT;
ALTER TABLE document ADD COLUMN notes TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_path ON document(file_path);
