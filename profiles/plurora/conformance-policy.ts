/**
 * Plurora's Definition of Done: the obligations every branch carries in
 * addition to the ones its approved Spec and Plan declare.
 *
 * These sit in the profile rather than in the prompt because a Definition of
 * Done the run could negotiate is not a definition of done. They join the Spec
 * criteria and the Plan tasks in the manifest a conformance reading is scored
 * against, and the reading is refused if it leaves any of them unanswered.
 *
 * Every obligation is written in terms of the harness — stages, evidence,
 * artifacts, the published diff — and names no file, database or model of the
 * deployment it happens to run for. What is being asserted is a property of
 * the run, and a run is the same shape whichever project it certifies.
 *
 * @module profiles/plurora/conformance-policy
 */

import type { ConformanceObligation } from '@trick-harness/contracts'

/** The baseline obligations, declared in the order they enter the manifest. */
const declared: readonly ConformanceObligation[] = [
  {
    id: 'DOD-APPROVED-ARTIFACTS',
    source: 'dod',
    requirement:
      'approved Spec and Plan paths and SHA-256 hashes still match the workflow objective and current files',
    required: true,
  },
  {
    id: 'DOD-DIFF-COHERENCE',
    source: 'dod',
    requirement:
      'the final published diff is coherent and contains no unrelated or stray readiness-affecting artifacts',
    required: true,
  },
  {
    id: 'DOD-FRESH-EVIDENCE',
    source: 'dod',
    requirement: 'all applicable verification gates have fresh evidence for the final implementation state',
    required: true,
  },
  {
    id: 'DOD-NO-MATERIAL-DEFECT',
    source: 'dod',
    requirement: 'no confirmed material defect remains open in the latest certifying stage facts',
    required: true,
  },
  {
    id: 'DOD-APPLICABLE-QA',
    source: 'dod',
    requirement:
      'the latest applicable QA stage passed with required evidence or QA is deterministically not required',
    required: true,
  },
  {
    id: 'DOD-APPLICABLE-SECURITY',
    source: 'dod',
    requirement:
      'the latest applicable security stage passed with required evidence or security review is deterministically not required',
    required: true,
  },
  {
    id: 'DOD-DELIVERY-WORLD',
    source: 'dod',
    requirement:
      'the reviewed branch commit and pull request correspond to the published implementation being certified',
    required: true,
  },
  {
    id: 'DOD-FINAL-VERIFY-READY',
    source: 'dod',
    requirement:
      'all prerequisites are satisfied for a fresh final verification stage to certify the branch after conformance',
    required: true,
  },
]

/** The baseline obligations, frozen through each row so nothing downstream edits them. */
export const pluroraDodObligations: readonly ConformanceObligation[] =
  Object.freeze(declared.map(item => Object.freeze(item)))
