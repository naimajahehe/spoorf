import { useState, useMemo } from 'react';
import type { FC } from 'react';
import { ArrowDown, ArrowUp, Zap, Activity } from 'lucide-react';
import { cn } from '../lib/utils';

export interface BandwidthDataPoint {
    time: number;       // timestamp in ms
    label: string;      // '-9s', '-8s', ..., 'Now'
    download: number;   // Mbps
    upload: number;     // Mbps
}

interface NetworkBandwidthLineChartProps {
    history: BandwidthDataPoint[];
    currentDownload: number;
    currentUpload: number;
    latency?: number;
    className?: string;
}

// Generate smooth cubic bezier SVG path from coordinate points
function getSmoothSvgPath(points: { x: number; y: number }[]): string {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

    let path = `M ${points[0].x} ${points[0].y}`;

    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i === 0 ? 0 : i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }

    return path;
}

export const NetworkBandwidthLineChart: FC<NetworkBandwidthLineChartProps> = ({
    history,
    currentDownload,
    currentUpload,
    latency,
    className
}) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

    // Pastikan buffer selalu memiliki minimal 10 data points untuk timeline 10 detik
    const dataPoints: BandwidthDataPoint[] = useMemo(() => {
        const points = [...history];
        const targetLen = 10;
        if (points.length < targetLen) {
            const paddingCount = targetLen - points.length;
            const now = Date.now();
            const padded: BandwidthDataPoint[] = [];
            for (let i = paddingCount; i > 0; i--) {
                padded.push({
                    time: now - i * 1000,
                    label: `-${i}s`,
                    download: 0,
                    upload: 0
                });
            }
            return [...padded, ...points];
        }
        return points.slice(-targetLen);
    }, [history]);

    // Hitung Max Scale (dengan batas minimum 1.0 Mbps agar grafik tetap proporsional)
    const maxBandwidth = useMemo(() => {
        const maxVal = Math.max(
            ...dataPoints.map(p => Math.max(p.download, p.upload)),
            currentDownload,
            currentUpload,
            0.5
        );
        // Round up to clean ceiling (e.g., 1, 2, 5, 10, 20, 50, 100)
        if (maxVal <= 1) return 1;
        if (maxVal <= 5) return 5;
        if (maxVal <= 10) return 10;
        if (maxVal <= 25) return 25;
        if (maxVal <= 50) return 50;
        if (maxVal <= 100) return 100;
        return Math.ceil(maxVal * 1.2);
    }, [dataPoints, currentDownload, currentUpload]);

    // Hitung rata-rata 10 detik & peak
    const avg10sDownload = useMemo(() => {
        const sum = dataPoints.reduce((acc, p) => acc + p.download, 0);
        return (sum / (dataPoints.length || 1)).toFixed(1);
    }, [dataPoints]);

    const avg10sUpload = useMemo(() => {
        const sum = dataPoints.reduce((acc, p) => acc + p.upload, 0);
        return (sum / (dataPoints.length || 1)).toFixed(1);
    }, [dataPoints]);

    const peakSpeed = useMemo(() => {
        const peak = Math.max(...dataPoints.map(p => Math.max(p.download, p.upload)), 0);
        return peak.toFixed(1);
    }, [dataPoints]);

    // SVG Dimensions
    const width = 280;
    const height = 96;
    const paddingX = 14;
    const paddingTop = 12;
    const paddingBottom = 16;
    const plotWidth = width - paddingX * 2;
    const plotHeight = height - paddingTop - paddingBottom;

    // Kalkulasi titik koordinat download & upload
    const { downloadPoints, uploadPoints, downloadPath, uploadPath, downloadAreaPath, uploadAreaPath } = useMemo(() => {
        const dPts = dataPoints.map((p, i) => {
            const x = paddingX + (i / (dataPoints.length - 1 || 1)) * plotWidth;
            const y = paddingTop + plotHeight - (Math.min(p.download, maxBandwidth) / maxBandwidth) * plotHeight;
            return { x, y };
        });

        const uPts = dataPoints.map((p, i) => {
            const x = paddingX + (i / (dataPoints.length - 1 || 1)) * plotWidth;
            const y = paddingTop + plotHeight - (Math.min(p.upload, maxBandwidth) / maxBandwidth) * plotHeight;
            return { x, y };
        });

        const dPath = getSmoothSvgPath(dPts);
        const uPath = getSmoothSvgPath(uPts);

        const bottomY = paddingTop + plotHeight;
        const dArea = dPts.length > 0
            ? `${dPath} L ${dPts[dPts.length - 1].x} ${bottomY} L ${dPts[0].x} ${bottomY} Z`
            : '';

        const uArea = uPts.length > 0
            ? `${uPath} L ${uPts[uPts.length - 1].x} ${bottomY} L ${uPts[0].x} ${bottomY} Z`
            : '';

        return {
            downloadPoints: dPts,
            uploadPoints: uPts,
            downloadPath: dPath,
            uploadPath: uPath,
            downloadAreaPath: dArea,
            uploadAreaPath: uArea
        };
    }, [dataPoints, maxBandwidth, plotWidth, plotHeight]);

    const activeHoverPoint = hoveredIdx !== null && dataPoints[hoveredIdx] ? dataPoints[hoveredIdx] : null;
    const activeHoverDownloadPt = hoveredIdx !== null ? downloadPoints[hoveredIdx] : null;
    const activeHoverUploadPt = hoveredIdx !== null ? uploadPoints[hoveredIdx] : null;

    const lastDownloadPt = downloadPoints[downloadPoints.length - 1];
    const lastUploadPt = uploadPoints[uploadPoints.length - 1];

    return (
        <div className={cn("space-y-2.5", className)}>
            {/* Header: Title & Real-time Rate Chips with Lucide Icons */}
            <div className="flex items-center justify-between pb-1 border-b border-white/[0.04]">
                <div className="flex items-center gap-1.5">
                    <Activity size={12} className="text-zinc-400" />
                    <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-300 font-semibold">
                        Live Throughput
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                        (10s)
                    </span>
                </div>

                {latency !== undefined && (
                    <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-400">
                        <Zap size={10} className="text-amber-400" />
                        <span>{latency} ms</span>
                    </div>
                )}
            </div>

            {/* Top Stat Counters (Clean, unboxed inline indicators) */}
            <div className="flex items-center justify-between px-1 py-1 text-xs font-mono">
                {/* Download Counter */}
                <div className="flex items-center gap-2">
                    <ArrowDown size={12} strokeWidth={2.5} className="text-emerald-400" />
                    <span className="text-[10px] uppercase text-zinc-400">Down</span>
                    <span className="font-bold text-emerald-300">
                        {currentDownload.toFixed(1)} <span className="text-[10px] font-normal text-emerald-400/80">Mbps</span>
                    </span>
                </div>

                <span className="text-zinc-700 font-light">|</span>

                {/* Upload Counter */}
                <div className="flex items-center gap-2">
                    <ArrowUp size={12} strokeWidth={2.5} className="text-cyan-400" />
                    <span className="text-[10px] uppercase text-zinc-400">Up</span>
                    <span className="font-bold text-cyan-300">
                        {currentUpload.toFixed(1)} <span className="text-[10px] font-normal text-cyan-400/80">Mbps</span>
                    </span>
                </div>
            </div>

            {/* Interactive SVG Canvas */}
            <div className="relative w-full overflow-hidden select-none">
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    className="w-full h-24 overflow-visible"
                    onMouseLeave={() => setHoveredIdx(null)}
                >
                    <defs>
                        {/* Download Emerald Gradient Fill */}
                        <linearGradient id="downloadGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                        </linearGradient>

                        {/* Upload Cyan Gradient Fill */}
                        <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                        </linearGradient>
                    </defs>

                    {/* Subtle Horizontal Gridlines */}
                    <line
                        x1={paddingX}
                        y1={paddingTop}
                        x2={width - paddingX}
                        y2={paddingTop}
                        stroke="rgba(255,255,255,0.06)"
                        strokeDasharray="2 3"
                        strokeWidth="1"
                    />
                    <line
                        x1={paddingX}
                        y1={paddingTop + plotHeight / 2}
                        x2={width - paddingX}
                        y2={paddingTop + plotHeight / 2}
                        stroke="rgba(255,255,255,0.04)"
                        strokeDasharray="2 3"
                        strokeWidth="1"
                    />
                    <line
                        x1={paddingX}
                        y1={paddingTop + plotHeight}
                        x2={width - paddingX}
                        y2={paddingTop + plotHeight}
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth="1"
                    />

                    {/* Y-Axis Label Max Scale */}
                    <text
                        x={paddingX + 2}
                        y={paddingTop + 8}
                        className="text-[8px] font-mono fill-zinc-600 select-none"
                    >
                        {maxBandwidth}M
                    </text>

                    {/* Area Fills */}
                    <path d={downloadAreaPath} fill="url(#downloadGradient)" />
                    <path d={uploadAreaPath} fill="url(#uploadGradient)" />

                    {/* Curve Lines */}
                    <path
                        d={downloadPath}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="transition-all duration-300"
                    />
                    <path
                        d={uploadPath}
                        fill="none"
                        stroke="#06b6d4"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="4 2"
                        className="transition-all duration-300"
                    />

                    {/* Live Pulsating End Dots */}
                    {lastDownloadPt && (
                        <g>
                            <circle cx={lastDownloadPt.x} cy={lastDownloadPt.y} r="3" fill="#10b981" />
                            <circle cx={lastDownloadPt.x} cy={lastDownloadPt.y} r="5" fill="#10b981" opacity="0.4" className="animate-ping" />
                        </g>
                    )}

                    {lastUploadPt && (
                        <circle cx={lastUploadPt.x} cy={lastUploadPt.y} r="2.5" fill="#06b6d4" />
                    )}

                    {/* Hover Crosshair and Markers */}
                    {hoveredIdx !== null && activeHoverDownloadPt && activeHoverUploadPt && (
                        <g>
                            <line
                                x1={activeHoverDownloadPt.x}
                                y1={paddingTop}
                                x2={activeHoverDownloadPt.x}
                                y2={paddingTop + plotHeight}
                                stroke="rgba(255,255,255,0.25)"
                                strokeWidth="1"
                                strokeDasharray="2 2"
                            />
                            <circle cx={activeHoverDownloadPt.x} cy={activeHoverDownloadPt.y} r="4" fill="#10b981" stroke="#fff" strokeWidth="1.5" />
                            <circle cx={activeHoverUploadPt.x} cy={activeHoverUploadPt.y} r="3.5" fill="#06b6d4" stroke="#fff" strokeWidth="1.5" />
                        </g>
                    )}

                    {/* Invisible Interactive Columns for Mouse Hover Detection */}
                    {dataPoints.map((_, idx) => {
                        const colWidth = plotWidth / (dataPoints.length || 1);
                        const x = paddingX + idx * colWidth - colWidth / 2;
                        return (
                            <rect
                                key={idx}
                                x={Math.max(0, x)}
                                y={0}
                                width={colWidth}
                                height={height}
                                fill="transparent"
                                className="cursor-crosshair"
                                onMouseEnter={() => setHoveredIdx(idx)}
                            />
                        );
                    })}
                </svg>

                {/* Floating Interactive Tooltip on Hover */}
                {hoveredIdx !== null && activeHoverPoint && activeHoverDownloadPt && (
                    <div
                        className="absolute top-1 pointer-events-none transform -translate-x-1/2 bg-[#121316]/95 backdrop-blur-md border border-white/[0.12] rounded-lg px-2 py-1 shadow-xl text-[10px] font-mono text-white flex items-center gap-2 z-20 whitespace-nowrap"
                        style={{
                            left: `${Math.min(Math.max(activeHoverDownloadPt.x, 40), width - 40)}px`
                        }}
                    >
                        <span className="text-zinc-400">{activeHoverPoint.label}</span>
                        <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                            <ArrowDown size={9} />
                            {activeHoverPoint.download.toFixed(1)}M
                        </span>
                        <span className="text-cyan-400 font-semibold flex items-center gap-0.5">
                            <ArrowUp size={9} />
                            {activeHoverPoint.upload.toFixed(1)}M
                        </span>
                    </div>
                )}
            </div>

            {/* Bottom Timeline Legend & Statistics */}
            <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 pt-1 border-t border-white/[0.04]">
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                        <span className="size-1.5 rounded-full bg-emerald-400 inline-block" />
                        <span className="text-zinc-400">Avg 10s: {avg10sDownload}M</span>
                    </span>
                    <span className="text-zinc-700">|</span>
                    <span className="flex items-center gap-1">
                        <span className="size-1.5 rounded-full bg-cyan-400 inline-block" />
                        <span className="text-zinc-400">{avg10sUpload}M</span>
                    </span>
                </div>

                <div className="text-zinc-400">
                    Peak: <span className="text-zinc-200 font-semibold">{peakSpeed}M</span>
                </div>
            </div>
        </div>
    );
};
