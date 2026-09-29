import { describe, expect, it } from 'vitest';
import type { GetUsageResponse } from '@shared/wire/control';
import { windowsFromGetUsage } from './direct-fallback';

const READ_AT = '2026-09-29T08:00:00.000Z';
const response = (rateLimits: unknown): GetUsageResponse => ({
  session: { total_cost_usd: 0, total_api_duration_ms: 0, total_duration_ms: 0, model_usage: {} },
  subscription_type: 'max',
  rate_limits_available: rateLimits !== null,
  rate_limits: rateLimits,
  behaviors: null,
});

describe('direct fallback maps get_usage rate_limits to the status line windows', () => {
  it('maps five_hour, seven_day and model_scoped into the same window shape, stamped with the read time', () => {
    const windows = windowsFromGetUsage(
      response({
        five_hour: { utilization: 41, resets_at: '2026-09-29T10:00:00Z' },
        seven_day: { utilization: 63.4, resets_at: '2026-10-03T15:00:00Z' },
        model_scoped: [{ display_name: 'Fable', utilization: 20, resets_at: '2026-10-03T15:00:00Z' }, { display_name: 'Nil', utilization: null, resets_at: null }],
      }),
      READ_AT,
    );
    expect(windows).toEqual({
      fiveHour: { percent: 41, resetsAt: '2026-09-29T10:00:00Z', recordedAt: READ_AT },
      sevenDay: { percent: 63.4, resetsAt: '2026-10-03T15:00:00Z', recordedAt: READ_AT },
      scoped: [{ model: 'Fable', window: { percent: 20, resetsAt: '2026-10-03T15:00:00Z', recordedAt: READ_AT } }],
    });
  });

  it('a window without utilization or reset time is absent, and no rate limits at all is no reading', () => {
    expect(windowsFromGetUsage(response({ five_hour: null, seven_day: { utilization: null, resets_at: null } }), READ_AT)).toEqual({ fiveHour: null, sevenDay: null, scoped: [] });
    expect(windowsFromGetUsage(response(null), READ_AT)).toBeNull();
    expect(windowsFromGetUsage(response('unexpected'), READ_AT)).toBeNull();
  });
});
