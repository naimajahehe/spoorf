export const refreshDomains = [
    'devices',
    'gatewayStatus',
    'gatewayDnsLogs',
    'caStatus',
    'l7Flows',
    'bettercapDns',
    'credentials',
    'bettercapStatus',
    'gamingStatus',
    'shieldStatus',
    'shieldThreats',
    'wifi',
    'auth'
] as const;

export type RefreshDomain = typeof refreshDomains[number];

export interface RefreshTicket {
    generation: number;
    revision: number;
    domainRevisions: Record<RefreshDomain, number>;
}

export class RefreshSequencer {
    private generation = 0;
    private revision = 0;
    private inFlightGeneration: number | null = null;
    private retryPending = false;
    private readonly domainRevisions: Record<RefreshDomain, number>;

    constructor() {
        this.domainRevisions = Object.fromEntries(
            refreshDomains.map(domain => [domain, 0])
        ) as Record<RefreshDomain, number>;
    }

    startGeneration(): number {
        this.generation += 1;
        this.revision += 1;
        this.inFlightGeneration = null;
        this.retryPending = false;
        return this.generation;
    }

    beginRefresh(expectedGeneration: number = this.generation): RefreshTicket | null {
        if (expectedGeneration !== this.generation) return null;

        if (this.inFlightGeneration === this.generation) {
            this.retryPending = true;
            return null;
        }

        this.inFlightGeneration = this.generation;
        return {
            generation: this.generation,
            revision: this.revision,
            domainRevisions: { ...this.domainRevisions }
        };
    }

    recordLiveChange(
        domains: readonly RefreshDomain[],
        { scheduleRetry = true }: { scheduleRetry?: boolean } = {}
    ): number {
        this.revision += 1;
        for (const domain of domains) {
            this.domainRevisions[domain] += 1;
        }
        if (scheduleRetry && domains.length > 0 && this.inFlightGeneration === this.generation) {
            this.retryPending = true;
        }
        return this.revision;
    }

    canCommit(ticket: RefreshTicket, domain: RefreshDomain): boolean {
        return this.isCurrent(ticket)
            && ticket.domainRevisions[domain] === this.domainRevisions[domain];
    }

    isCurrent(ticket: RefreshTicket): boolean {
        return ticket.generation === this.generation;
    }

    finishRefresh(ticket: RefreshTicket): { retry: boolean } {
        if (ticket.generation !== this.generation || this.inFlightGeneration !== ticket.generation) {
            return { retry: false };
        }

        this.inFlightGeneration = null;
        const retry = this.retryPending;
        this.retryPending = false;
        return { retry };
    }
}
