type Events =
  | 'bills_group_toggle'
  | 'bulk_action_apply'
  | 'wages_edited'
  | 'electricity_uploaded'
  | 'forecast_run'
  | 'what_if_run'
  | 'standing_orders_exported';

export function track(event: Events, payload?: Record<string, any>) {
  try {
    // Placeholder analytics: log to console; integrate with your vendor later
    console.info('[analytics]', event, payload || {});
  } catch {}
}

