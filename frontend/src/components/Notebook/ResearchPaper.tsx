import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, X, Download, Printer, BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChartSpec } from "@/lib/api";

interface ResearchPaperProps {
    content: string;
    charts?: ChartSpec[];
}

function PaperChart({ chart, compact = false }: { chart: ChartSpec; compact?: boolean }) {
    const width = compact ? 340 : 640;
    const height = compact ? 140 : 240;
    const padding = compact
        ? { top: 14, right: 10, bottom: 28, left: 46 }
        : { top: 18, right: 18, bottom: 42, left: 64 };

    const series = chart.series?.[0];
    const values = useMemo(
        () => (series?.values || []).map((v) => Number(v)).filter((v) => Number.isFinite(v)),
        [series],
    );
    if (!series || !values.length) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;

    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const formatNumber = (val: number) => {
        const abs = Math.abs(val);
        if (abs >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}b`;
        if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}m`;
        if (abs >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
        if (abs >= 100) return val.toFixed(0);
        if (abs >= 1) return val.toFixed(2);
        return val.toPrecision(2);
    };

    const xLabels =
        Array.isArray(chart.labels) && chart.labels.length === values.length
            ? chart.labels
            : values.map((_, idx) => `${idx + 1}`);

    const xTicks = useMemo(() => {
        const maxTicks = compact ? 4 : 6;
        const step = Math.max(1, Math.ceil(xLabels.length / maxTicks));
        const ticks: { idx: number; label: string; x: number }[] = [];
        for (let i = 0; i < xLabels.length; i += step) {
            const x = padding.left + (i / Math.max(xLabels.length - 1, 1)) * innerWidth;
            ticks.push({ idx: i, label: xLabels[i], x });
        }
        if (ticks[ticks.length - 1]?.idx !== xLabels.length - 1) {
            const i = xLabels.length - 1;
            const x = padding.left + (i / Math.max(xLabels.length - 1, 1)) * innerWidth;
            ticks.push({ idx: i, label: xLabels[i], x });
        }
        return ticks;
    }, [xLabels, padding.left, innerWidth, compact]);

    const yTicks = [0, 0.5, 1].map((t) => ({
        value: min + span * t,
        y: padding.top + (1 - t) * innerHeight,
    }));

    const points = values.map((v, idx) => {
        const x = padding.left + (idx / Math.max(values.length - 1, 1)) * innerWidth;
        const y = padding.top + (1 - (v - min) / span) * innerHeight;
        return `${x},${y}`;
    });

    const bars = chart.type === "bar";

    return (
        <figure className="bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-gray-500 bg-gray-50 border-b border-gray-200">
                <span className="font-semibold text-gray-800">{chart.title || "Generated Chart"}</span>
                <span className="text-gray-500">
                    {series.name || "Series"} · {chart.type === "bar" ? "Bar" : "Line"}
                </span>
            </div>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto text-black">
                <defs>
                    <linearGradient id="paper-spark" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(0,0,0,0.06)" />
                        <stop offset="100%" stopColor="rgba(0,0,0,0.01)" />
                    </linearGradient>
                </defs>
                <rect x="0" y="0" width={width} height={height} fill="url(#paper-spark)" />

                {/* Grid + axes */}
                <g stroke="rgba(0,0,0,0.1)" strokeWidth="1">
                    {yTicks.map(({ y }, i) => (
                        <line key={`grid-${i}`} x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
                    ))}
                    <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} />
                    <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} />
                </g>

                <g fill="rgba(0,0,0,0.6)" fontSize="10" textAnchor="end">
                    {yTicks.map(({ y, value }, i) => (
                        <text key={`ylabel-${i}`} x={padding.left - 8} y={y + 3}>
                            {formatNumber(value)}
                        </text>
                    ))}
                </g>

                <g fill="rgba(0,0,0,0.6)" fontSize="10" textAnchor="middle">
                    {xTicks.map(({ x, label }, i) => (
                        <text key={`xlabel-${i}`} x={x} y={height - 12}>
                            {label}
                        </text>
                    ))}
                </g>

                {bars ? (
                    values.map((v, idx) => {
                        const barWidth = innerWidth / Math.max(values.length * 1.15, 1);
                        const x = padding.left + idx * (innerWidth / Math.max(values.length - 1, 1));
                        const y = padding.top + (1 - (v - min) / span) * innerHeight;
                        const h = height - padding.bottom - y;
                        return (
                            <rect
                                key={idx}
                                x={x - barWidth / 2}
                                y={y}
                                width={barWidth}
                                height={Math.max(h, 1)}
                                rx={2}
                                fill="rgba(34,114,244,0.65)"
                            />
                        );
                    })
                ) : (
                    <polyline
                        fill="none"
                        stroke="#1f3a93"
                        strokeWidth="2.25"
                        points={points.join(" ")}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                )}
            </svg>
            <figcaption className="px-4 py-3 text-xs text-gray-600 border-t border-gray-100">
                {chart.title || "Figure"} — {series.name || "metric"} over steps. Labels: {xLabels.slice(0, 3).join(", ")}
                {xLabels.length > 3 ? "…" : ""}.
            </figcaption>
        </figure>
    );
}

export function ResearchPaper({ content, charts }: ResearchPaperProps) {
    const [isFullView, setIsFullView] = useState(false);

    return (
        <>
            {/* Minimal Inline View */}
            <div className="w-full animate-in fade-in slide-in-from-bottom-8 duration-1000 pt-8">
                <div className="border border-[#1d1d1f] bg-black/50 backdrop-blur-sm rounded-lg overflow-hidden group hover:border-[#333] transition-colors">
                    {/* Header */}
                    <div className="h-12 px-4 border-b border-[#1d1d1f] flex items-center justify-between bg-black/50">
                        <div className="flex items-center gap-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                            <span className="text-[10px] font-medium text-[#f5f5f7] tracking-widest uppercase">
                                Final Manuscript
                            </span>
                        </div>
                        <button
                            onClick={() => setIsFullView(true)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1d1d1f] hover:bg-[#333] transition-all duration-300 group/btn"
                        >
                            <FileText className="w-3 h-3 text-[#86868b] group-hover/btn:text-white transition-colors" />
                            <span className="text-[10px] font-medium text-[#86868b] group-hover/btn:text-white transition-colors uppercase tracking-wide">
                                View Paper
                            </span>
                        </button>
                    </div>

                    {/* Preview Content */}
                    <div className="p-8 max-h-[400px] overflow-hidden relative bg-[#050505]">
                        <div className="prose prose-invert prose-sm max-w-none prose-p:text-[#86868b] prose-headings:text-[#f5f5f7] prose-strong:text-[#f5f5f7] font-serif">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {content}
                            </ReactMarkdown>
                        </div>
                        {charts && charts.length > 0 && (
                            <div className="mt-6 space-y-3">
                                <p className="text-[10px] tracking-[0.18em] uppercase text-[#6f6f77]">Figures (preview)</p>
                                <div className="flex gap-3 overflow-x-auto pb-2">
                                    {charts.slice(0, 3).map((chart, idx) => (
                                        <div key={idx} className="min-w-[320px] bg-[#0b0b0b] border border-[#1d1d1f] rounded-lg">
                                            <PaperChart chart={chart} compact />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {/* Gradient Fade */}
                        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#050505] to-transparent pointer-events-none" />
                    </div>
                </div>
            </div>

            {/* Full View Overlay */}
            {isFullView && createPortal(
                <div className="fixed inset-0 z-[100] bg-[#e8e8e8]/95 backdrop-blur-md animate-in fade-in duration-200 flex items-center justify-center p-0 sm:p-4 md:p-8 overflow-hidden">
                    <div className="w-full max-w-[1000px] h-full bg-[#fdfdfd] text-black shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 rounded-sm sm:border border-gray-300">
                        {/* Clean Header Bar */}
                        <div className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white flex-shrink-0 z-10 shadow-sm">
                            <div className="flex items-center gap-6">
                                <div className="flex items-center gap-3">
                                    <div className="bg-black text-white p-1.5 rounded-md">
                                        <BookOpen className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm font-medium text-gray-900 tracking-tight">Research Preview</span>
                                </div>
                                <div className="hidden md:flex items-center gap-4 text-sm text-gray-500">
                                    <span className="px-2 py-0.5 bg-gray-100 rounded-full text-xs font-medium text-gray-600">Final Draft</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button className="hidden md:flex items-center gap-2 px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors">
                                    <Download className="w-4 h-4" />
                                    <span className="text-xs font-medium">PDF</span>
                                </button>
                                <button 
                                    onClick={() => window.print()}
                                    className="hidden md:flex items-center gap-2 px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                                >
                                    <Printer className="w-4 h-4" />
                                    <span className="text-xs font-medium">Print</span>
                                </button>
                                <div className="h-4 w-[1px] bg-gray-300 mx-1" />
                                <button 
                                    onClick={() => setIsFullView(false)}
                                    className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500 hover:text-black"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Paper Content Area - "The Page" */}
                        <div className="flex-1 overflow-y-auto bg-[#e6e6e6] custom-scrollbar-light">
                            <div className="min-h-full w-full flex justify-center p-4 md:p-8">
                                <div id="printable-paper-content" className="bg-white w-full max-w-[8.5in] min-h-[11in] h-fit shadow-sm p-8 md:p-[1in] selection:bg-blue-100 selection:text-black">
                                    <article className="prose max-w-none font-serif text-black">
                                        {/* Style Overrides for "Paper" look */}
                                        <style>{`
                                            .prose h1 { 
                                                text-align: center; 
                                                font-family: "Times New Roman", Times, serif;
                                                margin-bottom: 0.5em;
                                                font-size: 2.25rem;
                                                line-height: 1.1;
                                                color: #000;
                                                font-weight: 500;
                                            }
                                            .prose h2 {
                                                font-family: "Times New Roman", Times, serif;
                                                font-size: 1.25rem;
                                                margin-top: 2em;
                                                color: #000;
                                                border-bottom: 1px solid #eee;
                                                padding-bottom: 0.3em;
                                            }
                                            .prose p {
                                                font-family: "Times New Roman", Times, serif;
                                                text-align: justify;
                                                font-size: 1.05rem;
                                                line-height: 1.6;
                                                margin-bottom: 1.2em;
                                                color: #1a1a1a;
                                            }
                                            .prose strong {
                                                font-weight: 600;
                                                color: #000;
                                            }
                                            .prose ul {
                                                list-style-type: disc;
                                                padding-left: 1.5em;
                                            }
                                            .prose li {
                                                font-family: "Times New Roman", Times, serif;
                                                margin-bottom: 0.5em;
                                            }
                                            /* Abstract Styling Attempt */
                                            .prose h2:first-of-type {
                                                text-align: center;
                                                font-size: 0.9rem;
                                                text-transform: uppercase;
                                                letter-spacing: 0.05em;
                                                border-bottom: none;
                                                margin-top: 2em;
                                                margin-bottom: 1em;
                                            }
                                        `}</style>
                                        
                                        <ReactMarkdown 
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                h1: ({node, ...props}) => <h1 {...props} />,
                                            }}
                                        >
                                            {content}
                                        </ReactMarkdown>

                                        {charts && charts.length > 0 && (
                                            <section>
                                                <h2>Figures</h2>
                                                <div className="space-y-6">
                                                    {charts.map((chart, idx) => (
                                                        <div key={idx} className="space-y-2">
                                                            <div className="text-sm text-gray-600 font-medium">
                                                                Figure {idx + 1}. {chart.title || "Generated chart"}
                                                            </div>
                                                            <PaperChart chart={chart} />
                                                        </div>
                                                    ))}
                                                </div>
                                            </section>
                                        )}
                                        
                                        {/* Footer */}
                                        <div className="mt-24 pt-8 border-t border-gray-200 flex flex-col items-center gap-2 text-gray-400">
                                            <p className="text-[10px] font-mono">Preprint generated by AI Researcher</p>
                                        </div>
                                    </article>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
