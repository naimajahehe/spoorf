import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outputDir = mkdtempSync(join(tmpdir(), 'spoorf-refresh-sequencer-'));

try {
    execFileSync(
        process.execPath,
        [
            './node_modules/typescript/bin/tsc',
            '--target', 'ES2020',
            '--module', 'NodeNext',
            '--moduleResolution', 'NodeNext',
            '--outDir', outputDir,
            'src/lib/refreshSequencer.ts',
            'src/lib/gateway.ts'
        ],
        { stdio: 'inherit' }
    );

    const { RefreshSequencer } = await import(
        `${pathToFileURL(join(outputDir, 'refreshSequencer.js')).href}?${Date.now()}`
    );
    const { findGateway } = await import(
        `${pathToFileURL(join(outputDir, 'gateway.js')).href}?${Date.now()}`
    );

    {
        const heuristicCandidate = { ip: '192.168.1.1', is_gateway: false };
        const authoritativeGateway = { ip: '192.168.1.254', is_gateway: true };

        assert.equal(
            findGateway([heuristicCandidate]),
            null,
            'address suffixes do not infer a gateway without backend authority'
        );
        assert.equal(
            findGateway([heuristicCandidate, authoritativeGateway]),
            authoritativeGateway,
            'only an explicit backend gateway flag selects a gateway'
        );
    }

    {
        const sequencer = new RefreshSequencer();
        const ticket = sequencer.beginRefresh();
        assert.ok(ticket, 'first refresh starts immediately');
        assert.equal(sequencer.canCommit(ticket, 'devices'), true);

        sequencer.recordLiveChange(['devices']);

        assert.equal(
            sequencer.canCommit(ticket, 'devices'),
            false,
            'a newer device event prevents its stale snapshot from committing'
        );
        assert.equal(
            sequencer.canCommit(ticket, 'gatewayStatus'),
            true,
            'an unrelated gateway snapshot remains eligible to commit'
        );
        assert.deepEqual(sequencer.finishRefresh(ticket), { retry: true });

        const retry = sequencer.beginRefresh(ticket.generation);
        assert.ok(retry, 'the deferred latest refresh starts after the stale refresh finishes');
        assert.equal(retry.revision, 1);
    }

    {
        const sequencer = new RefreshSequencer();
        const first = sequencer.beginRefresh();
        assert.ok(first);

        assert.equal(sequencer.beginRefresh(), null, 'overlapping refreshes are single-flight');
        sequencer.recordLiveChange([]);
        assert.deepEqual(
            sequencer.finishRefresh(first),
            { retry: true },
            'a coalesced refresh runs once even when telemetry does not invalidate a domain'
        );

        const latest = sequencer.beginRefresh(first.generation);
        assert.ok(latest);
        assert.deepEqual(sequencer.finishRefresh(latest), { retry: false });
    }

    {
        const sequencer = new RefreshSequencer();
        const ticket = sequencer.beginRefresh();
        assert.ok(ticket);
        sequencer.recordLiveChange(['wifi'], { scheduleRetry: false });
        assert.equal(
            sequencer.canCommit(ticket, 'wifi'),
            false,
            'telemetry that updates Wi-Fi state still blocks a stale Wi-Fi snapshot'
        );
        assert.deepEqual(
            sequencer.finishRefresh(ticket),
            { retry: false },
            'telemetry-only events do not create a refresh retry loop'
        );
    }

    {
        const sequencer = new RefreshSequencer();
        const stale = sequencer.beginRefresh();
        assert.ok(stale);
        const currentGeneration = sequencer.startGeneration();
        const current = sequencer.beginRefresh(currentGeneration);
        assert.ok(current);

        assert.equal(sequencer.isCurrent(stale), false);
        assert.equal(sequencer.isCurrent(current), true);
        assert.equal(sequencer.canCommit(stale, 'devices'), false);
        assert.deepEqual(sequencer.finishRefresh(stale), { retry: false });
        assert.equal(sequencer.canCommit(current, 'devices'), true);
    }

    console.log('refresh sequencer behavior assertions passed');
} finally {
    rmSync(outputDir, { recursive: true, force: true });
}
