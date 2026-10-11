export interface AttackEvent {
  id: string;
  honeypot_id: string;
  event_type: string;
  source_ip: string | null;
  source_port: number | null;
  target_port: number | null;
  protocol: string;
  details: Record<string, unknown>;
  occurred_at: string;
  received_at: string;
}

export interface EventPage {
  items: AttackEvent[];
  total: number;
}