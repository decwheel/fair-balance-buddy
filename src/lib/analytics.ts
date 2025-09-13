type Events =
  | 'bills_group_toggle'
  | 'bulk_action_apply'
  | 'wages_edited'
  | 'electricity_uploaded'
  | 'forecast_run'
  | 'what_if_run'
  | 'standing_orders_exported'
  | 'bank_link_started'
  | 'bank_link_success'
  | 'wages_sheet_opened'
  | 'wages_confirmed'
  | 'link_flow_completed';

export function track(event: Events, payload?: Record<string, any>) {
  try {
    // Placeholder analytics: log to console; integrate with your vendor later
    console.info('[analytics]', event, payload || {});
  } catch {}
}

