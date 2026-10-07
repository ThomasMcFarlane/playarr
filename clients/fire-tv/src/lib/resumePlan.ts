import type {ResumePlan} from '@playarr-tv/api-client';

/** True when Home must show the series as a stacked card and ask there (the web's `isStackedPlan`). */
export function isStackedPlan(plan: ResumePlan | undefined): plan is ResumePlan {
  return plan !== undefined && plan.needs_choice && plan.options.length > 1;
}
