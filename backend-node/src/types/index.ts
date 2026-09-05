export type ProfileStatus = 'high' | 'medium' | 'unknown';

export interface ProfileEvidence {
    source: string;
    group: string;
    field: string;
    value: string;
    strength: 'weak' | 'medium' | 'strong' | 'explicit';
    observed_at: string;
}

export interface ProfileAssessment {
    mac: string;
    ip: string;
    vendor: string;
    device_type: string;
    hostname: string;
    os: string;
    vendor_confidence: number;
    type_confidence: number;
    hostname_confidence: number;
    profile_status: ProfileStatus;
    profile_evidence: ProfileEvidence[];
    profiled_at: string;
    profile_version: number;
}

export interface Device {
    ip: string;
    last_ip?: string;
    mac: string;
    vendor: string;
    hostname: string;
    is_online: boolean;
    is_blocked: boolean;
    is_gateway: boolean;
    is_self?: boolean;
    device_type: string;
    os: string;
    rtt_ms: number;
    open_ports: number[];
    services: string[];
    session_id?: string;
    workgroup?: string;
    user_name?: string;
    web_title?: string;
    web_server?: string;
    ttl?: number;
    is_randomized_mac?: boolean;
    mac_type?: string;
    alias?: string;
    profile_id?: string;
    matched_by?: string;
    linked_macs?: string[];
    speed_limit?: number;
    first_seen?: string;
    last_seen?: string;
    dhcp_fingerprint?: string;
    dhcp_vendor_class?: string;
    dhcp_client_id?: string;
    dhcp_fqdn?: string;
    match_score?: number;
    candidate_profile_id?: string;
    is_archived?: boolean;
    is_redirected?: boolean;
    redirect_url?: string;
    distance_zone?: 'near' | 'medium' | 'far' | 'unknown';
    estimated_range?: string;
    ipv6_link_local?: string;
    ipv6_global?: string;
    ipv6_addresses?: string[];
    is_dual_stack?: boolean;
    profile_status?: ProfileStatus;
    vendor_confidence?: number;
    type_confidence?: number;
    hostname_confidence?: number;
    profile_evidence?: ProfileEvidence[];
    profiled_at?: string;
    profile_version?: number;
}

export interface ProfileRefreshResponse {
    visible_count: number;
    high_confidence_count: number;
    medium_confidence_count: number;
    unknown_count: number;
    hostname_count: number;
    coverage_percentage: number | null;
    sources: Record<string, number>;
    ap_isolation: Record<string, unknown>;
    partial_failures: Array<{ source: string; error: string }>;
    duration_ms: number;
    devices: ProfileAssessment[];
}

export interface ProfileRefreshResult
    extends Omit<ProfileRefreshResponse, 'devices'> {
    success: true;
    devices: Device[];
    cached: boolean;
    cooldown_remaining_ms: number;
}

export interface SpoofSession {
    session_id: string;
    victim_ip: string;
    victim_mac: string;
    gateway_ip: string;
    gateway_mac: string;
    active: boolean;
    started_at: number;
    packets_sent: number;
}

export interface PythonCommand {
    type: 'scan' | 'spoof_start' | 'spoof_stop' | 'spoof_restore' | 'get_status' | 'ping';
    data?: any;
}

export interface PythonResponse {
    event?: string;
    success: boolean;
    error?: string;
    data?: any;
    message?: string;
}

export interface L7Flow {
    id: string;
    timestamp: number;
    client_ip: string;
    client_mac?: string;
    scheme: 'http' | 'https' | 'dns' | 'portal';
    method: string;
    host: string;
    port: number;
    path: string;
    status_code?: number;
    content_type?: string;
    request_size: number;
    response_size: number;
    duration_ms: number;
    is_tls: boolean;
    headers?: Record<string, string>;
    is_blocked: boolean;
    rule_match?: string;
}

export interface CAStatusInfo {
    status: string;
    common_name: string;
    organization: string;
    serial_number: string;
    valid_from: string;
    valid_until: string;
    is_ca: boolean;
    cert_path: string;
    total_cached_leafs: number;
}

export interface L7FlowStats {
    total_flows: number;
    blocked_flows: number;
    https_flows: number;
    http_flows: number;
    dns_flows: number;
}

export interface DnsSpoofRule {
    id: string;
    domain: string;
    target_ip: string;
    action: 'spoof' | 'sinkhole' | 'pass';
    is_enabled: boolean;
    hits: number;
    created_at: number;
}

export interface SniffedCredential {
    id: string;
    timestamp: number;
    client_ip: string;
    server_ip: string;
    protocol: string;
    host: string;
    port: number;
    data_type: 'Credential' | 'Token' | 'Session';
    username?: string;
    password?: string;
    token?: string;
    url?: string;
    raw_snippet?: string;
}

export interface SynPortResult {
    port: number;
    state: 'open' | 'closed' | 'filtered';
    service: string;
    banner?: string;
    rtt_ms: number;
}

export interface SynScanResult {
    target_ip: string;
    total_scanned: number;
    open_count: number;
    scan_duration_sec: number;
    profile: string;
    open_ports: SynPortResult[];
}

export interface BettercapStatus {
    dns_rules_count: number;
    sniffed_credentials_count: number;
    active_gateway_sessions: number;
}

export type LicenseTier = 'free' | 'pro' | 'vip';

export interface UserLicense {
    tier: LicenseTier;
    max_cuts: number;
    can_throttle: boolean;
    can_gateway: boolean;
    can_autoreblock: boolean;
    can_arsenal: boolean;
    can_deep_fingerprint: boolean;
    cloud_sync: boolean;
    expires_at?: string | null;
    grace_period_until?: string | null;
}

export interface AuthUser {
    id: string;
    email: string;
    name: string;
    avatar_url?: string;
    plan: LicenseTier;
    created_at?: string;
}

export interface CachedLicense {
    id?: string;
    user_id?: string;
    email?: string;
    name?: string;
    avatar_url?: string;
    tier: LicenseTier;
    token: string;
    max_cuts: number;
    can_throttle: boolean;
    can_gateway: boolean;
    can_autoreblock: boolean;
    can_arsenal: boolean;
    can_deep_fingerprint?: boolean;
    cloud_sync: boolean;
    expires_at?: string | null;
    grace_period_until?: string | null;
    hwid?: string;
    last_synced_at?: string;
}

export interface AuthStatusResponse {
    isAuthenticated: boolean;
    user: AuthUser | null;
    license: UserLicense;
    isOfflineGracePeriod: boolean;
    hwid: string;
    cloudEndpoint: string;
}



export interface GamingStatus {
    is_enabled: boolean;
    mode: string;
    target_ping_ms: number;
    ping_ms: number;
    jitter_ms: number;
    packet_loss_pct: number;
    uptime_seconds: number;
    timestamp: number;
}

export interface GamingTelemetry {
    ping_ms: number;
    jitter_ms: number;
    packet_loss_pct: number;
    is_optimal: boolean;
    timestamp: number;
}
