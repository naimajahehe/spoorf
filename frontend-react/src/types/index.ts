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
}

export interface SpoofStatus {
    active_sessions: number;
    sessions: Record<string, any>;
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

export interface CAStatus {
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

export type ActivityCategory = 'scan' | 'device' | 'security' | 'traffic' | 'network';
export type ActivityStatus = 'info' | 'success' | 'warning' | 'danger';

export interface ActivityEvent {
    id: string;
    timestamp: number;
    category: ActivityCategory;
    tool: string;               // label subsistem, mis. 'scanner.scan_full', 'arp.spoofer', 'gateway.dns'
    title: string;              // judul manusiawi singkat
    description: string;        // kalimat manusiawi (bukan log terminal mentah)
    status: ActivityStatus;
    detail?: Record<string, string | number | undefined>;
}

export interface ApIsolationInfo {
    is_isolated: boolean;
    confidence: number;
    percentage: number;
    status: 'normal' | 'idle' | 'probable' | 'confirmed';
    reason: string;
    indicators?: {
        gateway_alive: boolean;
        l2_peers_found: number;
        multicast_echo_blocked: boolean;
        l3_hairpinning_confirmed: boolean;
        has_candidates: boolean;
    };
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

export interface SystemCheckNpcap {
    status: 'ok' | 'warning' | 'error';
    installed: boolean;
    service_running: boolean;
    service_state?: string;
    dlls_present?: boolean;
    scapy_bound?: boolean;
    interfaces_count?: number;
    default_iface?: string;
    default_iface_desc?: string;
    details: string;
}

export interface SystemCheckAdapter {
    status: 'ok' | 'warning' | 'error';
    connected: boolean;
    interface?: string;
    interface_type?: string;
    ssid?: string;
    signal?: string;
    ip?: string;
    gateway?: string;
    gateway_reachable?: boolean;
    gateway_latency_ms?: number;
    self_mac?: string;
    details: string;
}

export interface SystemCheckDatabase {
    status: 'ok' | 'warning' | 'error';
    persistent: boolean;
    mode?: string;
    path?: string;
    device_count?: number;
    details: string;
}

export interface SystemDiagnosticsResponse {
    success: boolean;
    status: 'ok' | 'warning' | 'error';
    timestamp?: string;
    elapsed_ms?: number;
    checks: {
        python_engine: {
            status: 'ok' | 'warning' | 'error';
            version?: string;
            pid?: number;
            details: string;
        };
        npcap_driver: SystemCheckNpcap;
        admin_privileges?: {
            status: 'ok' | 'warning';
            is_admin: boolean;
            details: string;
        };
        network_adapter: SystemCheckAdapter;
        database_persistence?: SystemCheckDatabase;
        sentinel_shield?: {
            status: 'ok' | 'warning';
            gateway_immune: boolean;
            self_immune: boolean;
            details: string;
        };
    };
    logs: string[];
}
