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

export interface Page<T> {
  items: T[];
  total: number;
}

export type EventPage = Page<AttackEvent>;

/** S4 operator auth. `role` gates write endpoints (admin only). */
export interface Operator {
  id: string;
  username: string;
  role: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  operator: Operator;
}

export interface Profile {
  id: string;
  name: string;
  interaction_level: string;
  config: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

/** List view: the API omits `config` from the profiles index. */
export interface ProfileSummary {
  id: string;
  name: string;
  interaction_level: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Derived at read time from `last_seen_at`, never a stored column. */
export type FleetStatus = "online" | "offline" | "never";

export interface HoneypotProfileRef {
  id: string;
  name: string;
  interaction_level: string;
  version: number;
}

export interface Honeypot {
  id: string;
  name: string;
  profile_id: string;
  profile: HoneypotProfileRef;
  config_version: number;
  status: FleetStatus;
  last_seen_at: string | null;
  created_at: string;
}

/** Registration response. `agent_token` is shown once and never retrievable. */
export interface HoneypotRegistered {
  id: string;
  name: string;
  profile_id: string;
  agent_token: string;
}

export interface AuditLog {
  id: number;
  operator_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  created_at: string;
}

export interface EventQuery {
  honeypot_id?: string;
  event_type?: string;
  source_ip?: string;
  q?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface AuditQuery {
  operator_id?: string;
  action?: string;
  resource_type?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}
